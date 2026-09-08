-- The Daily Wow — schema v1 (PRD §8). Runs on Supabase Postgres; the same file runs on PGlite in tests.
-- Conventions: server routes talk to Postgres with the service connection (bypasses RLS) and enforce
-- ownership in code; RLS below is the safety net for the anon/authenticated roles used by the browser
-- client (which today only signs in — it never reads tables directly).

-- gen_random_uuid() is in core Postgres ≥ 13 (Supabase and PGlite alike); no extension needed.

-- ---------- enums ----------
do $$ begin
  create type kid_level as enum ('support','standard','on_track','advanced');
exception when duplicate_object then null; end $$;
do $$ begin
  create type contact_role as enum ('parent2','relative');
exception when duplicate_object then null; end $$;
do $$ begin
  create type edition_status as enum ('staged','released','held');
exception when duplicate_object then null; end $$;
do $$ begin
  create type sub_status as enum ('active','past_due','ended');
exception when duplicate_object then null; end $$;
do $$ begin
  create type usage_kind as enum ('chat','grade','demo');
exception when duplicate_object then null; end $$;
do $$ begin
  create type usage_scope as enum ('lesson','adjacent','off');
exception when duplicate_object then null; end $$;
do $$ begin
  create type send_kind as enum ('daily','completion','weekly','risk','welcome','billing');
exception when duplicate_object then null; end $$;

-- ---------- parents ----------
create table if not exists parents (
  id uuid primary key,                          -- = auth.users.id
  email text not null unique,
  name text not null default '',
  locale text not null default 'he',
  timezone text not null default 'Asia/Jerusalem',
  is_editor boolean not null default false,
  notify_completion boolean not null default true,
  notify_weekly boolean not null default true,
  notify_streak_risk boolean not null default false,
  keep_explanations boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- kids ----------
create table if not exists kids (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents(id) on delete cascade,
  name text not null,
  feminine boolean not null default false,
  age int not null check (age between 5 and 16),
  grade text not null default '',
  level kid_level not null default 'standard',
  email text,
  link_token_hash text not null unique,
  link_token_enc text,                           -- the raw token, AES-GCM with LINK_KEY, for the dashboard/emails
  track_override text,
  free_assistant_until timestamptz,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists kids_parent_idx on kids(parent_id) where deleted_at is null;

create table if not exists kid_contacts (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids(id) on delete cascade,
  name text not null default '',
  email text not null,
  role contact_role not null default 'relative',
  notify_daily boolean not null default true,
  notify_completion boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists kid_contacts_kid_idx on kid_contacts(kid_id);

-- ---------- editions ----------
create table if not exists editions (
  n int primary key,
  code text not null,
  date date not null,
  language text not null default 'he',
  title text not null,
  topics text[] not null default '{}',
  summary text not null default '',
  teaser text not null default '',              -- 2–3 Hebrew lines for the daily email (from the builder)
  password text not null default '',            -- the daily secret; never sent to a kid, shown to parents in the dashboard
  max_score int not null default 11,
  status edition_status not null default 'staged',
  reviewer_verdict text,
  review_url text,
  html_path text,                               -- storage object path (mirrored on release)
  html text,                                    -- the fragment itself (small enough; storage mirror optional)
  lesson_context text,                          -- server-side assistant prompt material (extracted at release)
  grading_context text,                         -- key ideas / rubric / model answer for /api/arto/grade
  editor_note text,
  edited_by_editor boolean not null default false,
  sources text,
  staged_at timestamptz not null default now(),
  released_at timestamptz,
  held_at timestamptz
);
create index if not exists editions_status_date_idx on editions(status, date desc);

-- ---------- completions & derived stats ----------
create table if not exists completions (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids(id) on delete cascade,
  edition_n int not null references editions(n),
  score int not null,
  max int not null,
  complete boolean not null default false,
  late boolean not null default false,
  challenge boolean not null default false,
  xp_awarded int not null default 0,
  explanation text,
  completed_at timestamptz not null default now(),   -- first completion time (kept on retries)
  updated_at timestamptz not null default now(),
  unique (kid_id, edition_n)
);
create index if not exists completions_kid_idx on completions(kid_id, edition_n);

create table if not exists kid_stats (
  kid_id uuid primary key references kids(id) on delete cascade,
  streak int not null default 0,
  best int not null default 0,
  xp int not null default 0,
  badges text[] not null default '{}',
  last_done_date date,
  updated_at timestamptz not null default now()
);

-- ---------- billing ----------
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid not null references kids(id) on delete cascade,
  provider text not null default 'dodo',
  provider_customer_id text,
  provider_subscription_id text unique,
  status sub_status not null default 'active',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_kid_idx on subscriptions(kid_id);

create table if not exists webhook_events (                 -- idempotency for provider webhooks
  id text primary key,
  provider text not null default 'dodo',
  type text not null,
  received_at timestamptz not null default now()
);

-- ---------- assistant ----------
create table if not exists usage (
  id uuid primary key default gen_random_uuid(),
  kid_id uuid references kids(id) on delete set null,
  edition_n int,
  kind usage_kind not null,
  scope usage_scope,
  model text not null default '',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_estimate numeric(10,6) not null default 0,
  off_prompt text,                               -- anonymised off-topic prompt, purged after 7 days
  created_at timestamptz not null default now()
);
create index if not exists usage_created_idx on usage(created_at);
create index if not exists usage_edition_idx on usage(edition_n);

create table if not exists arto_counters (
  key text not null,                             -- kid id, or 'demo'
  day date not null,
  messages int not null default 0,
  off_count int not null default 0,
  primary key (key, day)
);

create table if not exists arto_sessions (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  edition_n int not null,
  off_count int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists arto_sessions_exp_idx on arto_sessions(expires_at);

-- ---------- sends ----------
create table if not exists sends (
  id uuid primary key default gen_random_uuid(),
  edition_n int,
  parent_id uuid references parents(id) on delete cascade,
  kid_id uuid references kids(id) on delete cascade,
  kind send_kind not null,
  to_emails text[] not null default '{}',
  week_key text,                                 -- 'YYYY-Www' (ISO week) — the idempotency key of the weekly mail
  resend_id text,
  sent_at timestamptz not null default now()
);
alter table sends add column if not exists week_key text;
create unique index if not exists sends_daily_once on sends(edition_n, parent_id) where kind = 'daily';
create unique index if not exists sends_completion_once on sends(edition_n, kid_id) where kind = 'completion';
-- the weekly recap has no edition; one per parent per ISO week
create unique index if not exists sends_weekly_once on sends(parent_id, week_key) where kind = 'weekly';
create unique index if not exists sends_risk_once on sends(edition_n, kid_id) where kind = 'risk';
create index if not exists sends_kind_idx on sends(kind, sent_at desc);

-- ---------- editor ----------
create table if not exists menus (
  n int primary key,
  for_date date,
  options jsonb not null default '[]',
  default_k int,
  chosen text,
  chosen_title text,
  decided_by text,
  created_at timestamptz not null default now()
);

create table if not exists topic_ideas (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references parents(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now(),
  used_in_edition int
);

create table if not exists open_books (
  month date primary key,
  families int not null default 0,
  kids int not null default 0,
  subs int not null default 0,
  token_cost numeric(10,2) not null default 0,
  build_cost numeric(10,2) not null default 0,
  income numeric(10,2) not null default 0,
  note text not null default ''
);

create table if not exists app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into app_config(key, value) values
  ('assistant_daily_cap', '30'),
  ('free_messages_per_day', '3'),
  ('demo_pool_per_day', '30'),
  ('model', 'claude-sonnet-5'),
  ('send_time', '11:05'),
  ('magic_links_per_family_per_day', '20'),
  ('resend_daily_limit', '100')
on conflict (key) do nothing;

create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail text
);

-- ---------- row-level security (browser roles) ----------
alter table parents enable row level security;
alter table kids enable row level security;
alter table kid_contacts enable row level security;
alter table editions enable row level security;
alter table completions enable row level security;
alter table kid_stats enable row level security;
alter table subscriptions enable row level security;
alter table webhook_events enable row level security;
alter table usage enable row level security;
alter table arto_counters enable row level security;
alter table arto_sessions enable row level security;
alter table sends enable row level security;
alter table menus enable row level security;
alter table topic_ideas enable row level security;
alter table open_books enable row level security;
alter table app_config enable row level security;
alter table job_runs enable row level security;

-- Policies use auth.uid(), which exists on Supabase. On plain Postgres (tests) a stub is created.
do $$ begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') then
    create function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
  end if;
end $$;

drop policy if exists parents_self on parents;
create policy parents_self on parents for select using (id = auth.uid());
drop policy if exists parents_self_update on parents;
create policy parents_self_update on parents for update using (id = auth.uid());
drop policy if exists kids_own on kids;
create policy kids_own on kids for all using (parent_id = auth.uid());
drop policy if exists contacts_own on kid_contacts;
create policy contacts_own on kid_contacts for all using (exists (select 1 from kids k where k.id = kid_id and k.parent_id = auth.uid()));
drop policy if exists completions_own on completions;
create policy completions_own on completions for select using (exists (select 1 from kids k where k.id = kid_id and k.parent_id = auth.uid()));
drop policy if exists stats_own on kid_stats;
create policy stats_own on kid_stats for select using (exists (select 1 from kids k where k.id = kid_id and k.parent_id = auth.uid()));
drop policy if exists subs_own on subscriptions;
create policy subs_own on subscriptions for select using (exists (select 1 from kids k where k.id = kid_id and k.parent_id = auth.uid()));
-- editions: released rows are public, minus the secret columns (a view exposes the safe columns)
drop policy if exists editions_public on editions;
create policy editions_public on editions for select using (status = 'released');
create or replace view editions_public as
  select n, code, date, language, title, topics, summary, teaser, max_score, status, editor_note, released_at
  from editions where status = 'released';
-- everything else: server only (no policies → no browser access)

-- ---------- auth hook: a parents row on first sign-in (Supabase only; no-op elsewhere) ----------
do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'auth' and tablename = 'users') then
    create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      insert into public.parents (id, email, name)
      values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'name', ''))
      on conflict (id) do update set email = excluded.email;
      return new;
    end $f$;
    drop trigger if exists on_auth_user_created on auth.users;
    create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
  end if;
end $$;

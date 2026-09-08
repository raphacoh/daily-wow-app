-- Gamification P1 (spec §8.3): per-item events the engine emits, community item statistics, kid notices.
create table if not exists item_events (
  id bigserial primary key,
  kid_id uuid not null references kids(id) on delete cascade,
  edition_n int not null references editions(n),
  item_id text not null,                          -- structural id: predict | qc:<id> | mcq:<track>:<i> | order | num:<t> | challenge | explain | open:bonus | open:sources
  kind text not null,
  attempt int not null default 1,
  correct boolean,
  partial int,
  stars int,
  graded text,                                    -- explain: ai | rubric
  value numeric,
  target numeric,
  at timestamptz not null default now(),
  unique (kid_id, edition_n, item_id, attempt)
);
create index if not exists item_events_edition on item_events(edition_n, item_id);
alter table item_events enable row level security;

-- first-try success per item across the community (rebuilt by the close-day job; rarity badges read this)
create table if not exists item_stats (
  edition_n int not null references editions(n),
  item_id text not null,
  n int not null default 0,
  first_try_correct int not null default 0,
  computed_at timestamptz not null default now(),
  primary key (edition_n, item_id)
);
alter table item_stats enable row level security;

-- things that happened while the kid was away ("yesterday only 3 of 21 kids…"), shown once on the next visit
create table if not exists kid_notices (
  id bigserial primary key,
  kid_id uuid not null references kids(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  shown_at timestamptz
);
create index if not exists kid_notices_pending on kid_notices(kid_id) where shown_at is null;
alter table kid_notices enable row level security;

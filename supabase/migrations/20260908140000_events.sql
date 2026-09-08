-- First-party analytics (PRD §1.3: no third-party trackers). One row per event, no cookies, no PII:
-- `visitor` is a salted hash of (IP, user agent, day) that rotates daily, so nobody is tracked across days.
create table if not exists events (
  id bigserial primary key,
  name text not null,                 -- land | demo_start | demo_complete | signup | lesson_complete | subscribe
  visitor text,                       -- daily-rotating anonymous hash (null for server-side business events)
  parent_id uuid,                     -- set for signed-up families' events (no FK: survives account deletion as an aggregate)
  kid_id uuid,
  edition_n int,
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists events_name_time on events(name, created_at desc);
create index if not exists events_visitor on events(visitor, created_at desc);
alter table events enable row level security;

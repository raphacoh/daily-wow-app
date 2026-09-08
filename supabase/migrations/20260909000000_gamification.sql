-- Gamification P0 (docs/gamification-spec.md §8.3). Everything here is either a server-observed fact
-- (grades) or a rebuildable cache (kid_progress). No counters: `kid_progress` is replayed from facts.

-- AI grading stars, as the server saw them (the page only reports a mixed score)
create table if not exists grades (
  kid_id uuid not null references kids(id) on delete cascade,
  edition_n int not null references editions(n),
  stars int not null check (stars between 1 and 3),
  at timestamptz not null default now(),
  primary key (kid_id, edition_n)
);
alter table grades enable row level security;

-- derived cache of the kid's roots, medals, cards, badges, shields (one JSON document; see gamification.ts)
create table if not exists kid_progress (
  kid_id uuid primary key references kids(id) on delete cascade,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table kid_progress enable row level security;

-- the builder's optional WOW_META (roots weights, hero card, item tags) and the engine version it shipped with
alter table editions add column if not exists wow_meta jsonb;
alter table editions add column if not exists engine_version text;

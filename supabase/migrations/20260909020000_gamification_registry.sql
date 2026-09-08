-- Gamification P2 (spec §9): the editor's registries — topic words → roots, skill slugs → Hebrew names / merges.
create table if not exists root_aliases (
  topic text primary key,
  root text not null,
  created_at timestamptz not null default now()
);
alter table root_aliases enable row level security;

create table if not exists skills (
  slug text primary key,
  name_he text,
  canonical_slug text,                    -- when set, this slug counts as that one
  created_at timestamptz not null default now()
);
alter table skills enable row level security;

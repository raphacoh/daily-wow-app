-- Per-session message count (the public demo stops after a few questions per visitor while the daily pool stays shared),
-- and one cap notice per kid per day (for kind = 'cap', sends.week_key holds the day, YYYY-MM-DD).
alter table arto_sessions add column if not exists messages int not null default 0;
create unique index if not exists sends_cap_once on sends(kid_id, week_key) where kind = 'cap';

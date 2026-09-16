-- Addresses that asked to stop getting mail. Keyed by the lowercased address rather than by a family row:
-- the person may be a parent, a kid's own address or an extra adult, and a parent re-adding the address as a
-- contact must not undo the recipient's own choice. Billing and sign-in mail ignore this list (emails.ts).
create table if not exists unsubscribes (
  email text primary key,
  source text not null default 'link',            -- 'link' (the footer page), 'one_click' (List-Unsubscribe), 'editor'
  created_at timestamptz not null default now()
);

alter table unsubscribes enable row level security;

-- A family registers before it has an auth user (the wizard creates the parents row with a fresh uuid).
-- When Supabase Auth later creates the user for that email, the row must be re-keyed to the auth uid
-- instead of colliding on the unique email. Foreign keys cascade the key change.

alter table kids drop constraint if exists kids_parent_id_fkey;
alter table kids add constraint kids_parent_id_fkey foreign key (parent_id) references parents(id) on delete cascade on update cascade;
alter table sends drop constraint if exists sends_parent_id_fkey;
alter table sends add constraint sends_parent_id_fkey foreign key (parent_id) references parents(id) on delete cascade on update cascade;
alter table topic_ideas drop constraint if exists topic_ideas_parent_id_fkey;
alter table topic_ideas add constraint topic_ideas_parent_id_fkey foreign key (parent_id) references parents(id) on delete set null on update cascade;

do $$ begin
  if exists (select 1 from pg_tables where schemaname = 'auth' and tablename = 'users') then
    create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $f$
    begin
      update public.parents
         set id = new.id,
             name = coalesce(nullif(name, ''), coalesce(new.raw_user_meta_data->>'name', ''))
       where email = lower(new.email) and id <> new.id;
      if not found then
        insert into public.parents (id, email, name)
        values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'name', ''))
        on conflict (id) do update set email = excluded.email;
      end if;
      return new;
    end $f$;
    drop trigger if exists on_auth_user_created on auth.users;
    create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
  end if;
end $$;

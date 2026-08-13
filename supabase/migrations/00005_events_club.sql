-- 00005: events belong to clubs (ADR-0001). Nullable now; NOT NULL is wave 00008 (separate approval).

alter table public.events add column club_id uuid references public.clubs (id);
create index events_club_idx on public.events (club_id);

-- Re-run the General seed (covers fresh DBs where 00004's seed was skipped).
insert into public.clubs (slug, name, description, created_by)
select 'general', 'General', 'Default club for platform-wide and legacy events.',
       (select id from profiles where role = 'super_admin' order by created_at limit 1)
where not exists (select 1 from clubs where slug = 'general')
  and exists (select 1 from profiles where role = 'super_admin');

update public.events
set club_id = (select id from clubs where slug = 'general')
where club_id is null;

-- New events without an explicit club land in General (keeps the current
-- "anyone can create an event" flow working unchanged until Phase 2 UI).
create function public.default_event_club()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.club_id is null then
    select id into new.club_id from clubs where slug = 'general';
  end if;
  return new;
end $$;

create trigger events_default_club before insert on public.events
for each row execute function public.default_event_club();

-- SECURITY FIX required by the new column: without this, any user could create
-- an event stamped with any club_id ("club spoofing"). Recreated same-name
-- policy preserves the legacy path (General) and adds the club-admin path.
drop policy events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated with check (
    created_by = auth.uid()
    and (
      club_id is null
      or club_id = (select id from clubs where slug = 'general')
      or is_club_admin(club_id)
    )
  );

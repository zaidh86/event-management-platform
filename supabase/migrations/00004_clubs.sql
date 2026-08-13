-- 00004: Clubs layer (ADR-0001). Additive only; General club absorbs legacy events in 00005.

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  logo_url text,
  banner_url text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger clubs_touch before update on public.clubs
for each row execute function public.touch_updated_at();

create table public.club_members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('club_admin', 'member')),
  created_at timestamptz not null default now(),
  unique (club_id, user_id)
);

create index club_members_user_idx on public.club_members (user_id, club_id);
create index club_members_club_idx on public.club_members (club_id, role);

-- helper predicates, mirroring is_event_member / has_event_role conventions
create function public.is_club_member(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_members where club_id = p_club_id and user_id = auth.uid());
$$;

create function public.is_club_admin(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1 from club_members
    where club_id = p_club_id and user_id = auth.uid() and role = 'club_admin'
  );
$$;

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;

-- clubs: directory readable by all signed-in users; created by platform admins;
-- edited by that club's admins; no DELETE policy (archive semantics, ADR-0001).
create policy clubs_select on public.clubs
  for select to authenticated using (true);
create policy clubs_insert on public.clubs
  for insert to authenticated with check (is_super_admin());
create policy clubs_update on public.clubs
  for update to authenticated using (is_club_admin(id)) with check (is_club_admin(id));

create policy club_members_select on public.club_members
  for select to authenticated using (is_club_member(club_id) or is_super_admin());
create policy club_members_insert on public.club_members
  for insert to authenticated with check (is_club_admin(club_id));
create policy club_members_update on public.club_members
  for update to authenticated using (is_club_admin(club_id));
create policy club_members_delete on public.club_members
  for delete to authenticated using (is_club_admin(club_id));

-- Seed the General club (idempotent; skipped on a fresh DB with no admin yet —
-- 00005 repeats this insert and its default-club trigger covers late creation).
insert into public.clubs (slug, name, description, created_by)
select 'general', 'General', 'Default club for platform-wide and legacy events.',
       (select id from profiles where role = 'super_admin' order by created_at limit 1)
where not exists (select 1 from clubs where slug = 'general')
  and exists (select 1 from profiles where role = 'super_admin');

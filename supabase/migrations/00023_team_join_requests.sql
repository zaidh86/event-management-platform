-- 00023: team join requests — approval workflow replaces immediate joining.
--
-- Before: a team-mode participant pressed "Join" and join_team() placed them
-- in the team at once (00012). Wrong-team accidents were one tap away.
--
-- After: the participant REQUESTS; the team's creator (teams.created_by — the
-- only leader notion this schema has) accepts or declines. Membership is still
-- exactly what it always was — participants.team_id — written by ONE new
-- place (respond_team_join_request) with the SAME checks join_team made, all
-- re-evaluated at the moment of acceptance under a row lock on the team:
-- event active, requester still registered in team mode and still teamless,
-- team still below team_size_max. A request records intent; it never creates
-- membership, never allocates a table (00022's trigger fires on teams
-- inserts / solo registrations only — an accepted member shares the team's
-- existing row through teams.id, unchanged).
--
--   * team_join_requests — one row per request; the requester's display name
--     is snapshotted because participants_select (00001) does not let a
--     leader read a stranger's row, and the leader must see who is asking.
--   * ONE pending request per (team, participant) — partial unique index.
--     A participant may have pending requests to several teams; acceptance
--     by one declines the others automatically.
--   * RLS: requester, the team's creator, and Event Managers read; nobody
--     writes directly — all writes go through the three RPCs below.
--   * join_team(): EXECUTE revoked from authenticated — the only client grant
--     it has (live ACL: postgres + authenticated). The function body is
--     untouched and the owner can still call it, but a raw RPC call can no
--     longer bypass approval. create_team() is unchanged.
--
-- Additive; 00001–00022 untouched. Rollback notes at the end.

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  display_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index team_join_requests_one_pending
  on public.team_join_requests (team_id, participant_id) where status = 'pending';
create index team_join_requests_team_idx on public.team_join_requests (team_id, status);
create index team_join_requests_participant_idx on public.team_join_requests (participant_id);
create index team_join_requests_event_idx on public.team_join_requests (event_id);

create trigger team_join_requests_touch before update on public.team_join_requests
for each row execute function public.touch_updated_at();

alter table public.team_join_requests enable row level security;

-- the requester sees their own; the team's creator sees requests to their
-- team; Event Managers see everything in the event
create policy team_join_requests_select on public.team_join_requests
  for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from teams t where t.id = team_id and t.created_by = auth.uid())
    or can_manage_event(event_id)
  );

-- no insert/update/delete grant: writes only via the SECURITY DEFINER RPCs
grant select on public.team_join_requests to authenticated;
grant select, insert, update, delete on public.team_join_requests to service_role;

-- realtime: the requester's dashboard reacts when the leader decides
alter publication supabase_realtime add table public.team_join_requests;

-- ── request ──────────────────────────────────────────────────────────────────
-- Same eligibility gate join_team applied, evaluated up front so a participant
-- cannot even queue a request they could never be accepted on. Capacity is
-- NOT checked here beyond "not already full" — the binding check is at
-- acceptance.
create function public.request_team_join(p_team_id uuid)
returns public.team_join_requests
language plpgsql security definer set search_path = public as $$
declare
  v_team teams%rowtype;
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_req team_join_requests%rowtype;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_team from teams where id = p_team_id;
  if not found then
    raise exception 'Team not found';
  end if;
  select * into v_ev from events where id = v_team.event_id;
  if v_ev.status <> 'active' then
    raise exception 'Event is not active';
  end if;
  select * into v_p from participants where event_id = v_team.event_id and user_id = auth.uid();
  if not found then
    raise exception 'Register for the event before requesting to join a team';
  end if;
  if v_p.participation_mode <> 'team' then
    raise exception 'You registered as a solo participant — team features are not available';
  end if;
  if v_p.team_id is not null then
    raise exception 'You are already in a team';
  end if;
  select count(*) into v_count from participants where team_id = p_team_id;
  if v_count >= v_ev.team_size_max then
    raise exception 'Team is full (max % members)', v_ev.team_size_max;
  end if;

  -- one pending request per team per participant: return the existing one
  -- rather than failing, so a double tap is harmless
  select * into v_req from team_join_requests
  where team_id = p_team_id and participant_id = v_p.id and status = 'pending';
  if found then
    return v_req;
  end if;

  insert into team_join_requests (event_id, team_id, participant_id, user_id, display_name)
  values (v_ev.id, v_team.id, v_p.id, v_p.user_id, v_p.display_name)
  returning * into v_req;
  return v_req;
end $$;

revoke all on function public.request_team_join(uuid) from public, anon;
grant execute on function public.request_team_join(uuid) to authenticated, service_role;

-- ── decide ───────────────────────────────────────────────────────────────────
-- Only the team's creator or an Event Manager may decide. On accept, every
-- join_team precondition is re-checked under `teams ... for update`, so two
-- acceptances racing for the last seat serialize and the second one fails
-- with "Team is full" — the request is then left pending for the leader to
-- decline explicitly (nothing silent).
create function public.respond_team_join_request(p_request_id uuid, p_accept boolean)
returns public.team_join_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req team_join_requests%rowtype;
  v_team teams%rowtype;
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_req from team_join_requests where id = p_request_id for update;
  if not found then
    raise exception 'Join request not found';
  end if;
  -- lock the team row: serializes concurrent acceptances against the size limit
  select * into v_team from teams where id = v_req.team_id for update;
  if not found then
    raise exception 'Team no longer exists';
  end if;
  if v_team.created_by <> auth.uid() and not can_manage_event(v_req.event_id) then
    raise exception 'Only the team leader can accept or decline join requests';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been %', v_req.status;
  end if;

  if not coalesce(p_accept, false) then
    update team_join_requests
    set status = 'declined', decided_by = auth.uid(), decided_at = now()
    where id = v_req.id
    returning * into v_req;
    return v_req;
  end if;

  -- ACCEPT: everything join_team checked, re-evaluated NOW
  select * into v_ev from events where id = v_req.event_id;
  if v_ev.status <> 'active' then
    raise exception 'Event is not active';
  end if;
  select * into v_p from participants where id = v_req.participant_id;
  if not found then
    raise exception 'The requester is no longer registered for this event';
  end if;
  if v_p.participation_mode <> 'team' then
    raise exception 'The requester is registered as a solo participant';
  end if;
  if v_p.team_id is not null then
    raise exception 'The requester has already joined a team';
  end if;
  select count(*) into v_count from participants where team_id = v_team.id;
  if v_count >= v_ev.team_size_max then
    raise exception 'Team is full (max % members)', v_ev.team_size_max;
  end if;

  -- the ONLY membership write: same column join_team wrote
  update participants set team_id = v_team.id where id = v_p.id;

  update team_join_requests
  set status = 'accepted', decided_by = auth.uid(), decided_at = now()
  where id = v_req.id
  returning * into v_req;

  -- their other pending requests are moot now
  update team_join_requests
  set status = 'declined', decided_by = auth.uid(), decided_at = now()
  where participant_id = v_p.id and status = 'pending' and id <> v_req.id;

  return v_req;
end $$;

revoke all on function public.respond_team_join_request(uuid, boolean) from public, anon;
grant execute on function public.respond_team_join_request(uuid, boolean) to authenticated, service_role;

-- ── withdraw ─────────────────────────────────────────────────────────────────
create function public.withdraw_team_join_request(p_request_id uuid)
returns public.team_join_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req team_join_requests%rowtype;
begin
  select * into v_req from team_join_requests where id = p_request_id for update;
  if not found or v_req.user_id <> auth.uid() then
    raise exception 'Join request not found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'This request has already been %', v_req.status;
  end if;
  update team_join_requests
  set status = 'withdrawn', decided_by = auth.uid(), decided_at = now()
  where id = v_req.id
  returning * into v_req;
  return v_req;
end $$;

revoke all on function public.withdraw_team_join_request(uuid) from public, anon;
grant execute on function public.withdraw_team_join_request(uuid) to authenticated, service_role;

-- ── close the immediate-join path ────────────────────────────────────────────
-- Body untouched; only clients lose it (the owner retains EXECUTE).
revoke execute on function public.join_team(uuid) from authenticated;

-- ============================================================================
-- Rollback:
--   grant execute on function public.join_team(uuid) to authenticated;
--   drop function public.withdraw_team_join_request(uuid);
--   drop function public.respond_team_join_request(uuid, boolean);
--   drop function public.request_team_join(uuid);
--   alter publication supabase_realtime drop table public.team_join_requests;
--   drop table public.team_join_requests;
-- ============================================================================

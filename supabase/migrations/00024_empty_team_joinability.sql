-- 00024: empty teams are not joinable.
--
-- A team whose every member was removed (00021 deliberately preserves the
-- team row, its account, submission, QR and certificates — cleanup is an
-- organizer decision) kept appearing in the participant join picker, and
-- nothing stopped a request to it or an acceptance into it: the old creator,
-- no longer a participant, still matched teams.created_by.
--
-- Fix, without touching any policy or deleting anything:
--
--   1. list_joinable_teams(event) — a SECURITY DEFINER read for the PARTICIPANT
--      picker only: teams of the event that currently have ≥ 1 member and are
--      below team_size_max, with the member count. Needed server-side because
--      participants_select (00001) rightly hides other teams' members from a
--      teamless participant, so the client cannot count. Organizer surfaces
--      keep reading the teams table through the unchanged teams_select policy
--      and therefore still see (and can manage) empty teams.
--
--   2. request_team_join / respond_team_join_request (00023) are replaced
--      body-only (same signatures → grants preserved) with ONE added rule:
--      the team must currently have at least one member — checked when the
--      request is made AND re-checked at acceptance under the existing team
--      row lock. Everything else in those functions is unchanged.
--
-- create_team (00012) is untouched: it makes the creator a member in the same
-- transaction, so a new team is never observed empty.
--
-- Additive; 00001–00023 untouched. Rollback notes at the end.

-- ============================================================================
-- 1. list_joinable_teams
-- ============================================================================

create function public.list_joinable_teams(p_event_id uuid)
returns table (
  id uuid,
  event_id uuid,
  name text,
  member_count int,
  team_size_max int,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  -- the same audience teams_select admits: members of the event (participants
  -- included) and platform admins; Event Managers are members or admins too
  if not is_event_member(p_event_id) and not can_manage_event(p_event_id) then
    raise exception 'Only event members can list teams';
  end if;

  return query
  select t.id, t.event_id, t.name,
         count(p.id)::int as member_count,
         e.team_size_max,
         t.created_at
  from teams t
  join events e on e.id = t.event_id
  left join participants p on p.team_id = t.id
  where t.event_id = p_event_id
  group by t.id, t.event_id, t.name, e.team_size_max, t.created_at
  having count(p.id) > 0 and count(p.id) < e.team_size_max
  order by t.name;
end $$;

revoke all on function public.list_joinable_teams(uuid) from public, anon;
grant execute on function public.list_joinable_teams(uuid) to authenticated, service_role;

-- ============================================================================
-- 2. request_team_join — body-only replacement (00023 + empty-team rule)
-- ============================================================================

create or replace function public.request_team_join(p_team_id uuid)
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
  -- 00024: an emptied team is not joinable (its row is kept for organizers)
  if v_count = 0 then
    raise exception 'This team has no members and cannot be joined';
  end if;
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

-- ============================================================================
-- 3. respond_team_join_request — body-only replacement (00023 + empty-team rule)
-- ============================================================================

create or replace function public.respond_team_join_request(p_request_id uuid, p_accept boolean)
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
  -- 00024: an emptied team cannot be revived through a pending request —
  -- not even by its original creator, who is no longer a participant
  if v_count = 0 then
    raise exception 'This team has no members and cannot accept new members';
  end if;
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

-- Signatures unchanged, so the 00023 grants (authenticated, service_role;
-- public/anon revoked) carry over — nothing to re-issue.

-- ============================================================================
-- Rollback:
--   drop function public.list_joinable_teams(uuid);
--   -- recreate the 00023 bodies of request_team_join / respond_team_join_request
--   -- verbatim (same signatures; grants unaffected)
-- ============================================================================

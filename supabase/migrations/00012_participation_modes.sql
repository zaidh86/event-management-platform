-- 00012: participation modes (ADR-0007).
--
-- An event configures which participation modes are AVAILABLE — solo, team, or
-- both — while each participant's CHOSEN mode is persisted on their registration
-- row and becomes the source of truth for their dashboard, their account and QR
-- routing. "The event supports teams" and "this participant chose team" are now
-- distinct facts.
--
-- Availability lives in the existing capabilities jsonb: the existing 'teams'
-- key plus a new 'solo' key. events.is_team_event is RETAINED as the
-- team-mechanics switch (team sizes, create_team) — for legacy rows it also
-- drives the fallbacks below, so pre-00012 behavior is preserved exactly:
--   is_team_event = false  ->  solo-only,  participants backfilled 'solo'
--   is_team_event = true   ->  team-only,  participants backfilled 'team'
-- Solo+Team is only expressible by new/edited configuration, never by guessing.
--
-- NOTE on numbering: earlier docs reserved 00012 for the events.club_id NOT NULL
-- wave; that deferred wave renumbers to 00013 (still requires its own approval).
--
-- Additive throughout; 00001-00011 untouched. Rollback notes at the end.

-- ── 1. The participant's chosen mode. Default 'solo' covers legacy solo events;
--       the backfill flips participants of team events to 'team'.
alter table public.participants
  add column participation_mode text not null default 'solo'
  check (participation_mode in ('solo', 'team'));

update public.participants p
set participation_mode = 'team'
from public.events e
where e.id = p.event_id and e.is_team_event;

-- ── 2. Availability: existing rows gain an explicit 'solo' key mirroring their
--       legacy semantics; the column default gains "solo": false. The RPCs below
--       treat is_team_event as authoritative for team mechanics, so an insert
--       relying on this default keeps its pre-00012 format semantics.
update public.events
set capabilities = jsonb_set(capabilities, '{solo}', to_jsonb(not is_team_event))
where not (capabilities ? 'solo');

alter table public.events alter column capabilities set default '{
  "solo": false, "teams": true, "points": true, "qr": true,
  "attendance": false, "submissions": false, "judging": false,
  "deadlines": false, "feedback": false, "certificates": false,
  "games_api": true
}'::jsonb;

-- ── 3. register_for_event now receives the chosen mode explicitly and validates
--       it against the event's availability. The 3-parameter signature is
--       DROPPED rather than replaced: CREATE OR REPLACE cannot change a
--       signature, and keeping both overloads would make PostgREST
--       named-argument calls ambiguous (PGRST203).
drop function public.register_for_event(uuid, text, jsonb);

create function public.register_for_event(
  p_event_id uuid,
  p_display_name text,
  p_registration_data jsonb default '{}',
  p_participation_mode text default null
) returns public.participants
language plpgsql security definer set search_path = public as $$
declare
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_acc_id uuid;
  v_solo boolean;
  v_team boolean;
  v_mode text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_ev from events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;
  if v_ev.status <> 'active' then
    raise exception 'Registration is not open for this event';
  end if;
  if exists (select 1 from participants where event_id = p_event_id and user_id = auth.uid()) then
    raise exception 'Already registered for this event';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'Display name is required';
  end if;

  -- availability, with legacy fallbacks for pre-00012 rows. is_team_event is
  -- authoritative for team MECHANICS: a row whose capabilities claim teams but
  -- whose format was never configured for them (e.g. an insert relying on the
  -- column default with is_team_event = false) must not become team-only.
  v_team := v_ev.is_team_event and coalesce((v_ev.capabilities ->> 'teams')::boolean, true);
  v_solo := case when v_ev.capabilities ? 'solo'
                 then coalesce((v_ev.capabilities ->> 'solo')::boolean, false)
                 else not v_ev.is_team_event end;
  -- consistency net: when capabilities and format disagree so hard that nothing
  -- is available, fall back to the pre-00012 format semantics
  if not coalesce(v_solo, false) and not coalesce(v_team, false) then
    v_solo := not v_ev.is_team_event;
    v_team := v_ev.is_team_event;
  end if;

  -- resolve the chosen mode: explicit always wins; auto-selection is allowed
  -- only when exactly one mode is available (the choice must still be stored)
  v_mode := nullif(trim(coalesce(p_participation_mode, '')), '');
  if v_mode is null then
    if v_solo and v_team then
      raise exception 'Choose how you want to participate: solo or team';
    end if;
    v_mode := case when v_team then 'team' else 'solo' end;
  end if;
  if v_mode not in ('solo', 'team') then
    raise exception 'Invalid participation mode "%"', v_mode;
  end if;
  if v_mode = 'solo' and not v_solo then
    raise exception 'This event does not support solo participation';
  end if;
  if v_mode = 'team' and not v_team then
    raise exception 'This event does not support team participation';
  end if;

  insert into participants (event_id, user_id, display_name, registration_data, participation_mode)
  values (p_event_id, auth.uid(), trim(p_display_name),
          coalesce(p_registration_data, '{}'::jsonb), v_mode)
  returning * into v_p;

  insert into event_members (event_id, user_id, role)
  values (p_event_id, auth.uid(), 'participant')
  on conflict (event_id, user_id) do nothing;

  -- solo participants hold their own account; team participants share their
  -- team's account (created by create_team), regardless of the event's format
  if v_mode = 'solo' then
    insert into accounts (event_id, owner_type, owner_id)
    values (p_event_id, 'participant', v_p.id)
    returning id into v_acc_id;
    if v_ev.starting_balance <> 0 then
      perform _apply_transaction(v_acc_id, v_ev.starting_balance, 'starting_balance',
                                 null, 'Starting balance', '{}'::jsonb, null, 'system');
    end if;
  end if;

  return v_p;
end $$;

-- DROP removed the old signature's grants; restore the 00002 convention.
revoke all on function public.register_for_event(uuid, text, jsonb, text) from public, anon;
grant execute on function public.register_for_event(uuid, text, jsonb, text) to authenticated;

-- ── 4. Team RPCs enforce the chosen mode: a solo registrant stays solo even via
--       raw RPC calls. Signatures unchanged, so existing grants are preserved.
create or replace function public.create_team(p_event_id uuid, p_name text)
returns public.teams
language plpgsql security definer set search_path = public as $$
declare
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_team teams%rowtype;
  v_acc_id uuid;
  v_teams_available boolean;
begin
  select * into v_ev from events where id = p_event_id;
  -- both the capability AND the configured team format are required: this keeps
  -- 00001's is_team_event gate, so a default-capabilities row with
  -- is_team_event = false cannot grow ghost teams with unconfigured size bounds
  v_teams_available := v_ev.is_team_event
    and coalesce((v_ev.capabilities ->> 'teams')::boolean, true);
  if not found or not coalesce(v_teams_available, false) then
    raise exception 'This event does not support teams';
  end if;
  if v_ev.status <> 'active' then
    raise exception 'Event is not active';
  end if;
  select * into v_p from participants where event_id = p_event_id and user_id = auth.uid();
  if not found then
    raise exception 'Register for the event before creating a team';
  end if;
  if v_p.participation_mode <> 'team' then
    raise exception 'You registered as a solo participant — team features are not available';
  end if;
  if v_p.team_id is not null then
    raise exception 'You are already in a team';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Team name is required';
  end if;

  insert into teams (event_id, name, created_by)
  values (p_event_id, trim(p_name), auth.uid())
  returning * into v_team;

  insert into accounts (event_id, owner_type, owner_id)
  values (p_event_id, 'team', v_team.id)
  returning id into v_acc_id;
  if v_ev.starting_balance <> 0 then
    perform _apply_transaction(v_acc_id, v_ev.starting_balance, 'starting_balance',
                               null, 'Starting balance', '{}'::jsonb, null, 'system');
  end if;

  update participants set team_id = v_team.id where id = v_p.id;
  return v_team;
end $$;

create or replace function public.join_team(p_team_id uuid)
returns public.teams
language plpgsql security definer set search_path = public as $$
declare
  v_team teams%rowtype;
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_count int;
begin
  -- lock the team row to serialize concurrent joins against the size limit
  select * into v_team from teams where id = p_team_id for update;
  if not found then
    raise exception 'Team not found';
  end if;
  select * into v_ev from events where id = v_team.event_id;
  if v_ev.status <> 'active' then
    raise exception 'Event is not active';
  end if;
  select * into v_p from participants where event_id = v_team.event_id and user_id = auth.uid();
  if not found then
    raise exception 'Register for the event before joining a team';
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

  update participants set team_id = p_team_id where id = v_p.id;
  return v_team;
end $$;

-- ── 5. resolve_qr routes by the PARTICIPANT'S mode, not the event's format:
--       in a solo+team event a solo participant has a personal account.
--       (Legacy rows were backfilled in step 1, so behavior is identical for
--       pre-00012 events.) Signature unchanged; grants preserved.
create or replace function public.resolve_qr(p_qr_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_p participants%rowtype;
  v_team teams%rowtype;
  v_acc accounts%rowtype;
begin
  select * into v_p from participants where qr_token = p_qr_token;
  if found then
    if auth.uid() is not null
       and not has_event_role(v_p.event_id, array['organizer', 'activity_admin', 'volunteer']) then
      raise exception 'Not authorized to scan for this event';
    end if;
    -- team-mode participants: points live on the team account
    if v_p.participation_mode = 'team' then
      if v_p.team_id is null then
        raise exception 'Participant has no team yet';
      end if;
      select * into v_team from teams where id = v_p.team_id;
      select * into v_acc from accounts where owner_type = 'team' and owner_id = v_team.id;
      return jsonb_build_object(
        'kind', 'team', 'event_id', v_p.event_id,
        'participant_id', v_p.id, 'participant_name', v_p.display_name,
        'team_id', v_team.id, 'name', v_team.name,
        'account_id', v_acc.id, 'balance', v_acc.balance
      );
    end if;
    select * into v_acc from accounts where owner_type = 'participant' and owner_id = v_p.id;
    return jsonb_build_object(
      'kind', 'participant', 'event_id', v_p.event_id,
      'participant_id', v_p.id, 'name', v_p.display_name,
      'account_id', v_acc.id, 'balance', v_acc.balance
    );
  end if;

  select * into v_team from teams where qr_token = p_qr_token;
  if found then
    if auth.uid() is not null
       and not has_event_role(v_team.event_id, array['organizer', 'activity_admin', 'volunteer']) then
      raise exception 'Not authorized to scan for this event';
    end if;
    select * into v_acc from accounts where owner_type = 'team' and owner_id = v_team.id;
    return jsonb_build_object(
      'kind', 'team', 'event_id', v_team.event_id,
      'team_id', v_team.id, 'name', v_team.name,
      'account_id', v_acc.id, 'balance', v_acc.balance
    );
  end if;

  raise exception 'Unknown QR code';
end $$;

-- ── 6. Hardening: participation_mode, team_id and qr_token change only through
--       the SECURITY DEFINER RPCs (which run as the table owner and are not
--       constrained by column grants). The table-wide UPDATE privilege becomes a
--       column list — this also closes the pre-existing path where a participant
--       could write their own team_id directly, skipping join_team's size and
--       mode checks. participants_update_own RLS keeps scoping rows; this scopes
--       columns. No client code updates participants directly (verified).
revoke update on public.participants from authenticated;
grant update (display_name, registration_data) on public.participants to authenticated;

-- Rollback:
--   revoke update (display_name, registration_data) on public.participants from authenticated;
--   grant update on public.participants to authenticated;
--   drop function public.register_for_event(uuid, text, jsonb, text);
--   -- recreate the 00001 versions of register_for_event(uuid,text,jsonb),
--   -- create_team, join_team, resolve_qr verbatim, then re-run 00002's grants
--   -- for register_for_event(uuid,text,jsonb);
--   alter table public.events alter column capabilities set default '{
--     "teams": true, "points": true, "qr": true, "attendance": false,
--     "submissions": false, "judging": false, "deadlines": false,
--     "feedback": false, "certificates": false, "games_api": true}'::jsonb;
--   update public.events set capabilities = capabilities - 'solo';
--   alter table public.participants drop column participation_mode;

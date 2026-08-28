-- 00026: registration deadline.
--
-- An OPTIONAL per-event cut-off for joining. Two pieces, both additive:
--
--   1. events.registration_deadline timestamptz NULL — a real column rather
--      than another key inside a jsonb config, because it is a first-class
--      instant the database itself compares against now(). NULL (the default
--      for every existing row) means "no deadline": registration keeps behaving
--      exactly as it does today, so this migration is backward-compatible with
--      every event already in the table.
--
--   2. register_for_event() gains ONE condition. It is the sole writer of
--      participants rows -- clients hold no INSERT grant on that table
--      (00003:22 "insert via register_for_event RPC", and 00012:305 narrows
--      client UPDATE to display_name/registration_data) -- so a check here
--      closes every registration path: the UI, a stale tab, a direct PostgREST
--      call, or anything else invoking the RPC by hand. The frontend countdown
--      and disabled button are UX only; this is the enforcement.
--
--      The body below is 00012's verbatim, with only the deadline check added
--      after the existing status check. Signature is unchanged, so the 00012
--      grants (authenticated; public/anon revoked) carry over untouched and no
--      PostgREST overload can appear (PGRST203). Every existing rule -- event
--      active, duplicate registration, display name, participation-mode
--      availability, account/starting-balance creation -- is preserved exactly.
--
-- Timezone: the column is timestamptz and the comparison uses now(), so the
-- deadline is a single absolute instant. Nothing here depends on the browser's
-- or the server's local zone.
--
-- Additive; 00001-00025 untouched. Rollback notes at the end.

-- ============================================================================
-- 1. THE COLUMN
-- ============================================================================

alter table public.events
  add column registration_deadline timestamptz;

comment on column public.events.registration_deadline is
  'Optional instant after which register_for_event() refuses new registrations. NULL = no deadline.';

-- ============================================================================
-- 2. register_for_event -- 00012 body + the deadline condition
-- ============================================================================

create or replace function public.register_for_event(
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
  -- 00026: the registration deadline, evaluated against the database clock.
  -- NULL means "no deadline" and leaves every pre-00026 event behaving exactly
  -- as before. now() and the column are both timestamptz, so this is an
  -- absolute-instant comparison with no timezone assumptions.
  if v_ev.registration_deadline is not null and now() >= v_ev.registration_deadline then
    raise exception 'Registration has ended for this event';
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

-- Signature unchanged: the 00012 grants still apply, nothing to re-issue.

-- ============================================================================
-- Rollback:
--   -- restore the 00012 body verbatim (same signature, grants unaffected),
--   -- i.e. re-run 00012's create function block without the deadline check
--   alter table public.events drop column registration_deadline;
-- ============================================================================

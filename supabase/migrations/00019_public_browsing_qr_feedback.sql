-- 00019: Informatique Exhib priority pass — public-first browsing, club
-- departments, universal QR scanner roles/actions, per-target feedback.
--
-- Four focused changes, all reusing existing architecture:
--
--   1. PUBLIC-FIRST BROWSING — anonymous visitors may browse the club
--      directory and non-draft events (Browse → Discover → Decide →
--      Authenticate). New anon SELECT surface on clubs + a broader anon
--      events policy (active/ended only; drafts and archived stay hidden).
--      Nothing about authenticated access changes; write surfaces unchanged.
--
--   2. clubs.department — concise club identity for listings ("Department of
--      Computer Science"). The existing description remains the description.
--
--   3. UNIVERSAL QR OPERATIONS — the EXISTING event-scoped judge role
--      (00016) becomes a valid scanner role, and 'feedback' becomes a valid
--      configured action on participant/team targets (a station scan can
--      open the configured feedback form pre-bound to the scanned target).
--      One QR architecture; no parallel systems; perform_scan is replaced
--      body-only (same signature, grants preserved).
--
--   4. PER-TARGET FEEDBACK — one response per user PER TARGET (team /
--      participant / the event itself), not one per user total.
--      feedback_responses gains target columns; submit_feedback gains target
--      parameters (old 2-arg signature DROPPED to avoid PGRST203 overload
--      ambiguity, grants re-issued per the 00012 convention). Dedupe stays
--      constraint-backed via the existing (form_id, dedupe_key) UNIQUE:
--        event target  -> dedupe_key = auth.uid()          (legacy-compatible)
--        team/participant target -> dedupe_key = md5(uid || target)::uuid
--      Anonymous responses keep the existing behavior (random key — cannot
--      be attributed, so cannot be target-deduped; documented in ADR-0009/12).
--
-- Additive; 00001-00018 untouched. Rollback notes at the end.

-- ============================================================================
-- 1. PUBLIC-FIRST BROWSING
-- ============================================================================

-- club directory is public information (name, department, description, branding)
grant select on public.clubs to anon;
create policy clubs_select_public on public.clubs
  for select to anon using (true);

-- anonymous event browsing: active and ended events are publicly visible;
-- drafts and archived remain hidden. The 00001 public_leaderboard policy
-- stays (it also matters for accounts_select_public); this one supersedes it
-- in breadth for the events table itself.
create policy events_select_anon_browse on public.events
  for select to anon using (status in ('active', 'ended'));

-- ============================================================================
-- 2. CLUB DEPARTMENT
-- ============================================================================

alter table public.clubs add column department text not null default '';

-- ============================================================================
-- 3. UNIVERSAL QR OPERATIONS: judge scanner role + feedback action
-- ============================================================================

alter table public.qr_configs drop constraint qr_configs_scanner_access_valid;
alter table public.qr_configs add constraint qr_configs_scanner_access_valid check (
  scanner_access <@ array['organizer', 'activity_admin', 'volunteer', 'judge', 'participant', 'public']::text[]
  and cardinality(scanner_access) > 0
);

alter table public.qr_configs drop constraint qr_configs_actions_valid;
alter table public.qr_configs add constraint qr_configs_actions_valid check (
  case target
    when 'participant' then actions <@ array['attendance', 'scoring', 'verification', 'feedback']::text[]
    when 'team'        then actions <@ array['scoring', 'verification', 'feedback']::text[]
    when 'event'       then actions <@ array['registration', 'info']::text[]
    when 'feedback'    then actions <@ array['feedback']::text[]
  end
);

-- any config whose actions include 'feedback' must name its form
alter table public.qr_configs drop constraint qr_configs_feedback_form;
alter table public.qr_configs add constraint qr_configs_feedback_form check (
  not ('feedback' = any (actions)) or config ? 'feedback_form_id'
);

-- perform_scan: body-only replacement (signature unchanged; 00014 grants stand).
-- Changes: (a) 'judge' counts as a staff-style scanner role via has_event_role;
-- (b) 'feedback' action resolves the configured form and returns the scanned
-- target so the client opens the form pre-bound — the response itself is then
-- validated/deduplicated by submit_feedback, so a feedback scan is logged as a
-- scan but creates no response by itself.
create or replace function public.perform_scan(
  p_qr_config_id uuid,
  p_qr_token text,
  p_action text,
  p_note text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cfg qr_configs%rowtype;
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_team teams%rowtype;
  v_acc accounts%rowtype;
  v_att attendance%rowtype;
  v_form feedback_forms%rowtype;
  v_scan_id uuid;
  v_staff_roles text[];
  v_authorized boolean;
  v_name text;
  v_target_id uuid;
  v_meta jsonb;
begin
  -- 1) the QR configuration is valid and enabled
  select * into v_cfg from qr_configs where id = p_qr_config_id;
  if not found then
    raise exception 'QR operation not found';
  end if;
  if not v_cfg.is_enabled then
    raise exception 'This QR operation has been disabled';
  end if;
  if v_cfg.target not in ('participant', 'team') then
    raise exception 'This QR operation is not scanned at a station';
  end if;

  -- 2) event context
  select * into v_ev from events where id = v_cfg.event_id;
  if v_ev.status <> 'active' then
    raise exception 'Event is not active';
  end if;

  -- 3) the requested action is one this configuration allows
  if p_action is null or not (p_action = any (v_cfg.actions)) then
    raise exception 'Action "%" is not allowed for this QR operation', coalesce(p_action, '');
  end if;

  -- 4) scanner authorization: config-driven, never client-claimed. 'judge' is
  --    the existing event role (00016) — has_event_role covers it directly.
  v_authorized := coalesce(auth.role(), '') = 'service_role' or is_super_admin();
  if not v_authorized then
    if auth.uid() is null then
      raise exception 'Sign in to perform this operation';
    end if;
    v_staff_roles := array(select r from unnest(v_cfg.scanner_access) r
                           where r in ('organizer', 'activity_admin', 'volunteer', 'judge'));
    v_authorized :=
      (cardinality(v_staff_roles) > 0 and has_event_role(v_cfg.event_id, v_staff_roles))
      or ('participant' = any (v_cfg.scanner_access) and is_event_member(v_cfg.event_id));
  end if;
  if not v_authorized then
    raise exception 'You are not authorized to perform this operation';
  end if;

  -- 5/6) resolve + validate the target from the opaque token
  if v_cfg.target = 'participant' then
    select * into v_p from participants where qr_token = p_qr_token;
    if not found then
      raise exception 'Unknown QR code';
    end if;
    if v_p.event_id <> v_cfg.event_id then
      raise exception 'That QR code belongs to a different event';
    end if;
    v_name := v_p.display_name;
    v_target_id := v_p.id;
  else
    -- team target: accept the team token, or a team member's personal token
    -- (mirrors resolve_qr's routing by the participant's stored mode, 00012)
    select * into v_team from teams where qr_token = p_qr_token;
    if not found then
      select * into v_p from participants where qr_token = p_qr_token;
      if found and v_p.event_id = v_cfg.event_id
         and v_p.participation_mode = 'team' and v_p.team_id is not null then
        select * into v_team from teams where id = v_p.team_id;
      end if;
    end if;
    if v_team.id is null then
      raise exception 'Unknown QR code';
    end if;
    if v_team.event_id <> v_cfg.event_id then
      raise exception 'That QR code belongs to a different event';
    end if;
    v_name := v_team.name;
    v_target_id := v_team.id;
  end if;

  v_meta := jsonb_strip_nulls(jsonb_build_object(
    'note', nullif(trim(coalesce(p_note, '')), ''),
    'scanned_participant_id', case when v_cfg.target = 'team' then v_p.id end
  ));

  -- 7) action dispatch — duplicate rules are per action, not global
  if p_action = 'attendance' then
    -- once per participant per event; the UNIQUE constraint is the real guard
    begin
      insert into scans (event_id, qr_config_id, target, target_id, action, scanned_by, result, metadata)
      values (v_cfg.event_id, v_cfg.id, v_cfg.target, v_target_id, 'attendance', auth.uid(), 'ok', v_meta)
      returning id into v_scan_id;
      insert into attendance (event_id, participant_id, scan_id, recorded_by)
      values (v_cfg.event_id, v_p.id, v_scan_id, auth.uid())
      returning * into v_att;
    exception when unique_violation then
      select * into v_att from attendance
      where event_id = v_cfg.event_id and participant_id = v_p.id;
      insert into scans (event_id, qr_config_id, target, target_id, action, scanned_by, result, metadata)
      values (v_cfg.event_id, v_cfg.id, v_cfg.target, v_target_id, 'attendance', auth.uid(), 'duplicate', v_meta);
      return jsonb_build_object(
        'status', 'duplicate', 'action', 'attendance',
        'name', v_name, 'participant_id', v_p.id,
        'recorded_at', v_att.created_at
      );
    end;
    return jsonb_build_object(
      'status', 'ok', 'action', 'attendance',
      'name', v_name, 'participant_id', v_p.id,
      'recorded_at', v_att.created_at
    );

  elsif p_action = 'verification' then
    insert into scans (event_id, qr_config_id, target, target_id, action, scanned_by, result, metadata)
    values (v_cfg.event_id, v_cfg.id, v_cfg.target, v_target_id, 'verification', auth.uid(), 'ok', v_meta);
    return jsonb_build_object(
      'status', 'ok', 'action', 'verification',
      'kind', v_cfg.target, 'name', v_name,
      'participant_id', case when v_cfg.target = 'participant' then v_p.id end,
      'team_id', case when v_cfg.target = 'team' then v_team.id end
    );

  elsif p_action = 'scoring' then
    if v_cfg.target = 'participant' and v_p.participation_mode = 'team' then
      if v_p.team_id is null then
        raise exception 'Participant has no team yet';
      end if;
      select * into v_team from teams where id = v_p.team_id;
      select * into v_acc from accounts where owner_type = 'team' and owner_id = v_team.id;
    elsif v_cfg.target = 'participant' then
      select * into v_acc from accounts where owner_type = 'participant' and owner_id = v_p.id;
    else
      select * into v_acc from accounts where owner_type = 'team' and owner_id = v_team.id;
    end if;
    if v_acc.id is null then
      raise exception 'No account found for this target';
    end if;
    insert into scans (event_id, qr_config_id, target, target_id, action, scanned_by, result, metadata)
    values (v_cfg.event_id, v_cfg.id, v_cfg.target, v_target_id, 'scoring', auth.uid(), 'ok', v_meta);
    return jsonb_build_object(
      'status', 'ok', 'action', 'scoring',
      'kind', case when v_acc.owner_type = 'team' then 'team' else 'participant' end,
      'name', case when v_acc.owner_type = 'team' then v_team.name else v_name end,
      'participant_id', v_p.id, 'participant_name', v_p.display_name,
      'team_id', case when v_acc.owner_type = 'team' then v_team.id end,
      'account_id', v_acc.id, 'balance', v_acc.balance
    );

  elsif p_action = 'feedback' then
    -- resolve the configured form; the client opens it pre-bound to the
    -- scanned target. The response itself goes through submit_feedback with
    -- its own validation + per-target dedupe.
    select * into v_form from feedback_forms
    where id = nullif(v_cfg.config ->> 'feedback_form_id', '')::uuid
      and event_id = v_cfg.event_id;
    if v_form.id is null or v_form.status <> 'published' then
      raise exception 'The feedback form for this QR operation is not open';
    end if;
    insert into scans (event_id, qr_config_id, target, target_id, action, scanned_by, result, metadata)
    values (v_cfg.event_id, v_cfg.id, v_cfg.target, v_target_id, 'feedback', auth.uid(), 'ok', v_meta);
    return jsonb_build_object(
      'status', 'ok', 'action', 'feedback',
      'kind', v_cfg.target, 'name', v_name,
      'form_id', v_form.id, 'form_title', v_form.title,
      'participant_id', case when v_cfg.target = 'participant' then v_p.id end,
      'team_id', case when v_cfg.target = 'team' then v_team.id end
    );
  end if;

  raise exception 'Unsupported action "%"', p_action;
end $$;

-- ============================================================================
-- 4. PER-TARGET FEEDBACK
-- ============================================================================

alter table public.feedback_responses
  add column target_type text not null default 'event'
    check (target_type in ('event', 'team', 'participant')),
  add column target_id uuid;

-- the event itself carries no separate target id; entity targets require one
alter table public.feedback_responses
  add constraint feedback_responses_target_shape
  check ((target_type = 'event') = (target_id is null));

create index feedback_responses_target_idx
  on public.feedback_responses (form_id, target_type, target_id);

-- submit_feedback: the 2-arg signature is DROPPED (an overload would make
-- PostgREST named-argument calls ambiguous — PGRST203, same reasoning as
-- 00012's register_for_event) and recreated with target parameters.
drop function public.submit_feedback(uuid, jsonb);

create function public.submit_feedback(
  p_form_id uuid,
  p_answers jsonb,
  p_target_type text default 'event',
  p_target_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_form feedback_forms%rowtype;
  v_ev events%rowtype;
  v_q jsonb;
  v_ans jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_dedupe uuid;
  v_target_name text;
begin
  select * into v_form from feedback_forms where id = p_form_id;
  if not found or v_form.status <> 'published' then
    raise exception 'This feedback form is not open';
  end if;
  select * into v_ev from events where id = v_form.event_id;
  if v_ev.status = 'archived' then
    raise exception 'This event is no longer accepting feedback';
  end if;

  if v_form.access = 'participants' then
    if auth.uid() is null then
      raise exception 'Sign in to submit this feedback form';
    end if;
    if not is_event_member(v_ev.id) and not is_super_admin() then
      raise exception 'This feedback form is only open to event participants';
    end if;
  end if;

  -- target: what this response is ABOUT. Must belong to the form's event.
  if p_target_type not in ('event', 'team', 'participant') then
    raise exception 'Invalid feedback target';
  end if;
  if p_target_type = 'event' then
    if p_target_id is not null then
      raise exception 'Invalid feedback target';
    end if;
  elsif p_target_type = 'team' then
    select t.name into v_target_name from teams t
    where t.id = p_target_id and t.event_id = v_ev.id;
    if v_target_name is null then
      raise exception 'Feedback target not found in this event';
    end if;
  else
    select p.display_name into v_target_name from participants p
    where p.id = p_target_id and p.event_id = v_ev.id;
    if v_target_name is null then
      raise exception 'Feedback target not found in this event';
    end if;
  end if;

  -- validate required questions; keep only answers to known questions
  for v_q in select * from jsonb_array_elements(v_form.questions) loop
    v_ans := p_answers -> (v_q ->> 'key');
    if coalesce((v_q ->> 'required')::boolean, false) then
      if v_ans is null or v_ans = 'null'::jsonb
         or (jsonb_typeof(v_ans) = 'string' and trim(v_ans #>> '{}') = '')
         or (jsonb_typeof(v_ans) = 'array' and jsonb_array_length(v_ans) = 0) then
        raise exception '"%" is required', v_q ->> 'label';
      end if;
    end if;
    if v_ans is not null and v_ans <> 'null'::jsonb then
      v_clean := v_clean || jsonb_build_object(v_q ->> 'key', v_ans);
    end if;
  end loop;

  -- dedupe is per RESPONDENT per TARGET, enforced by the existing
  -- (form_id, dedupe_key) UNIQUE:
  --   event target -> auth.uid() verbatim (identical to pre-00019 keys, so
  --                   existing responses keep deduplicating correctly)
  --   entity target -> deterministic uuid derived from (uid, target)
  --   anonymous     -> random (cannot be attributed; unchanged behavior)
  v_dedupe := case
    when not v_form.one_response_per_user or auth.uid() is null then gen_random_uuid()
    when p_target_type = 'event' then auth.uid()
    else md5(auth.uid()::text || ':' || p_target_id::text)::uuid
  end;

  begin
    insert into feedback_responses (form_id, event_id, respondent_id, dedupe_key,
                                    answers, target_type, target_id)
    values (p_form_id, v_ev.id, auth.uid(), v_dedupe, v_clean, p_target_type, p_target_id);
  exception when unique_violation then
    return jsonb_build_object(
      'status', 'duplicate',
      'message', case when v_target_name is null
        then 'You have already submitted this feedback form'
        else format('You have already submitted feedback for %s', v_target_name) end
    );
  end;

  return jsonb_build_object('status', 'ok');
end $$;

-- DROP removed the old signature's grants; restore the 00014 posture.
revoke all on function public.submit_feedback(uuid, jsonb, text, uuid) from public;
grant execute on function public.submit_feedback(uuid, jsonb, text, uuid) to anon, authenticated, service_role;

-- ============================================================================
-- Rollback:
--   drop function public.submit_feedback(uuid, jsonb, text, uuid);
--   -- recreate the 00014 submit_feedback(uuid, jsonb) verbatim + its grants
--   alter table public.feedback_responses drop constraint feedback_responses_target_shape;
--   alter table public.feedback_responses drop column target_type, drop column target_id;
--   -- recreate the 00014 perform_scan verbatim (grants unchanged)
--   -- restore the 00014 qr_configs constraints (without 'judge'/'feedback')
--   alter table public.clubs drop column department;
--   drop policy events_select_anon_browse on public.events;
--   drop policy clubs_select_public on public.clubs;
--   revoke select on public.clubs from anon;
-- ============================================================================

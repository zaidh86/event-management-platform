-- 00014: universal QR + event operations (ADR-0009).
--
-- QR stops meaning exactly "participant QR + team QR". An Event Manager now
-- configures QR OPERATIONS per event (qr_configs): each has a label, a purpose,
-- a target (participant / team / event / feedback), a set of allowed actions,
-- and who may scan it. The existing opaque tokens are UNCHANGED and remain the
-- physical QR payloads:
--   participant/team targets -> the existing p_/t_ tokens (one physical token,
--                               many configured purposes; nothing re-issued)
--   event/feedback targets   -> the config's own q_ token (poster/venue QR)
-- resolve_qr (00001/00012) is untouched — the Games API and the legacy scoring
-- station keep working exactly as before.
--
-- New server-side surfaces, all SECURITY DEFINER with their own authorization
-- (the frontend is never trusted):
--   perform_scan       staff/authorized station scan -> validate config, event,
--                      action, scanner, target; record in the scans ledger;
--                      attendance is deduplicated by a UNIQUE constraint
--   resolve_public_qr  anon-safe resolution of event/feedback q_ tokens
--   submit_feedback    validated feedback submission with per-form dedupe
--
-- Duplicate policy is ACTION-level, not global: attendance is once-per-event
-- (constraint-backed), verification/scoring may repeat (each scan is logged;
-- scoring amounts still flow only through process_transaction), feedback dedupe
-- follows the form's one_response_per_user flag.
--
-- NOTE on numbering: the deferred events.club_id NOT NULL wave renumbers again,
-- from 00014 to 00015 (still requires its own approval).
--
-- Additive; 00001-00013 untouched. Rollback notes at the end.

-- ============================================================================
-- 1. HELPER — the "Event Manager" predicate, mirroring events_update (00011):
--    event organizers, club admins of the event's club, platform admins.
-- ============================================================================

create function public.can_manage_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_event_role(p_event_id, array['organizer'])
      or public.is_club_admin((select club_id from events where id = p_event_id));
$$;
-- RLS policy expressions execute with the CALLER's privileges, so the roles
-- whose policies invoke this helper need EXECUTE on it (same posture as
-- is_event_member/has_event_role/is_club_admin, which keep their implicit
-- PUBLIC grant). anon stays revoked: no anon policy references it.
revoke all on function public.can_manage_event(uuid) from public, anon;
grant execute on function public.can_manage_event(uuid) to authenticated, service_role;

-- ============================================================================
-- 2. QR CONFIGURATIONS
-- ============================================================================

create table public.qr_configs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  label text not null,
  description text not null default '',
  -- what the QR identifies
  target text not null check (target in ('participant', 'team', 'event', 'feedback')),
  -- what may be done with it; validity is target-scoped (see constraint below).
  -- Future actions (e.g. 'judging') extend the allowed list in a later
  -- migration — the architecture does not change.
  actions text[] not null,
  -- who may perform the actions at a station:
  --   organizer / activity_admin / volunteer  -> event staff roles
  --   participant -> any event member (explicit self-service opt-in)
  --   public      -> only meaningful for event/feedback targets (anon access)
  scanner_access text[] not null default array['organizer', 'activity_admin', 'volunteer'],
  is_enabled boolean not null default true,
  -- action-specific extras, e.g. {"feedback_form_id": "..."} for feedback QRs
  config jsonb not null default '{}',
  -- physical payload for event/feedback targets (participant/team targets are
  -- scanned via the existing p_/t_ tokens)
  qr_token text not null unique default ('q_' || encode(gen_random_bytes(12), 'hex')),
  sort_order int not null default 0,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qr_configs_actions_not_empty check (cardinality(actions) > 0),
  constraint qr_configs_actions_valid check (
    case target
      when 'participant' then actions <@ array['attendance', 'scoring', 'verification']::text[]
      when 'team'        then actions <@ array['scoring', 'verification']::text[]
      when 'event'       then actions <@ array['registration', 'info']::text[]
      when 'feedback'    then actions <@ array['feedback']::text[]
    end
  ),
  constraint qr_configs_scanner_access_valid check (
    scanner_access <@ array['organizer', 'activity_admin', 'volunteer', 'participant', 'public']::text[]
    and cardinality(scanner_access) > 0
  ),
  -- feedback QRs must at least name their form (existence/publish state is
  -- verified at resolution time — cross-table checks don't belong in constraints)
  constraint qr_configs_feedback_form check (target <> 'feedback' or config ? 'feedback_form_id')
);

create index qr_configs_event_idx on public.qr_configs (event_id, sort_order, created_at);

create trigger qr_configs_touch before update on public.qr_configs
for each row execute function public.touch_updated_at();

alter table public.qr_configs enable row level security;

-- members see enabled operations (their "My QR codes" is built from these);
-- Event Managers see and manage everything, including disabled ones.
create policy qr_configs_select on public.qr_configs
  for select to authenticated using (
    (is_enabled and is_event_member(event_id)) or can_manage_event(event_id)
  );
create policy qr_configs_insert on public.qr_configs
  for insert to authenticated with check (can_manage_event(event_id));
create policy qr_configs_update on public.qr_configs
  for update to authenticated using (can_manage_event(event_id))
  with check (can_manage_event(event_id));
create policy qr_configs_delete on public.qr_configs
  for delete to authenticated using (can_manage_event(event_id));

-- no baseline default privileges in this project (00003/00009): grants mirror
-- the RLS surface. anon gets NOTHING — public resolution goes through
-- resolve_public_qr, which exposes only the minimum fields.
grant select, insert, update, delete on public.qr_configs to authenticated;
grant select, insert, update, delete on public.qr_configs to service_role;

-- ============================================================================
-- 3. SCAN LEDGER — server-written only
-- ============================================================================

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  qr_config_id uuid references public.qr_configs (id) on delete set null,
  target text not null check (target in ('participant', 'team', 'event', 'feedback')),
  target_id uuid,
  action text not null,
  scanned_by uuid references public.profiles (id), -- null = anon/system
  result text not null check (result in ('ok', 'duplicate', 'rejected')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index scans_event_idx on public.scans (event_id, created_at desc);
create index scans_config_idx on public.scans (qr_config_id, created_at desc);
create index scans_target_idx on public.scans (target, target_id);

alter table public.scans enable row level security;

-- staff read the ledger; NOBODY writes it directly — rows are inserted only by
-- the SECURITY DEFINER functions below (no insert/update/delete grant, no policy)
create policy scans_select on public.scans
  for select to authenticated using (
    has_event_role(event_id, array['organizer', 'activity_admin', 'volunteer'])
  );

grant select on public.scans to authenticated;
grant select, insert, update, delete on public.scans to service_role;

-- ============================================================================
-- 4. ATTENDANCE — once per participant per event, constraint-backed
-- ============================================================================

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  scan_id uuid references public.scans (id) on delete set null,
  recorded_by uuid references public.profiles (id), -- staff (or self when configured)
  created_at timestamptz not null default now(),
  -- THE duplicate-scan guard: server-side, race-proof
  unique (event_id, participant_id)
);

create index attendance_event_idx on public.attendance (event_id, created_at desc);

alter table public.attendance enable row level security;

-- staff see the attendance sheet; a participant sees their own check-in.
create policy attendance_select on public.attendance
  for select to authenticated using (
    has_event_role(event_id, array['organizer', 'activity_admin', 'volunteer'])
    or exists (select 1 from participants p
               where p.id = participant_id and p.user_id = auth.uid())
  );
-- corrections (mis-scans) are an Event Manager action; inserts happen only via
-- perform_scan (no insert grant/policy for clients)
create policy attendance_delete on public.attendance
  for delete to authenticated using (can_manage_event(event_id));

grant select, delete on public.attendance to authenticated;
grant select, insert, update, delete on public.attendance to service_role;

-- ============================================================================
-- 5. FEEDBACK FORMS + RESPONSES
-- ============================================================================

create table public.feedback_forms (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null,
  description text not null default '',
  -- [{ key, label, type: 'short_text'|'long_text'|'rating'|'single_choice'|
  --    'multi_choice', required, options?, max_rating? }]
  questions jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  access text not null default 'participants' check (access in ('public', 'participants')),
  one_response_per_user boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index feedback_forms_event_idx on public.feedback_forms (event_id, created_at desc);

create trigger feedback_forms_touch before update on public.feedback_forms
for each row execute function public.touch_updated_at();

alter table public.feedback_forms enable row level security;

-- anon may read ONLY published public forms (title/description/questions —
-- the minimum a public respondent needs; no unrelated event data lives here)
create policy feedback_forms_select_public on public.feedback_forms
  for select to anon using (status = 'published' and access = 'public');
create policy feedback_forms_select_auth on public.feedback_forms
  for select to authenticated using (
    can_manage_event(event_id)
    or (status = 'published' and (access = 'public' or is_event_member(event_id)))
  );
create policy feedback_forms_insert on public.feedback_forms
  for insert to authenticated with check (can_manage_event(event_id));
create policy feedback_forms_update on public.feedback_forms
  for update to authenticated using (can_manage_event(event_id))
  with check (can_manage_event(event_id));
create policy feedback_forms_delete on public.feedback_forms
  for delete to authenticated using (can_manage_event(event_id));

grant select on public.feedback_forms to anon;
grant select, insert, update, delete on public.feedback_forms to authenticated;
grant select, insert, update, delete on public.feedback_forms to service_role;

create table public.feedback_responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.feedback_forms (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  respondent_id uuid references public.profiles (id), -- null = anonymous (public form)
  -- dedupe: respondent uuid when the form enforces one response per signed-in
  -- user, random otherwise -> the UNIQUE below is race-proof yet configurable
  dedupe_key uuid not null default gen_random_uuid(),
  answers jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (form_id, dedupe_key)
);

create index feedback_responses_form_idx on public.feedback_responses (form_id, created_at desc);
create index feedback_responses_event_idx on public.feedback_responses (event_id);

alter table public.feedback_responses enable row level security;

-- Event Managers read responses; a signed-in respondent can read their own.
-- Writes ONLY via submit_feedback (no insert grant/policy).
create policy feedback_responses_select on public.feedback_responses
  for select to authenticated using (
    can_manage_event(event_id) or respondent_id = auth.uid()
  );
create policy feedback_responses_delete on public.feedback_responses
  for delete to authenticated using (can_manage_event(event_id));

grant select, delete on public.feedback_responses to authenticated;
grant select, insert, update, delete on public.feedback_responses to service_role;

-- ============================================================================
-- 6. perform_scan — the universal station entry point
-- ============================================================================

create function public.perform_scan(
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

  -- 4) scanner authorization: config-driven, never client-claimed.
  --    service_role (Games API) and platform admins always pass; otherwise the
  --    caller must be signed in and match the configured scanner access.
  v_authorized := coalesce(auth.role(), '') = 'service_role' or is_super_admin();
  if not v_authorized then
    if auth.uid() is null then
      raise exception 'Sign in to perform this operation';
    end if;
    v_staff_roles := array(select r from unnest(v_cfg.scanner_access) r
                           where r in ('organizer', 'activity_admin', 'volunteer'));
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
      -- the optimistic 'ok' scan row from this block was rolled back with the
      -- sub-transaction; log the duplicate attempt instead
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
    -- repeatable by design; every verification is a ledger row
    insert into scans (event_id, qr_config_id, target, target_id, action, scanned_by, result, metadata)
    values (v_cfg.event_id, v_cfg.id, v_cfg.target, v_target_id, 'verification', auth.uid(), 'ok', v_meta);
    return jsonb_build_object(
      'status', 'ok', 'action', 'verification',
      'kind', v_cfg.target, 'name', v_name,
      'participant_id', case when v_cfg.target = 'participant' then v_p.id end,
      'team_id', case when v_cfg.target = 'team' then v_team.id end
    );

  elsif p_action = 'scoring' then
    -- resolve the scoring account exactly like resolve_qr: a team-mode
    -- participant's points live on the team account (00012)
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
    -- amounts still flow ONLY through process_transaction (00001), which does
    -- its own staff authorization — this just resolves the scoring context
    return jsonb_build_object(
      'status', 'ok', 'action', 'scoring',
      'kind', case when v_acc.owner_type = 'team' then 'team' else 'participant' end,
      'name', case when v_acc.owner_type = 'team' then v_team.name else v_name end,
      'participant_id', v_p.id, 'participant_name', v_p.display_name,
      'team_id', case when v_acc.owner_type = 'team' then v_team.id end,
      'account_id', v_acc.id, 'balance', v_acc.balance
    );
  end if;

  raise exception 'Unsupported action "%"', p_action;
end $$;

revoke all on function public.perform_scan(uuid, text, text, text) from public, anon;
grant execute on function public.perform_scan(uuid, text, text, text) to authenticated, service_role;

-- ============================================================================
-- 7. resolve_public_qr — anon-safe resolution of event/feedback q_ tokens
-- ============================================================================

create function public.resolve_public_qr(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg qr_configs%rowtype;
  v_ev events%rowtype;
  v_form feedback_forms%rowtype;
begin
  select * into v_cfg from qr_configs
  where qr_token = p_token and target in ('event', 'feedback');
  if not found or not v_cfg.is_enabled then
    raise exception 'Unknown QR code';
  end if;

  select * into v_ev from events where id = v_cfg.event_id;
  if v_ev.status not in ('active', 'ended') then
    raise exception 'This event is not currently available';
  end if;

  if v_cfg.target = 'feedback' then
    select * into v_form from feedback_forms
    where id = nullif(v_cfg.config ->> 'feedback_form_id', '')::uuid
      and event_id = v_ev.id;
    if v_form.id is null or v_form.status <> 'published' then
      raise exception 'This feedback form is not open';
    end if;
    if v_form.access = 'participants'
       and (auth.uid() is null or not is_event_member(v_ev.id)) then
      -- tell the UI to prompt sign-in without leaking the form itself
      return jsonb_build_object(
        'target', 'feedback', 'requires_signin', true,
        'event_name', v_ev.name, 'form_title', v_form.title
      );
    end if;
    return jsonb_build_object(
      'target', 'feedback', 'action', 'feedback',
      'event_id', v_ev.id, 'event_name', v_ev.name, 'event_slug', v_ev.slug,
      'form_id', v_form.id, 'form_title', v_form.title
    );
  end if;

  -- event target: public-safe promotional surface only. The Event Manager
  -- explicitly created and enabled this QR — that is the publication decision.
  return jsonb_build_object(
    'target', 'event', 'actions', to_jsonb(v_cfg.actions),
    'label', v_cfg.label, 'description', v_cfg.description,
    'event_id', v_ev.id, 'event_name', v_ev.name, 'event_slug', v_ev.slug,
    'event_description', v_ev.description, 'event_status', v_ev.status,
    'logo_url', v_ev.logo_url, 'banner_url', v_ev.banner_url,
    'theme_color', v_ev.theme_color
  );
end $$;

grant execute on function public.resolve_public_qr(text) to anon, authenticated, service_role;

-- ============================================================================
-- 8. submit_feedback — validated, deduplicated response submission
-- ============================================================================

create function public.submit_feedback(p_form_id uuid, p_answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_form feedback_forms%rowtype;
  v_ev events%rowtype;
  v_q jsonb;
  v_ans jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_dedupe uuid;
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

  -- dedupe is a FORM-level rule: enforced for signed-in respondents via the
  -- (form_id, dedupe_key) UNIQUE; anonymous public responses cannot be
  -- attributed and are accepted as-is (documented in ADR-0009)
  v_dedupe := case when v_form.one_response_per_user and auth.uid() is not null
                   then auth.uid() else gen_random_uuid() end;
  begin
    insert into feedback_responses (form_id, event_id, respondent_id, dedupe_key, answers)
    values (p_form_id, v_ev.id, auth.uid(), v_dedupe, v_clean);
  exception when unique_violation then
    return jsonb_build_object(
      'status', 'duplicate',
      'message', 'You have already submitted this feedback form'
    );
  end;

  return jsonb_build_object('status', 'ok');
end $$;

grant execute on function public.submit_feedback(uuid, jsonb) to anon, authenticated, service_role;

-- ============================================================================
-- Rollback:
--   drop function public.submit_feedback(uuid, jsonb);
--   drop function public.resolve_public_qr(text);
--   drop function public.perform_scan(uuid, text, text, text);
--   drop table public.feedback_responses;
--   drop table public.feedback_forms;
--   drop table public.attendance;
--   drop table public.scans;
--   drop table public.qr_configs;
--   drop function public.can_manage_event(uuid);
-- ============================================================================

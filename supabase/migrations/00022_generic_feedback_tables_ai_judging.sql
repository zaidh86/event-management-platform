-- 00022: generic feedback, event table allocation, AI-assisted judging fields.
--
-- Applies AFTER 00021 (which it does not modify). Four additive changes:
--
--   1. GENERIC FEEDBACK — the per-target feedback model introduced in 00019
--      (one response per respondent per team/participant target) is retired.
--      Feedback is ONE generic, configurable form: anybody who may open it may
--      answer it as many times as they like; the form's own questions carry
--      whatever context the Event Manager wants ("Which team is this about?").
--      submit_feedback keeps its 4-arg signature (no DROP, grants untouched,
--      no PGRST203 overload) but ignores the target parameters and never
--      deduplicates. The target columns and the (form_id, dedupe_key) UNIQUE
--      stay in place — dedupe_key is simply always random now, so the
--      constraint can never fire. feedback_forms.one_response_per_user is no
--      longer enforced (default flipped to false; column kept for history).
--      Respondent categorization from 00021 (faculty / regular / anonymous)
--      is unchanged — it is a property of WHO answered, not of what about.
--
--   2. EVENT TABLE ALLOCATION — an optional, per-event feature: each
--      registration UNIT (a solo participant, or a team at the moment it is
--      created) receives the next table number in registration order. Teams
--      share ONE table; every member sees the same number. Configured in
--      events.table_config (jsonb): {"enabled": bool, "start_number": int,
--      "label": text}. Allocation happens in triggers on the existing
--      registration paths (participants / teams inserts) so register_for_event
--      and create_team are NOT rewritten. Event Managers may backfill when
--      enabling the feature mid-event (assign_event_tables). Concurrency is
--      handled with a per-event transaction advisory lock plus a UNIQUE
--      (event_id, table_number) — two registrations can never share a table.
--
--   3. AI-ASSISTED JUDGING — judging_criteria.ai_instructions (what an AI
--      should look for when suggesting a score; separate from the human-facing
--      description) and judge_evaluations.details (the AI row's structured
--      reasoning/evidence). AI rows are source='ai' (00016 already reserves
--      this; the unique index judge_evaluations_ai_one already exists) and are
--      written ONLY by the service role from the Edge Function. Judges gain
--      read access to the AI row of entries in events they judge — suggestions
--      are advisory; get_judging_results (00016) still ignores AI rows, so the
--      final score remains human-only. No other policy changes.
--
--   4. Nothing else. 00001–00021 untouched. Rollback notes at the end.


-- ============================================================================
-- 1. GENERIC FEEDBACK
-- ============================================================================

alter table public.feedback_forms
  alter column one_response_per_user set default false;

-- Body-only replacement: same signature, same grants (anon + authenticated +
-- service_role, 00019). p_target_type / p_target_id are accepted for
-- compatibility and ignored — every response is a generic, event-level one.
create or replace function public.submit_feedback(
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

  -- generic feedback: never deduplicated. dedupe_key is random so the
  -- (form_id, dedupe_key) UNIQUE from 00014 can never reject a response.
  -- respondent_category is stamped by the 00021 BEFORE INSERT trigger.
  insert into feedback_responses (form_id, event_id, respondent_id, dedupe_key,
                                  answers, target_type, target_id)
  values (p_form_id, v_ev.id, auth.uid(), gen_random_uuid(), v_clean, 'event', null);

  return jsonb_build_object('status', 'ok');
end $$;


-- ============================================================================
-- 2. EVENT TABLE ALLOCATION
-- ============================================================================

-- 2a. Per-event configuration. Absent keys mean: disabled, start at 1, "Table".
alter table public.events
  add column table_config jsonb not null default '{}'::jsonb;

-- 2b. One row per allocated unit. Exactly one owner column is set. Both owner
--     FKs cascade, so removing a participant (00021) or deleting a team frees
--     the row; the number itself is never reused automatically — organizers
--     re-run assign_event_tables if they want gaps filled.
create table public.event_tables (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  participant_id uuid references public.participants (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  table_number int not null check (table_number > 0),
  created_at timestamptz not null default now(),
  constraint event_tables_one_owner
    check ((participant_id is null) <> (team_id is null)),
  unique (event_id, table_number),
  unique (participant_id),
  unique (team_id)
);

create index event_tables_event_idx on public.event_tables (event_id, table_number);

alter table public.event_tables enable row level security;

-- every member of the event may read the allocation list (their own table,
-- their team's table, and — for staff — everyone's); managers may clear rows.
-- participants_select (00001) already lets a member see their own row and
-- their teammates', so exposing table numbers event-wide reveals nothing
-- beyond what the physical room shows.
create policy event_tables_select on public.event_tables
  for select to authenticated using (
    is_event_member(event_id) or can_manage_event(event_id)
  );
create policy event_tables_delete on public.event_tables
  for delete to authenticated using (can_manage_event(event_id));

-- writes ONLY via the allocator below (trigger / RPC): no insert/update grant
grant select, delete on public.event_tables to authenticated;
grant select, insert, update, delete on public.event_tables to service_role;

-- 2c. The allocator. Internal: callable only by the triggers and the manager
--     RPC (both SECURITY DEFINER, both in this file). Serialized per event with
--     a transaction-scoped advisory lock so concurrent registrations cannot
--     compute the same "next" number; the UNIQUE is the backstop.
create function public._allocate_event_table(
  p_event_id uuid, p_participant_id uuid, p_team_id uuid
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb;
  v_start int;
  v_next int;
begin
  select table_config into v_cfg from events where id = p_event_id;
  v_start := greatest(coalesce((v_cfg ->> 'start_number')::int, 1), 1);

  perform pg_advisory_xact_lock(hashtext('event_tables:' || p_event_id::text));

  select coalesce(max(table_number), v_start - 1) + 1 into v_next
  from event_tables where event_id = p_event_id;

  insert into event_tables (event_id, participant_id, team_id, table_number)
  values (p_event_id, p_participant_id, p_team_id, v_next)
  on conflict do nothing;

  return v_next;
end $$;

revoke all on function public._allocate_event_table(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public._allocate_event_table(uuid, uuid, uuid) to service_role;

-- 2d. Allocation at registration. A SOLO registration is a unit; a TEAM
--     registration is a unit only once the team exists (create_team), and its
--     members inherit the team's table through teams.id — never their own row.
create function public.event_tables_on_participant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_enabled boolean;
begin
  if new.participation_mode <> 'solo' then
    return new;
  end if;
  select coalesce((table_config ->> 'enabled')::boolean, false) into v_enabled
  from events where id = new.event_id;
  if v_enabled then
    perform _allocate_event_table(new.event_id, new.id, null);
  end if;
  return new;
end $$;

create function public.event_tables_on_team()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_enabled boolean;
begin
  select coalesce((table_config ->> 'enabled')::boolean, false) into v_enabled
  from events where id = new.event_id;
  if v_enabled then
    perform _allocate_event_table(new.event_id, null, new.id);
  end if;
  return new;
end $$;

create trigger participants_allocate_table
after insert on public.participants
for each row execute function public.event_tables_on_participant();

create trigger teams_allocate_table
after insert on public.teams
for each row execute function public.event_tables_on_team();

-- 2e. Manager backfill: when the feature is switched on mid-event, allocate
--     tables to every existing unit that lacks one, in registration order
--     (solo participants by their registration time, teams by their creation
--     time, interleaved). Idempotent — units that already hold a table are
--     skipped. Returns how many were assigned.
create function public.assign_event_tables(p_event_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_unit record;
  v_n int := 0;
begin
  if not can_manage_event(p_event_id) then
    raise exception 'Only Event Managers can assign tables';
  end if;
  if not coalesce((select (table_config ->> 'enabled')::boolean from events where id = p_event_id), false) then
    raise exception 'Table allocation is not enabled for this event';
  end if;

  for v_unit in
    select p.id as participant_id, null::uuid as team_id, p.created_at
    from participants p
    where p.event_id = p_event_id and p.participation_mode = 'solo'
      and not exists (select 1 from event_tables t where t.participant_id = p.id)
    union all
    select null::uuid, tm.id, tm.created_at
    from teams tm
    where tm.event_id = p_event_id
      and not exists (select 1 from event_tables t where t.team_id = tm.id)
    order by created_at
  loop
    perform _allocate_event_table(p_event_id, v_unit.participant_id, v_unit.team_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

revoke all on function public.assign_event_tables(uuid) from public, anon;
grant execute on function public.assign_event_tables(uuid) to authenticated, service_role;


-- ============================================================================
-- 3. AI-ASSISTED JUDGING
-- ============================================================================

-- 3a. What the AI should look for — distinct from `description`, which is the
--     human judge's evaluation guidance. Empty = the AI falls back to the
--     description.
alter table public.judging_criteria
  add column ai_instructions text not null default '';

-- 3b. Structured AI output (per-criterion reasoning + evidence, model id,
--     generated_at). Human rows keep '{}'.
alter table public.judge_evaluations
  add column details jsonb not null default '{}'::jsonb;

-- 3c. Judges may READ the AI row for entries in their event. They still never
--     see another human's evaluation (00016 policy unchanged — this is an
--     additional permissive policy, OR-ed with it). AI rows have judge_id
--     null, so without this policy a judge could never see a suggestion.
create policy judge_evaluations_select_ai on public.judge_evaluations
  for select to authenticated using (
    source = 'ai' and has_event_role(event_id, array['judge', 'organizer'])
  );

-- No write path change: the only insert/update grant on judge_evaluations is
-- service_role (00016) — the Edge Function writes AI rows; save_evaluation
-- still writes human rows only.


-- ============================================================================
-- Rollback:
--   -- 3
--   drop policy judge_evaluations_select_ai on public.judge_evaluations;
--   alter table public.judge_evaluations drop column details;
--   alter table public.judging_criteria drop column ai_instructions;
--   -- 2
--   drop function public.assign_event_tables(uuid);
--   drop trigger teams_allocate_table on public.teams;
--   drop trigger participants_allocate_table on public.participants;
--   drop function public.event_tables_on_team();
--   drop function public.event_tables_on_participant();
--   drop function public._allocate_event_table(uuid, uuid, uuid);
--   drop table public.event_tables;
--   alter table public.events drop column table_config;
--   -- 1
--   alter table public.feedback_forms alter column one_response_per_user set default true;
--   -- recreate the 00019 submit_feedback body verbatim (same signature)
-- ============================================================================

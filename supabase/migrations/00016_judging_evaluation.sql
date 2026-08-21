-- 00016: submissions + judging & evaluation (ADR-0011).
--
-- Universal, capability-gated evaluation stack:
--   * submissions        one deliverable per participant/team per event —
--                        hackathon project, competition entry, design piece,
--                        workshop assignment — shaped by per-event
--                        configuration, never by a hardcoded event type
--   * judge role         event-SCOPED via the existing event_members table:
--                        the role check simply gains 'judge'. No global role,
--                        no parallel assignment system — has_event_role() and
--                        the Members UI work unchanged.
--   * judging_criteria   Event-Manager-configured: name, description,
--                        max_score, weight, required, order, enabled
--   * judge_evaluations  one row PER JUDGE per submission (independent
--                        evaluations are preserved, never merged); scores are
--                        {criterion_id: number} jsonb validated server-side;
--                        notes stay private to the judge + Event Managers.
--                        source 'human'|'ai' + a nullable judge_id make the
--                        table AI-ready (Phase 6 comparison) without AI being
--                        implemented here — manual judging is complete alone.
--
-- Judging scores are EVALUATION data: entirely separate from the
-- accounts/transactions scoring ledger. Nothing here touches balances.
--
-- Configuration lives in events.submission_config (jsonb), mirroring
-- leaderboard_config (00013):
--   deadline            ISO timestamptz — submissions close at this moment
--   fields              [{key,label,type:'text'|'number'|'select',required,options?}]
--   instructions        text shown above the submission form
--   results_visibility  'hidden' (default) | 'participants'
--
-- Writes flow through SECURITY DEFINER RPCs (save_submission,
-- save_evaluation) — deadline, ownership, mode and score-range rules are
-- server-enforced; the frontend is never trusted. Reads are RLS-scoped.
--
-- Additive; 00001-00015 untouched. Rollback notes at the end.

-- ============================================================================
-- 1. EVENT CONFIGURATION + JUDGE ROLE
-- ============================================================================

alter table public.events
  add column submission_config jsonb not null default '{}'::jsonb;

-- event-scoped judge: same table, same uniqueness (one role per user per
-- event), same has_event_role() plumbing. Existing policies enumerate staff
-- roles explicitly, so 'judge' grants nothing anywhere until policies/RPCs
-- below say so.
alter table public.event_members drop constraint event_members_role_check;
alter table public.event_members add constraint event_members_role_check
  check (role in ('organizer', 'activity_admin', 'volunteer', 'participant', 'judge'));

-- ============================================================================
-- 2. SUBMISSIONS
-- ============================================================================

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- exactly one owner: a participant (solo mode) or a team (team mode)
  participant_id uuid references public.participants (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  title text not null,
  description text not null default '',
  -- answers to the event's configured submission fields
  content jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submissions_one_owner check ((participant_id is null) <> (team_id is null))
);

-- one submission per entrant (participants/teams are already event-scoped)
create unique index submissions_solo_one on public.submissions (participant_id)
  where participant_id is not null;
create unique index submissions_team_one on public.submissions (team_id)
  where team_id is not null;
create index submissions_event_idx on public.submissions (event_id, status);

create trigger submissions_touch before update on public.submissions
for each row execute function public.touch_updated_at();

alter table public.submissions enable row level security;

-- owners see their own; Event Managers see everything; judges see SUBMITTED
-- entries only (drafts stay private until handed in)
create policy submissions_select on public.submissions
  for select to authenticated using (
    can_manage_event(event_id)
    or (has_event_role(event_id, array['judge']) and status = 'submitted')
    or (participant_id is not null and exists (
          select 1 from participants p
          where p.id = participant_id and p.user_id = auth.uid()))
    or (team_id is not null and team_id in (select current_user_team_ids()))
  );
create policy submissions_delete on public.submissions
  for delete to authenticated using (can_manage_event(event_id));

-- writes ONLY via save_submission (below): no insert/update grant
grant select, delete on public.submissions to authenticated;
grant select, insert, update, delete on public.submissions to service_role;

-- ============================================================================
-- 3. JUDGING CRITERIA
-- ============================================================================

create table public.judging_criteria (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  description text not null default '',
  max_score numeric not null default 10 check (max_score > 0),
  weight numeric not null default 1 check (weight >= 0),
  required boolean not null default true,
  sort_order int not null default 0,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name)
);

create index judging_criteria_event_idx on public.judging_criteria (event_id, sort_order);

create trigger judging_criteria_touch before update on public.judging_criteria
for each row execute function public.touch_updated_at();

alter table public.judging_criteria enable row level security;

-- criteria are not secrets: every event member (participants, staff, judges)
-- may read them; only Event Managers shape them
create policy judging_criteria_select on public.judging_criteria
  for select to authenticated using (
    is_event_member(event_id) or can_manage_event(event_id)
  );
create policy judging_criteria_insert on public.judging_criteria
  for insert to authenticated with check (can_manage_event(event_id));
create policy judging_criteria_update on public.judging_criteria
  for update to authenticated using (can_manage_event(event_id))
  with check (can_manage_event(event_id));
create policy judging_criteria_delete on public.judging_criteria
  for delete to authenticated using (can_manage_event(event_id));

grant select, insert, update, delete on public.judging_criteria to authenticated;
grant select, insert, update, delete on public.judging_criteria to service_role;

-- ============================================================================
-- 4. JUDGE EVALUATIONS — one per judge per submission, preserved individually
-- ============================================================================

create table public.judge_evaluations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  -- null only for future AI evaluations (source = 'ai')
  judge_id uuid references public.profiles (id) on delete cascade,
  source text not null default 'human' check (source in ('human', 'ai')),
  -- {criterion_id: numeric score} — validated by save_evaluation
  scores jsonb not null default '{}',
  -- private: visible to this judge and Event Managers only, never public
  notes text not null default '',
  status text not null default 'draft' check (status in ('draft', 'final')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint judge_evaluations_human_has_judge check (source <> 'human' or judge_id is not null)
);

create unique index judge_evaluations_human_one on public.judge_evaluations (submission_id, judge_id)
  where source = 'human';
create unique index judge_evaluations_ai_one on public.judge_evaluations (submission_id)
  where source = 'ai';
create index judge_evaluations_event_idx on public.judge_evaluations (event_id);
create index judge_evaluations_submission_idx on public.judge_evaluations (submission_id);

create trigger judge_evaluations_touch before update on public.judge_evaluations
for each row execute function public.touch_updated_at();

alter table public.judge_evaluations enable row level security;

-- a judge sees only their OWN evaluations (independent judging — no peeking);
-- Event Managers see all, including private notes and AI rows
create policy judge_evaluations_select on public.judge_evaluations
  for select to authenticated using (
    judge_id = auth.uid() or can_manage_event(event_id)
  );
create policy judge_evaluations_delete on public.judge_evaluations
  for delete to authenticated using (can_manage_event(event_id));

-- writes ONLY via save_evaluation: no insert/update grant
grant select, delete on public.judge_evaluations to authenticated;
grant select, insert, update, delete on public.judge_evaluations to service_role;

-- ============================================================================
-- 5. save_submission — the only write path for submissions
-- ============================================================================

create function public.save_submission(
  p_event_id uuid,
  p_title text,
  p_description text default '',
  p_content jsonb default '{}',
  p_submit boolean default false
) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_sub submissions%rowtype;
  v_deadline timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_ev from events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;
  if not coalesce((v_ev.capabilities ->> 'submissions')::boolean, false) then
    raise exception 'Submissions are not enabled for this event';
  end if;
  if v_ev.status <> 'active' then
    raise exception 'Event is not active';
  end if;
  v_deadline := nullif(v_ev.submission_config ->> 'deadline', '')::timestamptz;
  if v_deadline is not null and now() > v_deadline then
    raise exception 'The submission deadline has passed';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Title is required';
  end if;

  select * into v_p from participants where event_id = p_event_id and user_id = auth.uid();
  if not found then
    raise exception 'Register for the event before submitting';
  end if;

  -- ownership follows the STORED participation mode (ADR-0007): team-mode
  -- participants share one team submission; solo participants own their own
  if v_p.participation_mode = 'team' then
    if v_p.team_id is null then
      raise exception 'Join a team before submitting';
    end if;
    select * into v_sub from submissions where team_id = v_p.team_id for update;
  else
    select * into v_sub from submissions where participant_id = v_p.id for update;
  end if;

  if v_sub.id is null then
    insert into submissions (event_id, participant_id, team_id, title, description,
                             content, status, submitted_at, created_by)
    values (
      p_event_id,
      case when v_p.participation_mode = 'team' then null else v_p.id end,
      case when v_p.participation_mode = 'team' then v_p.team_id end,
      trim(p_title), coalesce(p_description, ''), coalesce(p_content, '{}'::jsonb),
      case when p_submit then 'submitted' else 'draft' end,
      case when p_submit then now() end,
      auth.uid()
    ) returning * into v_sub;
  else
    -- editing stays open until the deadline; a submitted entry never silently
    -- reverts to draft
    update submissions set
      title = trim(p_title),
      description = coalesce(p_description, ''),
      content = coalesce(p_content, '{}'::jsonb),
      status = case when p_submit or v_sub.status = 'submitted' then 'submitted' else 'draft' end,
      submitted_at = case when v_sub.submitted_at is not null then v_sub.submitted_at
                          when p_submit then now() end
    where id = v_sub.id
    returning * into v_sub;
  end if;

  return v_sub;
end $$;

revoke all on function public.save_submission(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.save_submission(uuid, text, text, jsonb, boolean) to authenticated, service_role;

-- ============================================================================
-- 6. save_evaluation — the only write path for evaluations
-- ============================================================================

create function public.save_evaluation(
  p_submission_id uuid,
  p_scores jsonb,
  p_notes text default '',
  p_finalize boolean default false
) returns public.judge_evaluations
language plpgsql security definer set search_path = public as $$
declare
  v_sub submissions%rowtype;
  v_ev events%rowtype;
  v_c judging_criteria%rowtype;
  v_val jsonb;
  v_num numeric;
  v_clean jsonb := '{}'::jsonb;
  v_eval judge_evaluations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_sub from submissions where id = p_submission_id;
  if not found then
    raise exception 'Submission not found';
  end if;
  if v_sub.status <> 'submitted' then
    raise exception 'This entry has not been submitted yet';
  end if;
  select * into v_ev from events where id = v_sub.event_id;
  if v_ev.status = 'archived' then
    raise exception 'Event is archived';
  end if;
  -- assigned judges evaluate; organizers may too (has_event_role also admits
  -- platform admins). Volunteers/participants cannot.
  if not has_event_role(v_sub.event_id, array['judge', 'organizer']) then
    raise exception 'Only assigned judges can evaluate submissions';
  end if;

  -- validate against the event's ENABLED criteria; unknown keys are rejected,
  -- ranges enforced, required criteria enforced at finalization
  for v_c in
    select * from judging_criteria
    where event_id = v_sub.event_id and is_enabled
  loop
    v_val := p_scores -> (v_c.id::text);
    if v_val is null or v_val = 'null'::jsonb then
      if v_c.required and p_finalize then
        raise exception '"%" requires a score before finalizing', v_c.name;
      end if;
      continue;
    end if;
    if jsonb_typeof(v_val) <> 'number' then
      raise exception 'Score for "%" must be a number', v_c.name;
    end if;
    v_num := (v_val #>> '{}')::numeric;
    if v_num < 0 or v_num > v_c.max_score then
      raise exception 'Score for "%" must be between 0 and %', v_c.name, v_c.max_score;
    end if;
    v_clean := v_clean || jsonb_build_object(v_c.id::text, v_num);
  end loop;
  if exists (
    select 1 from jsonb_object_keys(coalesce(p_scores, '{}'::jsonb)) k
    where not exists (
      select 1 from judging_criteria c
      where c.event_id = v_sub.event_id and c.id::text = k)
  ) then
    raise exception 'Unknown judging criterion in scores';
  end if;

  select * into v_eval from judge_evaluations
  where submission_id = p_submission_id and judge_id = auth.uid() and source = 'human'
  for update;

  if v_eval.id is null then
    insert into judge_evaluations (event_id, submission_id, judge_id, source, scores, notes, status)
    values (v_sub.event_id, p_submission_id, auth.uid(), 'human', v_clean,
            coalesce(p_notes, ''), case when p_finalize then 'final' else 'draft' end)
    returning * into v_eval;
  else
    update judge_evaluations set
      scores = v_clean,
      notes = coalesce(p_notes, ''),
      status = case when p_finalize then 'final' else v_eval.status end
    where id = v_eval.id
    returning * into v_eval;
  end if;

  return v_eval;
end $$;

revoke all on function public.save_evaluation(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.save_evaluation(uuid, jsonb, text, boolean) to authenticated, service_role;

-- ============================================================================
-- 7. get_judging_results — deterministic weighted aggregation
-- ============================================================================
-- Per criterion: avg of FINALIZED human scores across judges. raw_total is the
-- sum of those averages; weighted_total multiplies each by its weight first.
-- Notes and judge identities are NEVER included — this output is safe for the
-- configured participant visibility. AI rows never affect these totals.

create function public.get_judging_results(p_event_id uuid)
returns table (
  submission_id uuid,
  title text,
  owner_type text,
  owner_name text,
  evaluation_count bigint,
  finalized_count bigint,
  raw_total numeric,
  weighted_total numeric,
  breakdown jsonb
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ev events%rowtype;
  v_vis text;
  v_privileged boolean;
begin
  select * into v_ev from events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;

  v_privileged := coalesce(auth.role(), '') = 'service_role'
    or can_manage_event(p_event_id)
    or has_event_role(p_event_id, array['judge', 'activity_admin', 'volunteer']);
  v_vis := coalesce(v_ev.submission_config ->> 'results_visibility', 'hidden');
  if not v_privileged
     and not (v_vis = 'participants' and is_event_member(p_event_id)) then
    raise exception 'Judging results are not available for this event';
  end if;

  return query
  with finals as (
    select e.submission_id as sid, (kv.key)::uuid as cid, (kv.value #>> '{}')::numeric as score
    from judge_evaluations e
    cross join lateral jsonb_each(e.scores) kv
    where e.event_id = p_event_id and e.source = 'human' and e.status = 'final'
  ),
  crit_avg as (
    select f.sid, f.cid, avg(f.score) as avg_score
    from finals f
    join judging_criteria c on c.id = f.cid and c.is_enabled
    group by f.sid, f.cid
  ),
  totals as (
    select ca.sid,
      sum(ca.avg_score) as t_raw,
      sum(ca.avg_score * c.weight) as t_weighted,
      jsonb_object_agg(c.id::text, jsonb_build_object(
        'name', c.name, 'max_score', c.max_score, 'weight', c.weight,
        'avg_score', round(ca.avg_score, 2),
        'weighted', round(ca.avg_score * c.weight, 2)
      ) order by c.sort_order, c.name) as t_breakdown
    from crit_avg ca
    join judging_criteria c on c.id = ca.cid
    group by ca.sid
  ),
  eval_counts as (
    select e.submission_id as sid,
      count(*) as n_all,
      count(*) filter (where e.status = 'final') as n_final
    from judge_evaluations e
    where e.event_id = p_event_id and e.source = 'human'
    group by e.submission_id
  )
  select
    s.id,
    s.title,
    case when s.team_id is not null then 'team' else 'participant' end,
    coalesce(t.name, p.display_name),
    coalesce(ec.n_all, 0),
    coalesce(ec.n_final, 0),
    coalesce(tt.t_raw, 0),
    coalesce(tt.t_weighted, 0),
    coalesce(tt.t_breakdown, '{}'::jsonb)
  from submissions s
  left join teams t on t.id = s.team_id
  left join participants p on p.id = s.participant_id
  left join totals tt on tt.sid = s.id
  left join eval_counts ec on ec.sid = s.id
  where s.event_id = p_event_id and s.status = 'submitted'
  order by coalesce(tt.t_weighted, 0) desc, s.title asc;
end $$;

-- default PUBLIC execute must be revoked or the grant below restricts nothing;
-- the function's own guard also rejects anon, but grant discipline is the rule
revoke all on function public.get_judging_results(uuid) from public, anon;
grant execute on function public.get_judging_results(uuid) to authenticated, service_role;

-- ============================================================================
-- Rollback:
--   drop function public.get_judging_results(uuid);
--   drop function public.save_evaluation(uuid, jsonb, text, boolean);
--   drop function public.save_submission(uuid, text, text, jsonb, boolean);
--   drop table public.judge_evaluations;
--   drop table public.judging_criteria;
--   drop table public.submissions;
--   alter table public.event_members drop constraint event_members_role_check;
--   alter table public.event_members add constraint event_members_role_check
--     check (role in ('organizer','activity_admin','volunteer','participant'));
--   alter table public.events drop column submission_config;
-- ============================================================================

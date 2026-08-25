-- 00025: Event Report AI Analysis — OWN criteria table + report storage.
--
-- (Rewritten before ever being applied/committed: an earlier draft coupled
-- this feature to judging_criteria. That coupling is gone — this migration
-- touches NOTHING in the judging system.)
--
-- Two independent criterion systems per event, by design:
--
--   judging_criteria                  → normal event judging (unchanged here)
--   event_report_analysis_criteria    → Event Report AI Analysis (new)
--
-- The Event Report is a document a CLUB AUTHORITY uploads on the Analytics
-- page; the AI reviews it against these analysis criteria only. Results are
-- returned to the caller and never written into judge_evaluations or any
-- judging total.
--
--   1. event_report_analysis_criteria — same shape conventions as
--      judging_criteria (00016): uuid PK, event FK CASCADE, numeric
--      max_score/weight with the same CHECKs, is_enabled, sort_order,
--      touch_updated_at trigger, unique (event_id, name). No `required`
--      column: there is no finalization step to require anything for.
--
--      RLS audience is DELIBERATELY NARROWER than judging_criteria (which
--      every event member may read): these criteria are a club-authority
--      analysis tool, so every command — SELECT included — is gated on
--      is_club_admin(the event's club), i.e. super_admin ∪ club_admin ∪
--      convener (00021's chokepoint). Organizers, judges, volunteers,
--      participants and faculty get nothing from event membership alone.
--
--   2. Event Report storage (retained from the reviewed design, independent
--      of any criteria): reports/{event_id}/<file>.pdf inside the PRIVATE
--      submission-docs bucket, readable/writable only under the same club
--      authority via can_manage_event_report(). The bucket's server-side
--      limits (application/pdf, 10 MB) apply unchanged. Every policy wraps
--      its path parse in CASE so rows under other prefixes (the legacy
--      {event_id}/{submission_id}.pdf convention) can never make the uuid
--      cast raise — storage policies are OR-ed across all rows.
--
-- No analysis table on purpose: the analysis is a review returned to the
-- requesting client, not event state.
--
-- Additive; 00001–00024 untouched. Rollback notes at the end.

-- ============================================================================
-- 1. EVENT REPORT ANALYSIS CRITERIA
-- ============================================================================

create table public.event_report_analysis_criteria (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  -- human-facing guidance ("what does this criterion mean?")
  description text not null default '',
  -- what the AI should look for; empty = fall back to the description
  ai_instructions text not null default '',
  max_score numeric not null default 10 check (max_score > 0),
  weight numeric not null default 1 check (weight >= 0),
  is_enabled boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name)
);

create index event_report_analysis_criteria_event_idx
  on public.event_report_analysis_criteria (event_id, sort_order);

create trigger event_report_analysis_criteria_touch
before update on public.event_report_analysis_criteria
for each row execute function public.touch_updated_at();

alter table public.event_report_analysis_criteria enable row level security;

-- club authority ONLY, for every command — the same predicate shape
-- can_manage_event uses for its club arm (00014), evaluated per row
create policy report_criteria_select on public.event_report_analysis_criteria
  for select to authenticated using (
    is_club_admin((select club_id from events where id = event_id))
  );
create policy report_criteria_insert on public.event_report_analysis_criteria
  for insert to authenticated with check (
    is_club_admin((select club_id from events where id = event_id))
  );
create policy report_criteria_update on public.event_report_analysis_criteria
  for update to authenticated
  using (is_club_admin((select club_id from events where id = event_id)))
  with check (is_club_admin((select club_id from events where id = event_id)));
create policy report_criteria_delete on public.event_report_analysis_criteria
  for delete to authenticated using (
    is_club_admin((select club_id from events where id = event_id))
  );

grant select, insert, update, delete on public.event_report_analysis_criteria to authenticated;
grant select, insert, update, delete on public.event_report_analysis_criteria to service_role;

-- ============================================================================
-- 2. EVENT REPORT OBJECTS: reports/{event_id}/... in submission-docs
-- ============================================================================

-- helper predicate, SECURITY DEFINER like every authority helper: resolves the
-- event segment of a report path to its club and asks the ONE club-authority
-- chokepoint. Returns false (never errors) for paths that are not report paths.
create function public.can_manage_event_report(p_object_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_object_name ~ '^reports/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.+'
    then coalesce((
      select is_club_admin(e.club_id)
      from events e
      where e.id = split_part(p_object_name, '/', 2)::uuid
    ), false)
    else false
  end;
$$;

revoke all on function public.can_manage_event_report(text) from public, anon;
grant execute on function public.can_manage_event_report(text) to authenticated, service_role;

create policy "event report write" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'submission-docs' and can_manage_event_report(name)
  );

create policy "event report update" on storage.objects
  for update to authenticated
  using (bucket_id = 'submission-docs' and can_manage_event_report(name))
  with check (bucket_id = 'submission-docs' and can_manage_event_report(name));

create policy "event report delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'submission-docs' and can_manage_event_report(name)
  );

create policy "event report read" on storage.objects
  for select to authenticated using (
    bucket_id = 'submission-docs' and can_manage_event_report(name)
  );

-- ============================================================================
-- Rollback:
--   drop policy "event report read" on storage.objects;
--   drop policy "event report delete" on storage.objects;
--   drop policy "event report update" on storage.objects;
--   drop policy "event report write" on storage.objects;
--   drop function public.can_manage_event_report(text);
--   drop table public.event_report_analysis_criteria;
-- ============================================================================

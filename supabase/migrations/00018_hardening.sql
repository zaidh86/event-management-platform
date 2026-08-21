-- 00018: final hardening wave (QA backlog items QA-008, QA-015).
--
-- 1. events.club_id NOT NULL — the long-deferred wave (originally slated as
--    00010, renumbered through every phase since). 00011 retired the General
--    fallback and made club-first creation mandatory; every event now has a
--    club, and the schema finally says so. The guard below makes the failure
--    mode loud: if any legacy club-less event still exists, the migration
--    aborts with a count instead of half-applying.
--
-- 2. Anon feedback listing excludes archived events (QA-015): submit_feedback
--    already rejects archived events; the anon SELECT policy now agrees, so a
--    published public form stops being listable once its event is archived.
--
-- Additive/behavioral only; no historical migration touched. Rollback at end.

-- ── 1. club_id NOT NULL ------------------------------------------------------

do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans from public.events where club_id is null;
  if v_orphans > 0 then
    raise exception
      'Cannot enforce events.club_id NOT NULL: % event(s) have no club. Assign them to clubs first.',
      v_orphans;
  end if;
end $$;

alter table public.events alter column club_id set not null;

-- ── 2. anon feedback listing: archived events drop out ------------------------

drop policy feedback_forms_select_public on public.feedback_forms;
create policy feedback_forms_select_public on public.feedback_forms
  for select to anon using (
    status = 'published' and access = 'public'
    and exists (select 1 from events e where e.id = event_id and e.status <> 'archived')
  );

-- Rollback:
--   drop policy feedback_forms_select_public on public.feedback_forms;
--   create policy feedback_forms_select_public on public.feedback_forms
--     for select to anon using (status = 'published' and access = 'public');
--   alter table public.events alter column club_id drop not null;

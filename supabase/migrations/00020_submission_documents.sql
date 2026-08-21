-- 00020: submission documents (PDF) — Informatique Exhib submission pass.
--
-- Participants/teams may attach ONE PDF (their work/project overview) to their
-- EXISTING submission — same record, no second submission system. The existing
-- event-media bucket is PUBLIC (00001) and therefore wrong for private
-- submission documents, so this adds:
--
--   1. a PRIVATE bucket `submission-docs` with server-side limits enforced at
--      the storage layer (10 MB, application/pdf only — the client cannot
--      bypass them);
--   2. storage.objects policies mirroring the submissions RLS exactly:
--      owners write/read their own document, Event Managers read all, judges
--      read documents of SUBMITTED entries only, nobody else anything. The
--      object path is `{event_id}/{submission_id}.pdf` — deterministic, so
--      replacing the PDF is an upsert of the same path and the policies can
--      derive the owning submission from the path alone (split_part; no
--      storage helper functions needed);
--   3. submissions.document_path / document_name columns, written only through
--      save_submission, which validates the path is EXACTLY this submission's
--      canonical path — no pointing at other teams' documents;
--   4. save_submission recreated with optional document parameters (the old
--      5-arg signature is DROPPED to avoid PostgREST overload ambiguity,
--      PGRST203 — same convention as 00012/00019; grants re-issued).
--
-- Update lifecycle is UNCHANGED: drafts and submitted entries stay editable
-- until the deadline / while the event is active (00016 semantics) — the
-- document follows the same rule (the write policies embed the same deadline
-- and active-event checks, so a direct storage upload cannot outlive the RPC
-- rules).
--
-- AI note (deferred, honest): the private bucket is readable by service_role
-- (storage RLS does not bind it), so the existing event-assistant Edge
-- Function can later fetch a document for analysis. No extraction or AI
-- analysis is implemented here.
--
-- Additive; 00001-00019 untouched. Rollback notes at the end.

-- ============================================================================
-- 1. PRIVATE BUCKET with storage-layer type/size enforcement
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submission-docs', 'submission-docs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- ============================================================================
-- 2. STORAGE POLICIES — mirror the submissions RLS surface
-- ============================================================================
-- Path convention: name = '<event_id>/<submission_id>.pdf'
--   split_part(name, '/', 1) -> event id (text)
--   split_part(name, '/', 2) -> '<submission_id>.pdf'
-- The owning submission is resolved from the path and every rule derives from
-- that row — a forged path that matches no submission satisfies nothing.

-- owners (solo participant, or any member of the owning team) may add/replace/
-- remove their document while the submission window is open — the SAME
-- active-event + deadline rule save_submission enforces
create policy "submission docs owner write" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'submission-docs'
    and exists (
      select 1 from public.submissions s
      join public.events e on e.id = s.event_id
      where s.id::text || '.pdf' = split_part(objects.name, '/', 2)
        and s.event_id::text = split_part(objects.name, '/', 1)
        and e.status = 'active'
        and (nullif(e.submission_config ->> 'deadline', '') is null
             or now() <= (e.submission_config ->> 'deadline')::timestamptz)
        and ((s.participant_id is not null and exists (
                select 1 from public.participants p
                where p.id = s.participant_id and p.user_id = auth.uid()))
             or (s.team_id is not null
                 and s.team_id in (select public.current_user_team_ids())))
    )
  );

create policy "submission docs owner update" on storage.objects
  for update to authenticated using (
    bucket_id = 'submission-docs'
    and exists (
      select 1 from public.submissions s
      join public.events e on e.id = s.event_id
      where s.id::text || '.pdf' = split_part(objects.name, '/', 2)
        and s.event_id::text = split_part(objects.name, '/', 1)
        and e.status = 'active'
        and (nullif(e.submission_config ->> 'deadline', '') is null
             or now() <= (e.submission_config ->> 'deadline')::timestamptz)
        and ((s.participant_id is not null and exists (
                select 1 from public.participants p
                where p.id = s.participant_id and p.user_id = auth.uid()))
             or (s.team_id is not null
                 and s.team_id in (select public.current_user_team_ids())))
    )
  );

create policy "submission docs owner delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'submission-docs'
    and exists (
      select 1 from public.submissions s
      where s.id::text || '.pdf' = split_part(objects.name, '/', 2)
        and s.event_id::text = split_part(objects.name, '/', 1)
        and (public.can_manage_event(s.event_id)
             or (s.participant_id is not null and exists (
                   select 1 from public.participants p
                   where p.id = s.participant_id and p.user_id = auth.uid()))
             or (s.team_id is not null
                 and s.team_id in (select public.current_user_team_ids())))
    )
  );

-- readers: owners always; Event Managers always; judges only once the entry is
-- SUBMITTED (drafts stay private) — exactly the submissions_select surface
create policy "submission docs read" on storage.objects
  for select to authenticated using (
    bucket_id = 'submission-docs'
    and exists (
      select 1 from public.submissions s
      where s.id::text || '.pdf' = split_part(objects.name, '/', 2)
        and s.event_id::text = split_part(objects.name, '/', 1)
        and (public.can_manage_event(s.event_id)
             or (public.has_event_role(s.event_id, array['judge']) and s.status = 'submitted')
             or (s.participant_id is not null and exists (
                   select 1 from public.participants p
                   where p.id = s.participant_id and p.user_id = auth.uid()))
             or (s.team_id is not null
                 and s.team_id in (select public.current_user_team_ids())))
    )
  );

-- ============================================================================
-- 3. DOCUMENT REFERENCE on the existing submission record
-- ============================================================================

alter table public.submissions
  add column document_path text,
  add column document_name text;

alter table public.submissions
  add constraint submissions_document_pair
  check ((document_path is null) = (document_name is null));

-- ============================================================================
-- 4. save_submission — same lifecycle, optional document reference
-- ============================================================================
-- The 5-arg signature is DROPPED (overloads break PostgREST named calls,
-- PGRST203). Passing p_document_path:
--   null           -> keep the currently stored document reference
--   ''             -> clear it (the client also deletes the storage object)
--   canonical path -> record it (must be EXACTLY this submission's path)

drop function public.save_submission(uuid, text, text, jsonb, boolean);

create function public.save_submission(
  p_event_id uuid,
  p_title text,
  p_description text default '',
  p_content jsonb default '{}',
  p_submit boolean default false,
  p_document_path text default null,
  p_document_name text default null
) returns public.submissions
language plpgsql security definer set search_path = public as $$
declare
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_sub submissions%rowtype;
  v_deadline timestamptz;
  v_doc_path text;
  v_doc_name text;
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
  end if;

  -- document reference: null = keep, '' = clear, else the CANONICAL path only
  if p_document_path is null then
    v_doc_path := v_sub.document_path;
    v_doc_name := v_sub.document_name;
  elsif p_document_path = '' then
    v_doc_path := null;
    v_doc_name := null;
  else
    if p_document_path <> (v_sub.event_id::text || '/' || v_sub.id::text || '.pdf') then
      raise exception 'Invalid document path for this submission';
    end if;
    if coalesce(trim(p_document_name), '') = '' then
      raise exception 'Document name is required';
    end if;
    v_doc_path := p_document_path;
    v_doc_name := trim(p_document_name);
  end if;

  -- editing stays open until the deadline; a submitted entry never silently
  -- reverts to draft (00016 semantics, unchanged)
  update submissions set
    title = trim(p_title),
    description = coalesce(p_description, ''),
    content = coalesce(p_content, '{}'::jsonb),
    document_path = v_doc_path,
    document_name = v_doc_name,
    status = case when p_submit or v_sub.status = 'submitted' then 'submitted' else 'draft' end,
    submitted_at = case when v_sub.submitted_at is not null then v_sub.submitted_at
                        when p_submit then now() end
  where id = v_sub.id
  returning * into v_sub;

  return v_sub;
end $$;

-- DROP removed the old signature's grants; restore the 00016 posture.
revoke all on function public.save_submission(uuid, text, text, jsonb, boolean, text, text) from public, anon;
grant execute on function public.save_submission(uuid, text, text, jsonb, boolean, text, text) to authenticated, service_role;

-- ============================================================================
-- Rollback:
--   drop function public.save_submission(uuid, text, text, jsonb, boolean, text, text);
--   -- recreate the 00016 save_submission(uuid, text, text, jsonb, boolean)
--   -- verbatim + its revoke/grant lines
--   alter table public.submissions drop constraint submissions_document_pair;
--   alter table public.submissions drop column document_path, drop column document_name;
--   drop policy "submission docs read" on storage.objects;
--   drop policy "submission docs owner delete" on storage.objects;
--   drop policy "submission docs owner update" on storage.objects;
--   drop policy "submission docs owner write" on storage.objects;
--   delete from storage.buckets where id = 'submission-docs';
-- ============================================================================

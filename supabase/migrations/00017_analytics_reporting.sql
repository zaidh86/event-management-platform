-- 00017: analytics, reflections & certificates (ADR-0012).
--
-- Phase 6 data layer. Three deliberately small additions:
--
--   1. feedback_forms.kind — REFLECTIONS reuse the entire feedback engine
--      (builder, publish lifecycle, access rules, responses, dedupe, RLS)
--      instead of a parallel system. A reflection is a feedback form with
--      kind = 'reflection'; the UI labels it accordingly.
--
--   2. certificates — universal, capability-gated (the dormant 'certificates'
--      capability from 00006 becomes real). One row per issued certificate,
--      owned by a participant OR a team, with a unique opaque verify code for
--      public verification. Issuance is Event-Manager-only via a SECURITY
--      DEFINER RPC with scope-based bulk issue (all registered / all attended
--      / one participant / one team) and duplicate protection.
--
--   3. verify_certificate — anon-safe verification: code -> the minimum public
--      surface (event name, holder display name, kind/title/detail, issue
--      date). Invalid codes return {valid:false}; nothing else leaks.
--
-- Analytics itself needs NO new tables: registrations, attendance, scans,
-- transactions, feedback and judging are already queryable under existing
-- staff RLS. AI assistance is an Edge Function concern (service-role, outside
-- the DB) — nothing here grants AI any database surface.
--
-- Additive; 00001-00016 untouched. Rollback notes at the end.

-- ============================================================================
-- 1. REFLECTIONS = feedback forms with a kind
-- ============================================================================

alter table public.feedback_forms
  add column kind text not null default 'feedback'
  check (kind in ('feedback', 'reflection'));

-- ============================================================================
-- 2. CERTIFICATES
-- ============================================================================

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  participant_id uuid references public.participants (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  kind text not null default 'participation'
    check (kind in ('participation', 'achievement', 'completion')),
  title text not null,
  detail text not null default '',
  -- public verification identifier; the code is the only public lookup key
  verify_code text not null unique default ('c_' || encode(gen_random_bytes(9), 'hex')),
  issued_by uuid references public.profiles (id),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint certificates_one_owner check ((participant_id is null) <> (team_id is null))
);

-- duplicate protection: the same certificate (kind+title) is issued at most
-- once per holder — bulk re-issue becomes idempotent
create unique index certificates_participant_once
  on public.certificates (participant_id, kind, title) where participant_id is not null;
create unique index certificates_team_once
  on public.certificates (team_id, kind, title) where team_id is not null;
create index certificates_event_idx on public.certificates (event_id, created_at desc);

alter table public.certificates enable row level security;

-- holders see their own; Event Managers see and revoke all.
-- Public verification NEVER reads the table directly — verify_certificate only.
create policy certificates_select on public.certificates
  for select to authenticated using (
    can_manage_event(event_id)
    or (participant_id is not null and exists (
          select 1 from participants p
          where p.id = participant_id and p.user_id = auth.uid()))
    or (team_id is not null and team_id in (select current_user_team_ids()))
  );
create policy certificates_delete on public.certificates
  for delete to authenticated using (can_manage_event(event_id));

grant select, delete on public.certificates to authenticated;
grant select, insert, update, delete on public.certificates to service_role;

-- ============================================================================
-- 3. issue_certificates — Event-Manager bulk/single issuance
-- ============================================================================
-- p_scope: 'registered' (every participant) | 'attended' (participants with an
--          attendance row) | 'participant' (one, p_target_id) | 'team' (one
--          team certificate, p_target_id)
-- Returns {issued: n, skipped: n} — skipped = holders who already had this
-- exact certificate (idempotent re-runs).

create function public.issue_certificates(
  p_event_id uuid,
  p_kind text,
  p_title text,
  p_detail text default '',
  p_scope text default 'registered',
  p_target_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ev events%rowtype;
  v_issued int := 0;
  v_skipped int := 0;
  v_p record;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_ev from events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;
  if not can_manage_event(p_event_id) then
    raise exception 'Only Event Managers can issue certificates';
  end if;
  if not coalesce((v_ev.capabilities ->> 'certificates')::boolean, false) then
    raise exception 'Certificates are not enabled for this event';
  end if;
  if p_kind not in ('participation', 'achievement', 'completion') then
    raise exception 'Invalid certificate kind "%"', p_kind;
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Title is required';
  end if;
  if p_scope not in ('registered', 'attended', 'participant', 'team') then
    raise exception 'Invalid scope "%"', p_scope;
  end if;

  if p_scope = 'team' then
    if p_target_id is null or not exists (
      select 1 from teams t where t.id = p_target_id and t.event_id = p_event_id
    ) then
      raise exception 'Team not found in this event';
    end if;
    begin
      insert into certificates (event_id, team_id, kind, title, detail, issued_by)
      values (p_event_id, p_target_id, p_kind, trim(p_title), coalesce(p_detail, ''), auth.uid());
      v_issued := 1;
    exception when unique_violation then
      v_skipped := 1;
    end;
    return jsonb_build_object('issued', v_issued, 'skipped', v_skipped);
  end if;

  for v_p in
    select p.id from participants p
    where p.event_id = p_event_id
      and (p_scope <> 'participant' or p.id = p_target_id)
      and (p_scope <> 'attended' or exists (
            select 1 from attendance a
            where a.event_id = p_event_id and a.participant_id = p.id))
  loop
    begin
      insert into certificates (event_id, participant_id, kind, title, detail, issued_by)
      values (p_event_id, v_p.id, p_kind, trim(p_title), coalesce(p_detail, ''), auth.uid());
      v_issued := v_issued + 1;
    exception when unique_violation then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  if p_scope = 'participant' and v_issued + v_skipped = 0 then
    raise exception 'Participant not found in this event';
  end if;

  return jsonb_build_object('issued', v_issued, 'skipped', v_skipped);
end $$;

revoke all on function public.issue_certificates(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.issue_certificates(uuid, text, text, text, text, uuid) to authenticated, service_role;

-- ============================================================================
-- 4. verify_certificate — public verification by code only
-- ============================================================================

create function public.verify_certificate(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_c certificates%rowtype;
  v_ev events%rowtype;
  v_holder text;
begin
  select * into v_c from certificates where verify_code = p_code;
  if not found then
    return jsonb_build_object('valid', false);
  end if;
  select * into v_ev from events where id = v_c.event_id;
  select coalesce(t.name, p.display_name) into v_holder
  from certificates c
  left join teams t on t.id = c.team_id
  left join participants p on p.id = c.participant_id
  where c.id = v_c.id;

  return jsonb_build_object(
    'valid', true,
    'event_name', v_ev.name,
    'event_logo_url', v_ev.logo_url,
    'theme_color', v_ev.theme_color,
    'holder_name', v_holder,
    'holder_type', case when v_c.team_id is not null then 'team' else 'participant' end,
    'kind', v_c.kind,
    'title', v_c.title,
    'detail', v_c.detail,
    'issued_at', v_c.created_at,
    'verify_code', v_c.verify_code
  );
end $$;

revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated, service_role;

-- ============================================================================
-- Rollback:
--   drop function public.verify_certificate(text);
--   drop function public.issue_certificates(uuid, text, text, text, text, uuid);
--   drop table public.certificates;
--   alter table public.feedback_forms drop column kind;
-- ============================================================================

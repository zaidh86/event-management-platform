-- 00021: club faculty/convener roles, participant removal, feedback segregation.
--
-- Three changes, all reusing the existing architecture. No existing migration
-- is touched and no existing policy is rewritten except the one documented in
-- section 2c (a deliberate closure of an unsafe raw write path).
--
--   1. CLUB ROLES — club_members.role gains 'convener' and 'faculty'.
--      Convener = a teacher who runs the club: FULL club authority, exactly
--      what club_admin has. Faculty = a teacher associated with the club with
--      NO authority whatsoever — an ordinary member that happens to be staff.
--
--      This needs exactly TWO statements because is_club_admin() is the SOLE
--      chokepoint for club authority in this schema: `role = 'club_admin'`
--      appears once in the entire SQL surface (00004:40), and every other
--      site — clubs_update, club_members_insert/update/delete, events_insert/
--      select_auth/update/delete, protect_event_club, can_manage_event — calls
--      the predicate rather than comparing the column. Widening the CHECK and
--      replacing the predicate BODY therefore grants convener full authority
--      everywhere at once, atomically, without dropping a single policy. This
--      is the same manoeuvre 00007 used to make platform_owner inherit
--      super_admin everywhere by rewriting is_super_admin() alone.
--
--      Faculty gains nothing by simply being absent from the predicate. It
--      still satisfies is_club_member() (00004:31), so a faculty member reads
--      the roster like any member — which IS "associated, no authority".
--
--      NOT changed: clubs_insert / clubs_delete stay is_super_admin() (00004:53,
--      00010:36). club_admin cannot create or delete clubs today, so "the same
--      authority as club_admin" means convener cannot either.
--
--   2. PARTICIPANT REMOVAL — an Event Manager action that removes a
--      registration from ONE event. It never touches the user's account, their
--      club membership, or their registrations in other events.
--
--      Today a raw PostgREST DELETE already does this (00001:709 policy +
--      00003:22 grant) and it is UNSAFE: accounts.owner_id is a soft
--      polymorphic link with no FK (00001:88-92), so deleting a participant
--      strands their account, keeps the whole transaction ledger alive beneath
--      an ownerless account, and makes get_leaderboard's LEFT JOIN (00001:589)
--      emit a null-name ghost row. This migration replaces that path with a
--      guarded SECURITY DEFINER RPC and closes the raw one — the same posture
--      00012:304-305 took when it revoked table-wide UPDATE on this table.
--
--   3. FEEDBACK SEGREGATION — feedback_responses gains respondent_category,
--      stamped SERVER-SIDE at insert time from the respondent's role in the
--      event's own club. Stored, not derived: club_members_select (00004:56)
--      only returns rows to members of that club, so an organizer who is not a
--      club member would read zero rows and silently classify everyone as
--      regular. Storing it also freezes the fact at submission time, which is
--      what "who gave this feedback" actually means.
--
--      Historical rows stay NULL — never backfilled to 'regular'. A NULL says
--      "recorded before segregation existed"; 'regular' would be an assertion
--      about faculty feedback that nobody ever measured.
--
-- Additive; 00001-00020 untouched. Rollback notes at the end.


-- ============================================================================
-- 1. CLUB ROLES: convener (full authority) + faculty (none)
-- ============================================================================

-- 1a. Widen the role CHECK. 00004:22 declares it inline and unnamed, so its
--     identifier is whatever Postgres generated (club_members_role_check on
--     every normal path). Resolve the real name from the catalog instead of
--     assuming it, and fail loudly rather than half-applying — the 00018
--     precondition-guard pattern. Existing rows hold 'club_admin' or 'member',
--     both still permitted, so the revalidation this triggers cannot fail.
do $$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'club_members'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%club_admin%';

  if v_name is null then
    raise exception
      'Cannot widen club_members.role: no CHECK constraint mentioning club_admin was found'
      using hint = 'Inspect pg_constraint for public.club_members before re-running 00021.';
  end if;

  execute format('alter table public.club_members drop constraint %I', v_name);
end $$;

alter table public.club_members add constraint club_members_role_check
  check (role in ('club_admin', 'convener', 'faculty', 'member'));

-- 1b. THE authority change, body-only. Signature is unchanged, so the implicit
--     PUBLIC EXECUTE grant this function has always carried survives, no
--     DROP FUNCTION is needed, no overload is created (PGRST203), and every
--     one of the 13 call sites picks up convener without being touched.
--
--     'faculty' is deliberately absent: faculty is an association, not a
--     permission. Adding it here would silently make every teacher a club
--     administrator, which is precisely the opposite of the intent.
create or replace function public.is_club_admin(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1 from club_members
    where club_id = p_club_id and user_id = auth.uid()
      and role in ('club_admin', 'convener')
  );
$$;


-- ============================================================================
-- 2. PARTICIPANT REMOVAL
-- ============================================================================

-- 2a. Audit trail. The removal destroys rows that cannot be reconstructed
--     (registration answers, final balance, the ledger under a personal
--     account), so what is destroyed is recorded before it goes.
--
--     participant_id is deliberately NOT a foreign key: the row it names is
--     gone by design, and an FK would either block the insert or delete the
--     audit record with it.
create table public.participant_removals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  participant_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  display_name text not null,
  participation_mode text not null default 'solo',
  team_id uuid,
  registration_data jsonb not null default '{}',
  final_balance numeric,
  transaction_count int not null default 0,
  certificates_removed int not null default 0,
  attendance_removed boolean not null default false,
  forced boolean not null default false,
  reason text not null default '',
  removed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index participant_removals_event_idx
  on public.participant_removals (event_id, created_at desc);

alter table public.participant_removals enable row level security;

-- Event Managers read the log. NOBODY writes it directly — rows are inserted
-- only by the SECURITY DEFINER function below (no write grant, no write
-- policy), the same double lock scans (00014:148) uses.
create policy participant_removals_select on public.participant_removals
  for select to authenticated using (can_manage_event(event_id));

grant select on public.participant_removals to authenticated;
grant select, insert, update, delete on public.participant_removals to service_role;

-- 2b. The removal entry point.
--
--     Returns jsonb rather than raising for refusals the caller can act on —
--     the submit_feedback(00019) convention — so the UI can name exactly what
--     stands in the way. Genuine faults (missing row, no authority) still
--     raise.
--
--     REFUSAL POLICY
--       submissions            -> ABSOLUTE. submissions.participant_id is
--                                 ON DELETE CASCADE (00016:61) and
--                                 judge_evaluations.submission_id cascades from
--                                 there (00016:156), so one removal would erase
--                                 an entry and every judge's scoring of it.
--                                 Delete the submission deliberately first.
--
--                                 Scoped to PARTICIPANT-OWNED entries on
--                                 purpose. A team's entry carries
--                                 participant_id = null (submissions_one_owner,
--                                 00016:72) and belongs to the team row, which
--                                 survives this removal — nothing cascades, so
--                                 there is nothing to refuse. Emptying that
--                                 team is reported via team_now_empty instead.
--       certificates           -> overridable. Cascades (00017:43), and the
--                                 issued verify_code stops resolving.
--       ledger activity        -> overridable. Deleting the personal account
--                                 cascades its transactions (00001:115).
--                                 The automatic 'starting_balance' row is NOT
--                                 counted: every solo registrant in a
--                                 points event has one, so counting it would
--                                 fire the override on every removal and train
--                                 organizers to click through it blindly.
--       attendance             -> never blocks. A check-in for an event the
--                                 person is no longer in is meaningless.
--
--     Overriding requires p_force AND a non-empty reason, both recorded.
create function public.remove_event_participant(
  p_participant_id uuid,
  p_reason text default '',
  p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p participants%rowtype;
  v_acc_id uuid;
  v_balance numeric;
  v_tx_total int := 0;
  v_tx_notable int := 0;
  v_subs int := 0;
  v_evals int := 0;
  v_certs int := 0;
  v_attended boolean := false;
  v_team_now_empty boolean := false;
  v_reason text := coalesce(trim(p_reason), '');
  -- normalized once: an explicit NULL from a hand-written PostgREST call would
  -- otherwise make `not p_force` and `p_force and ...` both evaluate to NULL,
  -- skipping the refusal gate AND the reason requirement on the way to a NOT
  -- NULL violation on participant_removals.forced
  v_force boolean := coalesce(p_force, false);
  v_blockers text[] := '{}';
begin
  select * into v_p from participants where id = p_participant_id;
  if not found then
    raise exception 'Participant not found';
  end if;

  -- Event Manager = organizer of this event, club admin/convener of its club,
  -- or a platform admin (00014:37). Identical to every other destructive event
  -- surface since 00014 — this introduces no new authority shape.
  if not public.can_manage_event(v_p.event_id) then
    raise exception 'Only Event Managers can remove participants from this event';
  end if;

  -- what removal would take with it
  select count(*) into v_subs from submissions where participant_id = v_p.id;
  select count(*) into v_evals
  from judge_evaluations je
  join submissions s on s.id = je.submission_id
  where s.participant_id = v_p.id;
  select count(*) into v_certs from certificates where participant_id = v_p.id;
  select exists (select 1 from attendance where participant_id = v_p.id) into v_attended;

  select a.id, a.balance into v_acc_id, v_balance
  from accounts a
  where a.owner_type = 'participant' and a.owner_id = v_p.id;

  if v_acc_id is not null then
    select count(*) into v_tx_total from transactions where account_id = v_acc_id;
    select count(*) into v_tx_notable
    from transactions where account_id = v_acc_id and type <> 'starting_balance';
  end if;

  -- ABSOLUTE refusal: no p_force path exists for this one.
  if v_subs > 0 then
    return jsonb_build_object(
      'status', 'blocked',
      'override_allowed', false,
      'display_name', v_p.display_name,
      'reasons', jsonb_build_array(
        case when v_evals > 0 then
          format('%s has %s submission(s) carrying %s judge evaluation(s). Removing them would delete both.',
                 v_p.display_name, v_subs, v_evals)
        else
          format('%s has %s submission(s). Removing them would delete the entry.',
                 v_p.display_name, v_subs)
        end),
      -- submissions_delete (00016:98) already permits an Event Manager to delete
      -- the row, but no client surface calls it yet, so name the real route
      -- rather than a button that does not exist.
      'hint', 'Their submission must be deleted first — an Event Manager action, currently available only through the database.'
    );
  end if;

  if v_certs > 0 then
    v_blockers := v_blockers || format('%s issued certificate(s) will be revoked and stop verifying.', v_certs);
  end if;
  if v_tx_notable > 0 then
    v_blockers := v_blockers ||
      format('%s ledger entrie(s) and a balance of %s will be deleted with their account.',
             v_tx_notable, coalesce(v_balance, 0));
  end if;

  if array_length(v_blockers, 1) is not null and not v_force then
    return jsonb_build_object(
      'status', 'blocked',
      'override_allowed', true,
      'display_name', v_p.display_name,
      'reasons', to_jsonb(v_blockers)
    );
  end if;

  if v_force and v_reason = '' then
    raise exception 'A reason is required to remove a participant with certificates or ledger history';
  end if;

  -- Emptying a team is REPORTED, never acted on: teams carry a name, a QR
  -- token and possibly their own account and submission. Deciding their fate is
  -- an organizer's call, not a side effect of removing one member.
  if v_p.team_id is not null then
    select not exists (
      select 1 from participants
      where team_id = v_p.team_id and id <> v_p.id
    ) into v_team_now_empty;
  end if;

  insert into participant_removals (
    event_id, participant_id, user_id, display_name, participation_mode, team_id,
    registration_data, final_balance, transaction_count, certificates_removed,
    attendance_removed, forced, reason, removed_by
  ) values (
    v_p.event_id, v_p.id, v_p.user_id, v_p.display_name, v_p.participation_mode, v_p.team_id,
    v_p.registration_data, v_balance, v_tx_total, v_certs,
    v_attended, v_force, v_reason, auth.uid()
  );

  -- Their event ROLE row, but only when it is the registration-created
  -- 'participant' row. An organizer who also registered keeps their organizer
  -- standing: register_for_event never downgrades it (00012:126-128 upserts
  -- with `do nothing`), so removal must not either.
  delete from event_members
  where event_id = v_p.event_id and user_id = v_p.user_id and role = 'participant';

  -- The registration itself. Cascades attendance (00014:164) and certificates
  -- (00017:43); submissions are impossible here, blocked above.
  delete from participants where id = v_p.id;

  -- The PERSONAL account, matched on the participant id — never `by event`.
  -- A team-mode participant owns no account and shares their team's, which
  -- must survive them. Cascades this account's transactions (00001:115).
  if v_acc_id is not null then
    delete from accounts where id = v_acc_id;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'display_name', v_p.display_name,
    'account_deleted', v_acc_id is not null,
    'transactions_deleted', v_tx_total,
    'certificates_deleted', v_certs,
    'attendance_deleted', v_attended,
    'team_id', v_p.team_id,
    'team_now_empty', v_team_now_empty
  );
end $$;

revoke all on function public.remove_event_participant(uuid, text, boolean) from public, anon;
grant execute on function public.remove_event_participant(uuid, text, boolean)
  to authenticated, service_role;

-- 2c. Close the raw path.
--
--     THE ONLY EXISTING POLICY THIS MIGRATION REMOVES, and it is removed
--     because leaving it would make everything above advisory: an organizer
--     could still issue a bare PostgREST DELETE and produce exactly the orphan
--     described in the header. The authority is not reduced — the same people
--     may still remove the same participants, now through a path that cleans
--     up after itself and records what it destroyed.
--
--     Nothing in src/ uses the raw path (verified: api.ts has no participant
--     delete), and service_role keeps full access via the 00003 blanket grant.
drop policy participants_delete on public.participants;
revoke delete on public.participants from authenticated;


-- ============================================================================
-- 3. FEEDBACK SEGREGATION
-- ============================================================================

-- 3a. NULLABLE, NO DEFAULT — the two properties that protect history.
--
--     Nullable so every pre-00021 row keeps saying "unknown" instead of being
--     asserted as regular feedback. No default so a row that somehow bypasses
--     the trigger lands as NULL (visibly unclassified) rather than silently
--     inheriting a category it was never measured for. 'anonymous' is a third
--     value, not a synonym for regular: an unattributable respondent may well
--     have been faculty, and the data should not pretend otherwise.
alter table public.feedback_responses
  add column respondent_category text
  check (respondent_category is null
         or respondent_category in ('faculty', 'regular', 'anonymous'));

-- 3b. Server-side stamping.
--
--     A TRIGGER, not an edit to submit_feedback: the trigger covers EVERY
--     insert path including service_role imports, and needs no signature
--     change — submit_feedback keeps its 4-arg identity, so no DROP FUNCTION,
--     no re-issued grants, and no PostgREST overload ambiguity (PGRST203),
--     which 00019:292-294 warns is a live hazard on this exact function.
--
--     It overwrites unconditionally, so a hand-crafted category cannot be
--     self-declared. (There is no client INSERT grant on feedback_responses
--     today — 00014:266 grants only select+delete — so this is defence in
--     depth rather than the only lock.)
--
--     It reads club_members DIRECTLY and deliberately does NOT call
--     is_club_admin(): that predicate ORs is_super_admin() first (00004:37),
--     which would brand every platform admin as faculty of every club, and it
--     reads auth.uid() rather than the row's respondent_id, which is wrong for
--     any insert made on someone else's behalf.
create function public.stamp_feedback_respondent_category()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_club_id uuid;
  v_role text;
begin
  if new.respondent_id is null then
    new.respondent_category := 'anonymous';
    return new;
  end if;

  select e.club_id into v_club_id from events e where e.id = new.event_id;

  -- events.club_id is NOT NULL since 00018:30, so this arm is unreachable in
  -- practice; it exists so the trigger degrades to 'regular' rather than
  -- raising if that ever changes.
  if v_club_id is null then
    new.respondent_category := 'regular';
    return new;
  end if;

  -- Faculty standing is scoped to THE EVENT'S OWN CLUB. A convener of another
  -- club responding here is a guest, and counts as regular feedback.
  select cm.role into v_role
  from club_members cm
  where cm.club_id = v_club_id and cm.user_id = new.respondent_id;

  -- v_role IS NULL (not a member) yields NULL from IN, so CASE falls to ELSE.
  new.respondent_category :=
    case when v_role in ('faculty', 'convener') then 'faculty' else 'regular' end;

  return new;
end $$;

-- BEFORE INSERT only. An UPDATE arm would re-stamp historical NULL rows with
-- today's roster the first time anything touched them, destroying the very
-- snapshot this column exists to hold.
--
-- Default enablement, NOT `enable always`: there is no client INSERT grant to
-- bypass here, and ORIGIN correctly skips replica-mode paths, so a
-- `pg_restore --disable-triggers` reload of archived responses cannot be
-- re-stamped with present-day roles.
create trigger feedback_responses_stamp_category
before insert on public.feedback_responses
for each row execute function public.stamp_feedback_respondent_category();

-- No grant change: 00014:266 grants authenticated select on the TABLE, which
-- covers columns added later, and the read policies are unchanged — organizers
-- see responses for events they manage, respondents see their own.


-- ============================================================================
-- Rollback:
--   -- 3
--   drop trigger feedback_responses_stamp_category on public.feedback_responses;
--   drop function public.stamp_feedback_respondent_category();
--   alter table public.feedback_responses drop column respondent_category;
--   -- 2
--   grant delete on public.participants to authenticated;
--   create policy participants_delete on public.participants
--     for delete to authenticated using (has_event_role(event_id, array['organizer']));
--   drop function public.remove_event_participant(uuid, text, boolean);
--   drop table public.participant_removals;
--   -- 1  (reverting 1a requires every member to hold club_admin or member
--   --     first: `select * from club_members where role in ('convener','faculty')`
--   --     must be empty, or the re-added constraint fails validation)
--   create or replace function public.is_club_admin(p_club_id uuid)
--   returns boolean language sql stable security definer set search_path = public as $$
--     select public.is_super_admin() or exists (
--       select 1 from club_members
--       where club_id = p_club_id and user_id = auth.uid() and role = 'club_admin'
--     );
--   $$;
--   alter table public.club_members drop constraint club_members_role_check;
--   alter table public.club_members add constraint club_members_role_check
--     check (role in ('club_admin', 'member'));
-- ============================================================================

-- 00011: retire the General fallback club (ADR-0001 amendment 2).
--
-- Every event now belongs to a real club. The three sites that resolve the
-- fallback all degrade to NULL *silently* rather than raising, so deleting the
-- club row without removing the machinery would orphan every later event with no
-- error, no log and no failed request:
--   * default_event_club() (00005:19-26) — plpgsql SELECT INTO without STRICT
--     assigns NULL on zero rows and does not raise;
--   * events_insert arm `club_id is null` (00005:39) — admits exactly those rows
--     from any authenticated user;
--   * events_insert arm `club_id = (... slug='general')` (00005:40) — becomes a
--     permanently-false subquery evaluated on every insert.
-- They are retired together, or not at all.
--
-- ORDER MATTERS INSIDE THIS FILE: the insert policy is tightened BEFORE the
-- fallback trigger is dropped. The reverse order leaves a window in which the
-- permissive `club_id is null` arm is still live with no trigger to populate it —
-- any event created in that window is silently orphaned. Harmless when the whole
-- file runs as one transaction, but this file is written to be safe on a
-- statement-at-a-time apply path too.
--
-- The 00004/00005 seeds are deliberately NOT edited: those migrations are applied,
-- and editing them would rewrite history. On a fresh rebuild the seeds are skipped
-- anyway (both are gated on an existing super_admin profile, which a fresh
-- database has not yet created), so this migration takes its no-General branch and
-- the end state is correct either way.
--
-- The invariant is enforced on BOTH write paths. events_insert alone would leave
-- it trivially reversible: events_update (00001:676-678) carried no club_id
-- predicate, so any organizer could null the column or move the event into a club
-- they do not administer — recreating exactly the orphan state this migration
-- aborts on, and letting an organizer empty a club so a super admin deletes it
-- believing it was empty (00010's safety rests on that FK).
--
-- NOT in scope: events.club_id stays nullable (the NOT NULL wave remains deferred
-- and separately approved), no grants change, no other table touched.
--
-- APPLY AS postgres (Supabase SQL editor) or via `supabase db push`.
-- APPLY 00010 AND 00011 AS ONE SCRIPT, in a single run — applying 00010 alone
-- leaves a window where General is deletable while its fallback machinery is
-- still armed.

-- ── 1. PRECONDITIONS. First statement on purpose: no DDL runs before the gate, so
--       an abort leaves the database exactly as it was.
do $$
declare
  v_general uuid;
  v_null    bigint;
  v_owned   bigint;
  v_members bigint;
begin
  -- `for update` closes the race where a membership is added between the count
  -- below and the delete at the end: the concurrent writer blocks, then aborts.
  select id into v_general from public.clubs where slug = 'general' for update;

  -- Orphans are possible even on a healthy database: 00005's backfill is an
  -- unguarded scalar subquery that writes NULL when General is absent, and the
  -- seed it depends on tests role = 'super_admin' — a predicate 00007 never
  -- widened to platform_owner.
  select count(*) into v_null from public.events where club_id is null;
  if v_null > 0 then
    raise exception 'ABORT: % event(s) already have club_id IS NULL.', v_null
      using hint = 'Assign each a real club, then re-run. List them with: '
                   'select id, name, slug, status from public.events where club_id is null;';
  end if;

  if v_general is null then
    raise notice 'No General club row present — removing the fallback machinery only.';
  else
    select count(*) into v_owned from public.events where club_id = v_general;
    if v_owned > 0 then
      raise exception 'ABORT: % event(s) still belong to the General club.', v_owned
        using hint = 'events.club_id is NO ACTION, so the delete below would raise 23503 anyway. '
                     'Reassign each event to a real club first — there is no automatic destination.';
    end if;

    -- club_members.club_id is ON DELETE CASCADE (00004:20): these rows would
    -- vanish with no error and no audit trail.
    select count(*) into v_members from public.club_members where club_id = v_general;
    if v_members > 0 then
      raise exception 'ABORT: General has % membership row(s) that ON DELETE CASCADE would destroy silently.', v_members
        using hint = 'Move or delete them deliberately first: select user_id, role from public.club_members '
                     'where club_id = (select id from public.clubs where slug = ''general'');';
    end if;

    raise notice 'General club is empty (0 events, 0 memberships) — safe to remove.';
  end if;
end $$;

-- Fail fast instead of freezing the events table if another session holds a lock:
-- the DDL below takes ACCESS EXCLUSIVE on public.events.
set local lock_timeout = '5s';

-- ── 2. Club-scoped event creation only: no null arm, no General arm.
--       `club_id is not null` is LOAD-BEARING, not decorative — is_club_admin()
--       (00004:36-42) returns is_super_admin() OR a membership test, so
--       is_club_admin(NULL) is TRUE for super admins and the platform owner.
--       Without this conjunct they could still insert club-less events; with it
--       the whole predicate is false regardless of evaluation order.
--       Postgres has no CREATE OR REPLACE POLICY, hence drop-then-create.
drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated with check (
    created_by = auth.uid()
    and club_id is not null
    and is_club_admin(club_id)
  );

-- ── 3. Club admins manage their club's events (ADR-0002: "Club Admin is the
--       manager of their club and its events"). The organizer-only model made
--       that false in practice: club_admin Bob could not see, edit or delete a
--       draft created by club_admin Alice in the SAME club. SELECT, UPDATE and
--       DELETE therefore gain an is_club_admin(club_id) arm.
--
--       Scoping notes: is_club_admin(club_id) is club-scoped for real club
--       admins and true everywhere for platform admins (00004:36-42), so
--       platform authority is unchanged. For a legacy orphan row (club_id
--       null), is_club_admin(NULL) is false for everyone except platform
--       admins, so orphans gain no new readers or writers. The select arm only
--       adds DRAFT visibility — non-draft events were already visible to every
--       authenticated user via the `status <> 'draft'` arm.
drop policy if exists events_select_auth on public.events;
create policy events_select_auth on public.events
  for select to authenticated using (
    status <> 'draft'
    or created_by = auth.uid()
    or is_event_member(id)
    or is_super_admin()
    or is_club_admin(club_id)
  );

--       UPDATE: organizers keep configure rights; club admins gain them for
--       their club. The club_id TRANSITION rule cannot live in the policy:
--       RLS WITH CHECK sees only the NEW row, so it cannot distinguish
--       "club_id unchanged" from "club_id moved", and requiring
--       is_club_admin(club_id) unconditionally would block every update by an
--       organizer who is not a club admin — including renaming their own
--       event. Organizers who are not club admins are a legitimate, existing
--       case: event_members_insert (00001:685) lets an organizer appoint
--       another user as organizer. So the policy carries the null guard, and
--       the transition is guarded by the trigger below — the same split
--       already used for profiles.role by protect_profile_role (00007/00008).
drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using (has_event_role(id, array['organizer']) or is_club_admin(club_id))
  with check (
    (has_event_role(id, array['organizer']) or is_club_admin(club_id))
    and club_id is not null
  );

--       DELETE: platform admins anywhere; club admins within their club.
--       Organizers deliberately have NO delete arm — destroying an event and
--       its ledger is club-management authority, not event-staff authority
--       (ADR-0002 matrix). deleteEvent()'s zero-row detection keeps relying on
--       the deleted row being SELECT-visible, which every principal admitted
--       here satisfies via the select policy above.
drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated using (is_super_admin() or is_club_admin(club_id));

create or replace function public.protect_event_club()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- An event always belongs to a club: reject an insert that names none, and any
  -- update that clears one. RLS-exempt callers are covered too — the trigger is
  -- ENABLE ALWAYS below, so service_role and even a replica-mode session cannot
  -- slip past it. A row that is ALREADY orphaned is left updatable here so it can
  -- be adopted rather than frozen (note the events_update policy still requires a
  -- club for authenticated callers, so adopting one means setting club_id in the
  -- same statement). Nothing can create such a row through this trigger.
  if new.club_id is null and (tg_op = 'INSERT' or old.club_id is not null) then
    if tg_op = 'INSERT' then
      raise exception 'An event must belong to a club'
        using hint = 'Set club_id to a club you administer.';
    else
      raise exception 'Event % must belong to a club', old.id
        using hint = 'Set club_id to a club you administer.';
    end if;
  end if;

  -- Moving an event between clubs needs admin standing over both ends: over the
  -- destination so nobody can push an event into a club they do not run, and over
  -- the source so nobody can take one out of a club they do not run.
  -- is_club_admin() returns true for super admins and the platform owner
  -- everywhere (00004:36-42), so platform-level authority is unaffected.
  -- auth.uid() is null in administrative SQL contexts (editor, migrations,
  -- service role); those are trusted and pass.
  if tg_op = 'UPDATE' and new.club_id is distinct from old.club_id and auth.uid() is not null then
    if not public.is_club_admin(new.club_id) then
      raise exception 'You are not an admin of the club you are moving this event into';
    end if;
    -- old.club_id is null only for a legacy orphan; adopting one needs authority
    -- over the destination alone, which was just checked.
    if old.club_id is not null and not public.is_club_admin(old.club_id) then
      raise exception 'You are not an admin of the club this event currently belongs to';
    end if;
  end if;

  return new;
end $$;

-- NAME ORDERING MATTERS on the RLS-exempt paths: Postgres fires BEFORE ROW
-- triggers in name order, so any future BEFORE trigger on public.events that
-- sorts after 'events_protect_club' would run past this guard. Keep new triggers
-- alphabetically later than it only when they must not be guarded.
drop trigger if exists events_protect_club on public.events;
create trigger events_protect_club before insert or update on public.events
for each row execute function public.protect_event_club();

-- ENABLE ALWAYS, not the default ORIGIN: otherwise a superuser session with
-- session_replication_role = 'replica' (also pg_restore --disable-triggers and
-- logical-replication apply) would skip the guard entirely.
--
-- RUNBOOK WARNING: if this trigger is ever disabled for maintenance, re-enable it
-- with `enable always`, never plain `enable trigger` — plain ENABLE restores
-- ORIGIN silently and reopens the replica-mode hole. The verification query below
-- asserts the ALWAYS state, so re-run it after any such maintenance.
alter table public.events enable always trigger events_protect_club;

-- ── 4. Remove the auto-assign machinery. Trigger before function, no CASCADE:
--       events_default_club (00005:28) is the function's only dependent.
drop trigger  if exists events_default_club on public.events;
drop function if exists public.default_event_club();

-- ── 5. Remove the row. No-op if absent; the gate above proved it owns nothing.
--       RE-RUN NOTE: this targets the slug, so re-applying 00011 after some future
--       club takes the slug 'general' would delete THAT club if it is empty (the
--       gates still abort if it owns events or members). Don't re-run this file
--       on a database where 'general' names a real club.
delete from public.clubs where slug = 'general';

-- ── 6. Verification. The Supabase SQL editor does not surface RAISE NOTICE, so
--       this is the operator's positive confirmation.
--       The first four MUST be 0; the last MUST be 1.
select
  (select count(*) from public.clubs  where slug = 'general')                as general_rows_remaining,
  (select count(*) from public.events where club_id is null)                 as orphaned_events,
  (select count(*) from pg_trigger    where tgname = 'events_default_club'
                                        and not tgisinternal)                as fallback_triggers,
  (select count(*) from pg_proc       where proname = 'default_event_club')  as fallback_functions,
  -- tgenabled 'A' = ENABLE ALWAYS; 'O' would mean the guard is skippable in a
  -- replica-mode session, so this counts the hardened state, not mere existence
  (select count(*) from pg_trigger    where tgname = 'events_protect_club'
                                        and not tgisinternal
                                        and tgenabled = 'A')                 as club_guard_always_on;

-- Rollback. Caveats: a restored General club gets a NEW uuid, so any link or note
-- referencing the old id is stale; and the created_by subquery below fails with
-- 23502 on a database that has no super_admin/platform_owner profile — substitute
-- a known-good profile uuid there if that applies. Run the whole block as one
-- transaction; recreate the trigger BEFORE loosening the policy.
--   insert into public.clubs (slug, name, description, created_by)
--   values ('general', 'General', 'Default club for platform-wide and legacy events.',
--           (select id from public.profiles where role in ('super_admin','platform_owner')
--             order by created_at limit 1));
--
--   create function public.default_event_club()
--   returns trigger language plpgsql security definer set search_path = public as $$
--   begin
--     if new.club_id is null then
--       select id into new.club_id from clubs where slug = 'general';
--     end if;
--     return new;
--   end $$;
--
--   create trigger events_default_club before insert on public.events
--   for each row execute function public.default_event_club();
--
--   drop policy if exists events_insert on public.events;
--   create policy events_insert on public.events
--     for insert to authenticated with check (
--       created_by = auth.uid()
--       and (club_id is null
--            or club_id = (select id from clubs where slug = 'general')
--            or is_club_admin(club_id))
--     );
--
--   drop trigger  if exists events_protect_club on public.events;
--   drop function if exists public.protect_event_club();
--   drop policy   if exists events_update on public.events;
--   create policy events_update on public.events
--     for update to authenticated using (has_event_role(id, array['organizer']))
--     with check (has_event_role(id, array['organizer']));
--
--   drop policy if exists events_select_auth on public.events;
--   create policy events_select_auth on public.events
--     for select to authenticated using (
--       status <> 'draft' or created_by = auth.uid() or is_event_member(id) or is_super_admin()
--     );
--
--   drop policy if exists events_delete on public.events;
--   create policy events_delete on public.events
--     for delete to authenticated using (is_super_admin());

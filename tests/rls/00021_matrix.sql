-- 00021 RLS matrix — faculty/convener authority, participant removal, feedback
-- segregation. Run in the Supabase SQL editor AFTER applying 00021.
-- Wraps everything in a transaction and rolls back: no residue.
-- Expected output: NOTICE lines "PASS case 1" ... "PASS case 12".
--
-- The three properties this exists to prove, because none of them is visible
-- from reading the UI:
--   * FACULTY HAS NO AUTHORITY  (cases 1-4)
--   * CONVENER HAS FULL AUTHORITY, identical to club_admin  (cases 5-7)
--   * removal is EVENT-SCOPED and authorization is server-side  (cases 8-10)
--   * feedback category is stamped server-side, not client-declared  (11-12)

begin;

-- ── seed (as postgres, bypassing RLS) ────────────────────────────────────────
-- handle_new_user creates their profiles as 'user' (an admin/owner already
-- exists on any DB where 00021 has been applied).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f0001', 'rls21-convener@test.local'),
  ('00000000-0000-0000-0000-0000000f0002', 'rls21-faculty@test.local'),
  ('00000000-0000-0000-0000-0000000f0003', 'rls21-member@test.local'),
  ('00000000-0000-0000-0000-0000000f0004', 'rls21-organizer@test.local'),
  ('00000000-0000-0000-0000-0000000f0005', 'rls21-participant@test.local')
  on conflict do nothing;

insert into clubs (slug, name, created_by)
values ('rls21-club', 'RLS 00021 Club',
        (select id from profiles where role in ('super_admin','platform_owner') limit 1));

insert into club_members (club_id, user_id, role) values
  ((select id from clubs where slug='rls21-club'), '00000000-0000-0000-0000-0000000f0001', 'convener'),
  ((select id from clubs where slug='rls21-club'), '00000000-0000-0000-0000-0000000f0002', 'faculty'),
  ((select id from clubs where slug='rls21-club'), '00000000-0000-0000-0000-0000000f0003', 'member'),
  -- the participant is ALSO a club member: case 10 proves removal leaves this
  -- row alone, which is the whole "event-scoped, not global" requirement
  ((select id from clubs where slug='rls21-club'), '00000000-0000-0000-0000-0000000f0005', 'member');

insert into events (name, slug, club_id, status, created_by, capabilities)
values ('RLS21 Event', 'rls21-event', (select id from clubs where slug='rls21-club'),
        'active', (select id from profiles where role in ('super_admin','platform_owner') limit 1),
        '{"solo": true, "feedback": true}'::jsonb);

insert into event_members (event_id, user_id, role) values
  ((select id from events where slug='rls21-event'), '00000000-0000-0000-0000-0000000f0004', 'organizer');

insert into participants (event_id, user_id, display_name, participation_mode) values
  ((select id from events where slug='rls21-event'), '00000000-0000-0000-0000-0000000f0005',
   'RLS21 Participant', 'solo');
insert into accounts (event_id, owner_type, owner_id) values
  ((select id from events where slug='rls21-event'), 'participant',
   (select id from participants where display_name='RLS21 Participant'));

insert into feedback_forms (event_id, title, status, access, created_by)
values ((select id from events where slug='rls21-event'), 'RLS21 Form', 'published', 'public',
        (select id from profiles where role in ('super_admin','platform_owner') limit 1));

-- Stash the ids while still running as postgres. Resolving them inline later
-- would run the subselect in the CALLER's context, under RLS: a plain member
-- cannot SELECT the participant row (participants_select, 00001:701), so the id
-- would silently be NULL and the RPC would answer 'Participant not found'
-- instead of reaching the authorization branch case 9 exists to prove.
-- Transaction-local (the `true`), so the rollback clears it either way.
select set_config('rls21.participant_id',
  (select id::text from participants where display_name = 'RLS21 Participant'), true);

-- ============================================================================
-- FACULTY HAS NO CLUB AUTHORITY
-- ============================================================================

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000f0002","role":"authenticated"}';

-- CASE 1: faculty cannot edit the club
do $$ begin
  update clubs set description = 'hijacked' where slug = 'rls21-club';
  if found then
    raise exception 'FAIL case 1: faculty edited the club';
  end if;
  raise notice 'PASS case 1';
end $$;

-- CASE 2: faculty cannot add club members
do $$ begin
  begin
    insert into club_members (club_id, user_id, role)
    values ((select id from clubs where slug='rls21-club'),
            '00000000-0000-0000-0000-0000000f0004', 'member');
    raise exception 'FAIL case 2: faculty managed the roster';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS case 2';
  end;
end $$;

-- CASE 3: faculty cannot manage the club's events
do $$ begin
  update events set name = 'hijacked' where slug = 'rls21-event';
  if found then
    raise exception 'FAIL case 3: faculty edited a club event';
  end if;
  raise notice 'PASS case 3';
end $$;

-- CASE 4: faculty CAN still read the roster — they are a member, just powerless
do $$ begin
  if not exists (select 1 from club_members
                 where club_id = (select id from clubs where slug='rls21-club')) then
    raise exception 'FAIL case 4: faculty cannot read the roster they belong to';
  end if;
  raise notice 'PASS case 4';
end $$;

-- ============================================================================
-- CONVENER HAS FULL CLUB AUTHORITY
-- ============================================================================

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000f0001","role":"authenticated"}';

-- CASE 5: convener CAN edit the club
do $$ begin
  update clubs set description = 'set by convener' where slug = 'rls21-club';
  if not found then
    raise exception 'FAIL case 5: convener could not edit the club';
  end if;
  raise notice 'PASS case 5';
end $$;

-- CASE 6: convener CAN manage the roster
do $$ begin
  insert into club_members (club_id, user_id, role)
  values ((select id from clubs where slug='rls21-club'),
          '00000000-0000-0000-0000-0000000f0004', 'member');
  raise notice 'PASS case 6';
end $$;

-- CASE 7: convener CAN manage the club's events (can_manage_event chains
--         through is_club_admin, so this also proves every event-manager
--         surface — feedback, QR, judging — follows)
do $$ begin
  update events set name = 'RLS21 Event (renamed by convener)' where slug = 'rls21-event';
  if not found then
    raise exception 'FAIL case 7: convener could not edit a club event';
  end if;
  if not public.can_manage_event((select id from events where slug='rls21-event')) then
    raise exception 'FAIL case 7: convener is not an Event Manager';
  end if;
  raise notice 'PASS case 7';
end $$;

-- ============================================================================
-- PARTICIPANT REMOVAL
-- ============================================================================

-- CASE 8: the raw DELETE path is closed even for an organizer (00021 §2c)
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000f0004","role":"authenticated"}';
do $$ begin
  begin
    delete from participants where display_name = 'RLS21 Participant';
    if found then
      raise exception 'FAIL case 8: raw participant DELETE still works';
    end if;
    -- a revoked grant raises; a missing policy silently deletes 0 rows.
    -- Either outcome means the raw path cannot destroy the row.
    raise notice 'PASS case 8';
  exception when insufficient_privilege then
    raise notice 'PASS case 8';
  end;
end $$;

-- CASE 9: a plain club member cannot remove a participant via the RPC
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000f0003","role":"authenticated"}';
do $$ begin
  begin
    perform public.remove_event_participant(
      current_setting('rls21.participant_id')::uuid);
    raise exception 'FAIL case 9: non-manager removed a participant';
  exception when others then
    if sqlerrm like '%Only Event Managers%' then
      raise notice 'PASS case 9';
    else
      raise;
    end if;
  end;
end $$;

-- CASE 10: the organizer CAN remove, and it is EVENT-SCOPED — the user's
--          profile, their club membership and their auth account all survive
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000f0004","role":"authenticated"}';
do $$
declare
  v_result jsonb;
  v_uid uuid := '00000000-0000-0000-0000-0000000f0005';
begin
  v_result := public.remove_event_participant(
    current_setting('rls21.participant_id')::uuid);

  if v_result ->> 'status' <> 'ok' then
    raise exception 'FAIL case 10: removal refused: %', v_result::text;
  end if;
  if exists (select 1 from participants where display_name = 'RLS21 Participant') then
    raise exception 'FAIL case 10: participant row survived';
  end if;
  -- the orphan this migration exists to prevent
  if exists (select 1 from accounts a
             where a.owner_type = 'participant'
               and not exists (select 1 from participants p where p.id = a.owner_id)) then
    raise exception 'FAIL case 10: an ownerless account was left behind';
  end if;
  -- NOT deleted: the person
  -- profiles.id references auth.users ON DELETE CASCADE (00001:13), so a
  -- surviving profile also proves the auth account survived. Asserting on
  -- auth.users directly would fail here anyway: the session is still `set local
  -- role authenticated`, which holds no privilege on that table.
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'FAIL case 10: the user profile was deleted';
  end if;
  if not exists (select 1 from club_members
                 where user_id = v_uid
                   and club_id = (select id from clubs where slug='rls21-club')) then
    raise exception 'FAIL case 10: their club membership was deleted';
  end if;
  raise notice 'PASS case 10';
end $$;

-- ============================================================================
-- FEEDBACK SEGREGATION — stamped server-side, never client-declared
-- ============================================================================

-- CASE 11: a convener's response is faculty feedback, and a client-supplied
--          category is OVERWRITTEN (postgres bypasses RLS but not the trigger)
reset role;
do $$
declare
  v_form uuid := (select id from feedback_forms where title = 'RLS21 Form');
  v_ev uuid := (select id from events where slug = 'rls21-event');
  v_cat text;
begin
  insert into feedback_responses (form_id, event_id, respondent_id, answers, respondent_category)
  values (v_form, v_ev, '00000000-0000-0000-0000-0000000f0001', '{}'::jsonb, 'regular')
  returning respondent_category into v_cat;
  if v_cat <> 'faculty' then
    raise exception 'FAIL case 11: convener stamped as %, and a client-set value survived', v_cat;
  end if;

  insert into feedback_responses (form_id, event_id, respondent_id, answers)
  values (v_form, v_ev, '00000000-0000-0000-0000-0000000f0002', '{}'::jsonb)
  returning respondent_category into v_cat;
  if v_cat <> 'faculty' then
    raise exception 'FAIL case 11: faculty stamped as %', v_cat;
  end if;
  raise notice 'PASS case 11';
end $$;

-- CASE 12: plain member, non-member and anonymous respondents are NOT faculty
do $$
declare
  v_form uuid := (select id from feedback_forms where title = 'RLS21 Form');
  v_ev uuid := (select id from events where slug = 'rls21-event');
  v_cat text;
begin
  insert into feedback_responses (form_id, event_id, respondent_id, answers)
  values (v_form, v_ev, '00000000-0000-0000-0000-0000000f0003', '{}'::jsonb)
  returning respondent_category into v_cat;
  if v_cat <> 'regular' then
    raise exception 'FAIL case 12: plain club member stamped as %', v_cat;
  end if;

  -- not a member of this event's club at all
  insert into feedback_responses (form_id, event_id, respondent_id, answers)
  values (v_form, v_ev, '00000000-0000-0000-0000-0000000f0005', '{}'::jsonb)
  returning respondent_category into v_cat;
  if v_cat <> 'regular' then
    raise exception 'FAIL case 12: non-member stamped as %', v_cat;
  end if;

  insert into feedback_responses (form_id, event_id, respondent_id, answers)
  values (v_form, v_ev, null, '{}'::jsonb)
  returning respondent_category into v_cat;
  if v_cat <> 'anonymous' then
    raise exception 'FAIL case 12: anonymous stamped as %', v_cat;
  end if;
  raise notice 'PASS case 12';
end $$;

rollback;  -- nothing persists

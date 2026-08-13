-- Phase 1 RLS matrix (ADR-0005). Run in the Supabase SQL editor AFTER waves 00004-00007.
-- Wraps everything in a transaction and rolls back: no residue.
-- Expected output: NOTICE lines "PASS case 1" ... "PASS case 5".

begin;

-- Seed throwaway identities (as postgres, bypassing RLS).
-- handle_new_user creates their profiles as 'user' (an admin/owner already exists).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'rls-clubadmin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'rls-member@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'rls-outsider@test.local')
  on conflict do nothing;

insert into clubs (slug, name, created_by)
values ('rls-test-club', 'RLS Test Club',
        (select id from profiles where role in ('super_admin','platform_owner') limit 1));
insert into club_members (club_id, user_id, role) values
  ((select id from clubs where slug='rls-test-club'), '00000000-0000-0000-0000-00000000000a', 'club_admin'),
  ((select id from clubs where slug='rls-test-club'), '00000000-0000-0000-0000-00000000000b', 'member');

-- CASE 1: outsider cannot read the test club's roster (cross-club isolation)
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
do $$ begin
  if exists (select 1 from club_members
             where club_id = (select id from clubs where slug='rls-test-club')) then
    raise exception 'FAIL case 1: outsider read club roster';
  end if;
  raise notice 'PASS case 1';
end $$;

-- CASE 2: outsider cannot insert an event into the test club (spoof guard)
do $$ begin
  begin
    insert into events (name, slug, club_id, created_by)
    values ('Spoof', 'rls-spoof', (select id from clubs where slug='rls-test-club'),
            '00000000-0000-0000-0000-00000000000c');
    raise exception 'FAIL case 2: club spoofing allowed';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS case 2';
  end;
end $$;

-- CASE 3: club member (non-admin) cannot add members
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$ begin
  begin
    insert into club_members (club_id, user_id, role)
    values ((select id from clubs where slug='rls-test-club'),
            '00000000-0000-0000-0000-00000000000c', 'member');
    raise exception 'FAIL case 3: member managed roster';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS case 3';
  end;
end $$;

-- CASE 4: club admin CAN add members
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$ begin
  insert into club_members (club_id, user_id, role)
  values ((select id from clubs where slug='rls-test-club'),
          '00000000-0000-0000-0000-00000000000c', 'member');
  raise notice 'PASS case 4';
end $$;

-- CASE 5: owner demotion blocked even for postgres (trigger, not RLS)
reset role;
do $$ begin
  begin
    update profiles set role = 'user' where role = 'platform_owner';
    -- if no owner is assigned yet this update touches 0 rows and "succeeds";
    -- require the owner to exist for a meaningful test:
    if not exists (select 1 from profiles where role = 'platform_owner') then
      raise notice 'SKIP case 5: no platform owner assigned yet (run the runbook first)';
    else
      raise exception 'FAIL case 5: owner demoted';
    end if;
  exception when others then
    if sqlerrm like '%cannot be demoted%' then
      raise notice 'PASS case 5';
    else
      raise;
    end if;
  end;
end $$;

rollback;  -- nothing persists

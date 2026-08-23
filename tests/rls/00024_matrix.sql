-- 00024 matrix — empty teams are not joinable. Run in the Supabase SQL editor
-- AFTER applying 00024. Wrapped in a transaction and rolled back: no residue.
-- A clean run shows no error panel (NOTICE lines are not displayed by the
-- editor); any failure aborts with "FAIL case N".
--
-- Properties proved:
--   1 a new team (creator auto-member) IS listed by list_joinable_teams
--   2 emptying a team via remove_event_participant keeps the team row
--   3 the emptied team is NOT listed; a team with members IS
--   4 organizer reads of the teams table still include the empty team (RLS unchanged)
--   5 a participant cannot request the empty team
--   6 a pre-existing pending request cannot be accepted into the empty team
--   7 a valid request + acceptance still works
--   8 a full team is NOT listed and cannot be requested

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f3001', 'rls24-admin@test.local'),
  ('00000000-0000-0000-0000-0000000f3002', 'rls24-blead@test.local'),
  ('00000000-0000-0000-0000-0000000f3003', 'rls24-alead@test.local'),
  ('00000000-0000-0000-0000-0000000f3004', 'rls24-p4@test.local'),
  ('00000000-0000-0000-0000-0000000f3005', 'rls24-p5@test.local'),
  ('00000000-0000-0000-0000-0000000f3006', 'rls24-p6@test.local')
  on conflict do nothing;

insert into clubs (slug, name, created_by)
values ('rls24-club', 'RLS 00024 Club',
        (select id from profiles where role in ('super_admin','platform_owner') limit 1));
insert into club_members (club_id, user_id, role)
values ((select id from clubs where slug='rls24-club'), '00000000-0000-0000-0000-0000000f3001', 'club_admin');
insert into events (slug, name, club_id, status, is_team_event, team_size_min, team_size_max,
                    capabilities, created_by)
values ('rls24-event', 'RLS 00024 Event', (select id from clubs where slug='rls24-club'), 'active',
        true, 2, 3, '{"solo":true,"teams":true}', '00000000-0000-0000-0000-0000000f3001');

create or replace function pg_temp.become(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_ev uuid := (select id from events where slug='rls24-event');
  v_teamb uuid; v_alpha uuid;
  v_r team_join_requests; v_pre team_join_requests;
  v_n int;
begin
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3002', 'authenticated');
  perform register_for_event(v_ev, 'BLead', '{}', 'team');
  select (create_team(v_ev, 'TeamB')).id into v_teamb;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3003', 'authenticated');
  perform register_for_event(v_ev, 'ALead', '{}', 'team');
  select (create_team(v_ev, 'Alpha')).id into v_alpha;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3004', 'authenticated');
  perform register_for_event(v_ev, 'P4', '{}', 'team');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3005', 'authenticated');
  perform register_for_event(v_ev, 'P5', '{}', 'team');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3006', 'authenticated');
  perform register_for_event(v_ev, 'P6', '{}', 'team');

  -- 1
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3004', 'authenticated');
  select count(*) into v_n from list_joinable_teams(v_ev);
  if v_n <> 2 then raise exception 'FAIL case 1: expected 2 joinable teams, got %', v_n; end if;
  raise notice 'PASS case 1';

  -- pending request to TeamB before it is emptied
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3006', 'authenticated');
  select * into v_pre from request_team_join(v_teamb);

  -- 2: empty TeamB through the 00021 path, as the club admin
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3001', 'authenticated');
  perform remove_event_participant((select id from participants where event_id=v_ev and display_name='BLead'));
  perform set_config('role', 'postgres', true);
  if not exists (select 1 from teams where id = v_teamb) then raise exception 'FAIL case 2: team row deleted'; end if;
  if exists (select 1 from participants where team_id = v_teamb) then raise exception 'FAIL case 2: team not empty'; end if;
  raise notice 'PASS case 2';

  -- 3
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3004', 'authenticated');
  if exists (select 1 from list_joinable_teams(v_ev) where id = v_teamb) then raise exception 'FAIL case 3: empty team listed'; end if;
  if not exists (select 1 from list_joinable_teams(v_ev) where id = v_alpha) then raise exception 'FAIL case 3: Alpha not listed'; end if;
  raise notice 'PASS case 3';

  -- 4
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3001', 'authenticated');
  select count(*) into v_n from teams where event_id = v_ev;
  if v_n <> 2 then raise exception 'FAIL case 4: organizer sees % teams', v_n; end if;
  raise notice 'PASS case 4';

  -- 5
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3004', 'authenticated');
  begin
    perform request_team_join(v_teamb);
    raise exception 'FAIL case 5: request to empty team accepted';
  exception when others then
    if sqlerrm not like '%no members%' then raise; end if;
  end;
  raise notice 'PASS case 5';

  -- 6: old creator (removed) tries to accept the pre-existing request
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3002', 'authenticated');
  begin
    perform respond_team_join_request(v_pre.id, true);
    raise exception 'FAIL case 6: empty team revived';
  exception when others then
    if sqlerrm not like '%no members%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);
  if (select team_id from participants where display_name='P6' and event_id=v_ev) is not null then
    raise exception 'FAIL case 6: requester joined the empty team';
  end if;
  raise notice 'PASS case 6';

  -- 7
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3004', 'authenticated');
  select * into v_r from request_team_join(v_alpha);
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3003', 'authenticated');
  select * into v_r from respond_team_join_request(v_r.id, true);
  perform set_config('role', 'postgres', true);
  if v_r.status <> 'accepted' or (select team_id from participants where display_name='P4' and event_id=v_ev) <> v_alpha then
    raise exception 'FAIL case 7: valid acceptance failed';
  end if;
  raise notice 'PASS case 7';

  -- 8: fill Alpha (ALead + P4 + P5 = 3), then it must vanish from the picker
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3005', 'authenticated');
  select * into v_r from request_team_join(v_alpha);
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3003', 'authenticated');
  perform respond_team_join_request(v_r.id, true);
  perform pg_temp.become('00000000-0000-0000-0000-0000000f3006', 'authenticated');
  if exists (select 1 from list_joinable_teams(v_ev) where id = v_alpha) then raise exception 'FAIL case 8: full team listed'; end if;
  begin
    perform request_team_join(v_alpha);
    raise exception 'FAIL case 8: request to full team accepted';
  exception when others then
    if sqlerrm not like '%Team is full%' then raise; end if;
  end;
  raise notice 'PASS case 8';
end $$;

rollback;

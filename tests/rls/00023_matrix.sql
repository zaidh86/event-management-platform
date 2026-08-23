-- 00023 matrix — team join requests. Run in the Supabase SQL editor AFTER
-- applying 00023. Wrapped in a transaction and rolled back: no residue.
-- A clean run shows no error panel (NOTICE lines are not displayed by the
-- editor); any failure aborts with "FAIL case N".
--
-- Properties proved:
--   1 join_team is closed to clients
--   2 a request creates no membership and allocates no table
--   3 duplicate pending request is collapsed (one pending per team/participant)
--   4 requester / unrelated participant / other leader cannot decide
--   5 leader accepts → membership via participants.team_id; table shared
--   6 decline → no membership; requester can request again
--   7 acceptance re-checks capacity at accept time (full team refused)
--   8 Event Manager may decide

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f2001', 'rls23-admin@test.local'),
  ('00000000-0000-0000-0000-0000000f2002', 'rls23-lead@test.local'),
  ('00000000-0000-0000-0000-0000000f2003', 'rls23-a@test.local'),
  ('00000000-0000-0000-0000-0000000f2004', 'rls23-b@test.local'),
  ('00000000-0000-0000-0000-0000000f2005', 'rls23-c@test.local'),
  ('00000000-0000-0000-0000-0000000f2006', 'rls23-other@test.local')
  on conflict do nothing;

insert into clubs (slug, name, created_by)
values ('rls23-club', 'RLS 00023 Club',
        (select id from profiles where role in ('super_admin','platform_owner') limit 1));
insert into club_members (club_id, user_id, role)
values ((select id from clubs where slug='rls23-club'), '00000000-0000-0000-0000-0000000f2001', 'club_admin');
insert into events (slug, name, club_id, status, is_team_event, team_size_min, team_size_max,
                    capabilities, table_config, created_by)
values ('rls23-event', 'RLS 00023 Event', (select id from clubs where slug='rls23-club'), 'active',
        true, 2, 3, '{"solo":true,"teams":true,"qr":true}', '{"enabled":true}',
        '00000000-0000-0000-0000-0000000f2001');

create or replace function pg_temp.become(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_ev uuid := (select id from events where slug='rls23-event');
  v_team uuid; v_other uuid;
  v_ra team_join_requests; v_rb team_join_requests; v_rc team_join_requests; v_r team_join_requests;
  v_tables int; v_n int;
begin
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2002', 'authenticated');
  perform register_for_event(v_ev, 'Lead', '{}', 'team');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2003', 'authenticated');
  perform register_for_event(v_ev, 'A', '{}', 'team');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2004', 'authenticated');
  perform register_for_event(v_ev, 'B', '{}', 'team');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2005', 'authenticated');
  perform register_for_event(v_ev, 'C', '{}', 'team');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2006', 'authenticated');
  perform register_for_event(v_ev, 'Other', '{}', 'team');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2002', 'authenticated');
  select (create_team(v_ev, 'Alpha')).id into v_team;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2006', 'authenticated');
  select (create_team(v_ev, 'Beta')).id into v_other;
  perform set_config('role', 'postgres', true);
  select count(*) into v_tables from event_tables where event_id = v_ev;

  -- 1
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2003', 'authenticated');
  begin
    perform join_team(v_team);
    raise exception 'FAIL case 1: join_team still callable';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS case 1';

  -- 2
  select * into v_ra from request_team_join(v_team);
  perform set_config('role', 'postgres', true);
  if (select team_id from participants where id = v_ra.participant_id) is not null then
    raise exception 'FAIL case 2: request created membership';
  end if;
  if (select count(*) from event_tables where event_id = v_ev) <> v_tables then
    raise exception 'FAIL case 2: request allocated a table';
  end if;
  raise notice 'PASS case 2';

  -- 3
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2003', 'authenticated');
  select * into v_r from request_team_join(v_team);
  if v_r.id <> v_ra.id then raise exception 'FAIL case 3: duplicate pending request'; end if;
  raise notice 'PASS case 3';

  -- 4
  begin
    perform respond_team_join_request(v_ra.id, true);
    raise exception 'FAIL case 4: requester approved own request';
  exception when others then
    if sqlerrm not like '%Only the team leader%' then raise; end if;
  end;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2004', 'authenticated');
  begin
    perform respond_team_join_request(v_ra.id, true);
    raise exception 'FAIL case 4: unrelated participant approved';
  exception when others then
    if sqlerrm not like '%Only the team leader%' then raise; end if;
  end;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2006', 'authenticated');
  begin
    perform respond_team_join_request(v_ra.id, true);
    raise exception 'FAIL case 4: other leader approved';
  exception when others then
    if sqlerrm not like '%Only the team leader%' then raise; end if;
  end;
  raise notice 'PASS case 4';

  -- 5
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2002', 'authenticated');
  select * into v_r from respond_team_join_request(v_ra.id, true);
  perform set_config('role', 'postgres', true);
  if v_r.status <> 'accepted' or (select team_id from participants where id = v_ra.participant_id) <> v_team then
    raise exception 'FAIL case 5: acceptance did not create membership';
  end if;
  if (select count(*) from event_tables where event_id = v_ev) <> v_tables then
    raise exception 'FAIL case 5: acceptance allocated a new table';
  end if;
  raise notice 'PASS case 5';

  -- 6
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2004', 'authenticated');
  select * into v_rb from request_team_join(v_team);
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2002', 'authenticated');
  select * into v_r from respond_team_join_request(v_rb.id, false);
  perform set_config('role', 'postgres', true);
  if v_r.status <> 'declined' or (select team_id from participants where id = v_rb.participant_id) is not null then
    raise exception 'FAIL case 6: decline created membership';
  end if;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2004', 'authenticated');
  select * into v_r from request_team_join(v_team);
  if v_r.id = v_rb.id or v_r.status <> 'pending' then raise exception 'FAIL case 6: cannot re-request'; end if;
  v_rb := v_r;
  raise notice 'PASS case 6';

  -- 7: Lead + A + B fills a team of 3; C's pending request must be refused
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2005', 'authenticated');
  select * into v_rc from request_team_join(v_team);
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2002', 'authenticated');
  perform respond_team_join_request(v_rb.id, true);
  begin
    perform respond_team_join_request(v_rc.id, true);
    raise exception 'FAIL case 7: accepted into a full team';
  exception when others then
    if sqlerrm not like '%Team is full%' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from participants where team_id = v_team;
  if v_n <> 3 then raise exception 'FAIL case 7: team has % members', v_n; end if;
  raise notice 'PASS case 7';

  -- 8: Event Manager may decide (C's request to Beta)
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2005', 'authenticated');
  perform withdraw_team_join_request(v_rc.id);
  select * into v_rc from request_team_join(v_other);
  perform pg_temp.become('00000000-0000-0000-0000-0000000f2001', 'authenticated');
  select * into v_r from respond_team_join_request(v_rc.id, true);
  if v_r.status <> 'accepted' then raise exception 'FAIL case 8: manager could not accept'; end if;
  raise notice 'PASS case 8';
end $$;

rollback;

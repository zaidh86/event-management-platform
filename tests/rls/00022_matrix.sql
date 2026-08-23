-- 00022 matrix — generic feedback, table allocation, AI judging visibility.
-- Run in the Supabase SQL editor AFTER applying 00021 and 00022. Wraps
-- everything in a transaction and rolls back: no residue.
-- Expected output: NOTICE lines "PASS case 1" ... "PASS case 12".
--
-- Properties proved here (none visible from the UI):
--   * feedback is GENERIC: same respondent may answer repeatedly; target
--     arguments are ignored; categories still stamped server-side (1-4)
--   * table allocation: solo + team units numbered in registration order,
--     team members share, no row for team members, RLS scoping, backfill (5-10)
--   * AI rows are readable by judges, never by participants, and never count
--     toward results (11-12)

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f1001', 'rls22-admin@test.local'),
  ('00000000-0000-0000-0000-0000000f1002', 'rls22-faculty@test.local'),
  ('00000000-0000-0000-0000-0000000f1003', 'rls22-solo@test.local'),
  ('00000000-0000-0000-0000-0000000f1004', 'rls22-lead@test.local'),
  ('00000000-0000-0000-0000-0000000f1005', 'rls22-mate@test.local'),
  ('00000000-0000-0000-0000-0000000f1006', 'rls22-judge@test.local')
  on conflict do nothing;

insert into clubs (slug, name, created_by)
values ('rls22-club', 'RLS 00022 Club',
        (select id from profiles where role in ('super_admin','platform_owner') limit 1));

insert into club_members (club_id, user_id, role) values
  ((select id from clubs where slug='rls22-club'), '00000000-0000-0000-0000-0000000f1001', 'club_admin'),
  ((select id from clubs where slug='rls22-club'), '00000000-0000-0000-0000-0000000f1002', 'faculty');

insert into events (slug, name, club_id, status, is_team_event, team_size_min, team_size_max,
                    capabilities, table_config, submission_config, created_by)
values ('rls22-event', 'RLS 00022 Event', (select id from clubs where slug='rls22-club'), 'active',
        true, 2, 3,
        '{"solo":true,"teams":true,"feedback":true,"submissions":true,"judging":true,"qr":true}',
        '{"enabled":true,"start_number":1,"label":"Table"}',
        '{"ai_assist":true}',
        '00000000-0000-0000-0000-0000000f1001');

insert into event_members (event_id, user_id, role) values
  ((select id from events where slug='rls22-event'), '00000000-0000-0000-0000-0000000f1006', 'judge');

insert into feedback_forms (event_id, title, status, access, questions, created_by)
values ((select id from events where slug='rls22-event'), 'RLS22 form', 'published', 'public',
        '[{"key":"q1","label":"Which team?","type":"short_text","required":true}]',
        '00000000-0000-0000-0000-0000000f1001');

create or replace function pg_temp.become(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claim.role', p_role, true);
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_ev uuid := (select id from events where slug='rls22-event');
  v_form uuid := (select id from feedback_forms where title='RLS22 form');
  v_team uuid;
  v_r jsonb;
  v_n int;
  v_cats jsonb;
  v_sub uuid;
  v_crit uuid;
begin
  -- 1. generic feedback: same signed-in user answers twice
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1003', 'authenticated');
  v_r := submit_feedback(v_form, '{"q1":"Alpha"}');
  if v_r ->> 'status' <> 'ok' then raise exception 'case 1a: %', v_r; end if;
  v_r := submit_feedback(v_form, '{"q1":"Beta"}');
  if v_r ->> 'status' <> 'ok' then raise exception 'case 1b: %', v_r; end if;
  raise notice 'PASS case 1';

  -- 2. legacy target args accepted and ignored
  v_r := submit_feedback(v_form, '{"q1":"Gamma"}', 'team', gen_random_uuid());
  if v_r ->> 'status' <> 'ok' then raise exception 'case 2: %', v_r; end if;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from feedback_responses where form_id = v_form and (target_type <> 'event' or target_id is not null)) then
    raise exception 'case 2: target stored';
  end if;
  raise notice 'PASS case 2';

  -- 3. categories stamped: faculty → faculty, anon → anonymous
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1002', 'authenticated');
  perform submit_feedback(v_form, '{"q1":"x"}');
  perform pg_temp.become(null, 'anon');
  perform submit_feedback(v_form, '{"q1":"x"}');
  perform set_config('role', 'postgres', true);
  select jsonb_object_agg(coalesce(respondent_category,'null'), n) into v_cats
  from (select respondent_category, count(*) n from feedback_responses where form_id = v_form group by 1) s;
  if (v_cats ->> 'faculty')::int <> 1 or (v_cats ->> 'regular')::int <> 3 or (v_cats ->> 'anonymous')::int <> 1 then
    raise exception 'case 3: %', v_cats;
  end if;
  raise notice 'PASS case 3';

  -- 4. required question still enforced
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1003', 'authenticated');
  begin
    perform submit_feedback(v_form, '{}');
    raise exception 'case 4: accepted empty';
  exception when others then
    if sqlerrm not like '%required%' then raise; end if;
  end;
  raise notice 'PASS case 4';

  -- 5-7. table allocation in registration order
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1003', 'authenticated');
  perform register_for_event(v_ev, 'Solo', '{}', 'solo');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1004', 'authenticated');
  perform register_for_event(v_ev, 'Lead', '{}', 'team');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1005', 'authenticated');
  perform register_for_event(v_ev, 'Mate', '{}', 'team');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1004', 'authenticated');
  select (create_team(v_ev, 'Alpha')).id into v_team;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1005', 'authenticated');
  perform join_team(v_team);
  perform set_config('role', 'postgres', true);
  if (select table_number from event_tables where participant_id = (select id from participants where event_id=v_ev and display_name='Solo')) <> 1 then
    raise exception 'case 5: solo not table 1';
  end if;
  raise notice 'PASS case 5';
  if (select table_number from event_tables where team_id = v_team) <> 2 then
    raise exception 'case 6: team not table 2';
  end if;
  raise notice 'PASS case 6';
  if exists (select 1 from event_tables where participant_id in (select id from participants where team_id = v_team)) then
    raise exception 'case 7: team member has own row';
  end if;
  raise notice 'PASS case 7';

  -- 8. team member reads the team table; faculty (non-member) reads nothing
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1005', 'authenticated');
  select count(*) into v_n from event_tables where team_id = v_team;
  if v_n <> 1 then raise exception 'case 8: mate sees % rows', v_n; end if;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1002', 'authenticated');
  select count(*) into v_n from event_tables where event_id = v_ev;
  if v_n <> 0 then raise exception 'case 8: faculty sees % rows', v_n; end if;
  raise notice 'PASS case 8';

  -- 9. non-manager cannot backfill; manager can (idempotent → 0)
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1003', 'authenticated');
  begin
    perform assign_event_tables(v_ev);
    raise exception 'case 9: participant assigned tables';
  exception when others then
    if sqlerrm not like '%Only Event Managers%' then raise; end if;
  end;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1001', 'authenticated');
  if assign_event_tables(v_ev) <> 0 then raise exception 'case 9: backfill not idempotent'; end if;
  raise notice 'PASS case 9';

  -- 10. removing the solo participant frees their table row
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1001', 'authenticated');
  v_r := remove_event_participant((select id from participants where event_id=v_ev and display_name='Solo'));
  if v_r ->> 'status' <> 'ok' then raise exception 'case 10: %', v_r; end if;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from event_tables where event_id = v_ev and table_number = 1) then
    raise exception 'case 10: table row survived removal';
  end if;
  raise notice 'PASS case 10';

  -- 11. AI row: judge reads it, team member does not
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1004', 'authenticated');
  perform save_submission(v_ev, 'Proj', 'desc', '{}', true, null, null);
  perform set_config('role', 'postgres', true);
  select id into v_sub from submissions where event_id = v_ev;
  insert into judging_criteria (event_id, name, description, ai_instructions, max_score, weight)
  values (v_ev, 'Tech', 'guidance', 'look for code', 10, 2) returning id into v_crit;
  insert into judge_evaluations (event_id, submission_id, judge_id, source, scores, details, status)
  values (v_ev, v_sub, null, 'ai', jsonb_build_object(v_crit::text, 9), '{"summary":"s"}', 'draft');
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1006', 'authenticated');
  select count(*) into v_n from judge_evaluations where submission_id = v_sub and source = 'ai';
  if v_n <> 1 then raise exception 'case 11: judge cannot see AI row'; end if;
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1004', 'authenticated');
  select count(*) into v_n from judge_evaluations where submission_id = v_sub;
  if v_n <> 0 then raise exception 'case 11: participant sees AI row'; end if;
  raise notice 'PASS case 11';

  -- 12. results: finalized human 6 × weight 2 = 12; AI 9 ignored
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1006', 'authenticated');
  perform save_evaluation(v_sub, jsonb_build_object(v_crit::text, 6), '', true);
  perform pg_temp.become('00000000-0000-0000-0000-0000000f1001', 'authenticated');
  if (select weighted_total from get_judging_results(v_ev)) <> 12 then
    raise exception 'case 12: weighted total %', (select weighted_total from get_judging_results(v_ev));
  end if;
  raise notice 'PASS case 12';
end $$;

rollback;

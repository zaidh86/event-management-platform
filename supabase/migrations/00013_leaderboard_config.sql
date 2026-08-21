-- 00013: universal configurable leaderboard (ADR-0008).
--
-- The leaderboard stops assuming a team/gamified event. The Event Manager
-- configures it through events.leaderboard_config (jsonb):
--   enabled        boolean — absent = legacy default (points capability on)
--   entity         'auto' | 'individuals' | 'teams' | 'combined'
--                  'auto' derives from the event's participation availability:
--                  solo-only -> individuals, team-only -> teams, both -> combined
--   metric         'balance' | 'tasks' — both computed from the EXISTING ledger
--                  (no second scoring system): balance is accounts.balance;
--                  tasks is the count of distinct tasks with a positive
--                  transaction on the account
--   visibility     'public' | 'participants' | 'hidden' — absent = legacy
--                  mapping from events.public_leaderboard
--   show_member_count boolean (display option)
-- Ranking rows remain privacy-safe by construction: name, balance, member
-- count, tasks — never emails/phones/registration data.
--
-- events.public_leaderboard is RETAINED: it stays the anon-visibility switch for
-- events_select_public (00001) and the app keeps it in sync with
-- visibility = 'public'. Legacy rows with leaderboard_config = '{}' behave
-- exactly as before this migration.
--
-- NOTE on numbering: the deferred events.club_id NOT NULL wave renumbers again,
-- from 00013 to 00014 (still requires its own approval).
--
-- Additive; 00001-00012 untouched. Rollback notes at the end.

-- ── 1. Configuration column. '{}' = all legacy defaults.
alter table public.events
  add column leaderboard_config jsonb not null default '{}'::jsonb;

-- ── 2. get_leaderboard: entity filtering, visibility from config, tasks metric.
--       The OUT signature gains tasks_completed, and CREATE OR REPLACE cannot
--       change a return type, so the function is dropped and recreated; its
--       00001 grants (anon, authenticated) are re-issued below.
drop function public.get_leaderboard(uuid);

create function public.get_leaderboard(p_event_id uuid)
returns table (
  rank bigint,
  account_id uuid,
  owner_type text,
  owner_id uuid,
  name text,
  balance numeric,
  member_count bigint,
  tasks_completed bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ev events%rowtype;
  v_entity text;
  v_metric text;
  v_visibility text;
  v_solo boolean;
  v_team boolean;
  v_is_staff boolean;
begin
  select * into v_ev from events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;

  -- visibility: config wins; absent = legacy public_leaderboard mapping
  v_visibility := coalesce(v_ev.leaderboard_config ->> 'visibility',
                           case when v_ev.public_leaderboard then 'public' else 'participants' end);
  if v_visibility not in ('public', 'participants', 'hidden') then
    v_visibility := 'participants';
  end if;

  v_is_staff := coalesce(auth.role(), '') = 'service_role'
    or has_event_role(p_event_id, array['organizer', 'activity_admin', 'volunteer']);

  if v_visibility = 'hidden' and not v_is_staff then
    raise exception 'The leaderboard is not available for this event';
  end if;
  if v_visibility = 'participants'
     and coalesce(auth.role(), '') <> 'service_role' -- game-api Edge Function
     and not is_event_member(p_event_id)
     and not is_super_admin() then
    raise exception 'Leaderboard is not public for this event';
  end if;

  -- ranked entity: config wins; 'auto' derives from participation availability
  -- (same derivation rules as register_for_event, 00012)
  v_entity := coalesce(v_ev.leaderboard_config ->> 'entity', 'auto');
  if v_entity not in ('individuals', 'teams', 'combined') then
    v_team := v_ev.is_team_event and coalesce((v_ev.capabilities ->> 'teams')::boolean, true);
    v_solo := case when v_ev.capabilities ? 'solo'
                   then coalesce((v_ev.capabilities ->> 'solo')::boolean, false)
                   else not v_ev.is_team_event end;
    if not coalesce(v_solo, false) and not coalesce(v_team, false) then
      v_solo := not v_ev.is_team_event;
      v_team := v_ev.is_team_event;
    end if;
    v_entity := case when v_solo and v_team then 'combined'
                     when v_team then 'teams'
                     else 'individuals' end;
  end if;

  v_metric := coalesce(v_ev.leaderboard_config ->> 'metric', 'balance');
  if v_metric not in ('balance', 'tasks') then
    v_metric := 'balance';
  end if;

  return query
  select
    row_number() over (
      order by (case when v_metric = 'tasks' then tc.cnt::numeric else a.balance end) desc,
               coalesce(t.name, p.display_name) asc
    ) as rank,
    a.id as account_id,
    a.owner_type,
    a.owner_id,
    coalesce(t.name, p.display_name) as name,
    a.balance,
    case when a.owner_type = 'team'
         then (select count(*) from participants m where m.team_id = t.id)
         else 1::bigint end as member_count,
    tc.cnt as tasks_completed
  from accounts a
  left join teams t on a.owner_type = 'team' and t.id = a.owner_id
  left join participants p on a.owner_type = 'participant' and p.id = a.owner_id
  left join lateral (
    -- "tasks completed": distinct tasks that earned this account a positive
    -- transaction — computed from the existing ledger, no separate scoring
    select count(distinct tx.activity_id) as cnt
    from transactions tx
    where tx.account_id = a.id and tx.activity_id is not null and tx.amount > 0
  ) tc on true
  where a.event_id = p_event_id
    and (v_entity = 'combined'
         or (v_entity = 'teams' and a.owner_type = 'team')
         or (v_entity = 'individuals' and a.owner_type = 'participant'))
  order by (case when v_metric = 'tasks' then tc.cnt::numeric else a.balance end) desc,
           coalesce(t.name, p.display_name) asc;
end $$;

-- DROP removed the 00001 grants; restore them (same posture as 00001:594).
grant execute on function public.get_leaderboard(uuid) to anon, authenticated;

-- Rollback:
--   drop function public.get_leaderboard(uuid);
--   -- recreate the 00001 version of get_leaderboard verbatim, then:
--   grant execute on function public.get_leaderboard(uuid) to anon, authenticated;
--   alter table public.events drop column leaderboard_config;

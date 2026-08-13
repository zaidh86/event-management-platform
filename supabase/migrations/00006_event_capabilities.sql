-- 00006: capability-based event configuration (ADR-0003).
-- Default = legacy game-set so every existing event behaves identically.

alter table public.events add column capabilities jsonb not null default '{
  "teams": true, "points": true, "qr": true,
  "attendance": false, "submissions": false, "judging": false,
  "deadlines": false, "feedback": false, "certificates": false,
  "games_api": true
}'::jsonb;

-- Align the teams flag with reality for existing rows (individual events != team events).
update public.events
set capabilities = jsonb_set(capabilities, '{teams}', to_jsonb(is_team_event));

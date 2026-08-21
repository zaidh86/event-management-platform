# ADR-0007: Participation modes and post-creation capability configuration

**Status:** Accepted · 2026-08-15 · Migration `00012_participation_modes.sql` (renumbers the
deferred `events.club_id NOT NULL` wave to **00013**)

## Context

Events were binary: `is_team_event` made an event solo-XOR-team, and a participant's "mode" was
inferred from the event format and `team_id`. The product model requires three event
configurations (solo-only, team-only, solo+team) and a participant-chosen, persisted mode that is
the source of truth for dashboards, accounts and QR routing. Capabilities were also not editable
after event creation.

## Decision

1. **Availability is event configuration; choice is participant state.**
   - Availability: capabilities jsonb — existing `teams` key + new `solo` key. Legacy fallback
     everywhere (SQL and the frontend normalizer): absent `solo` ⇒ `not is_team_event`, so
     pre-00012 rows keep their exact semantics (old team events = team-only, never solo+team).
   - Choice: new `participants.participation_mode text check in ('solo','team') not null`,
     backfilled `team` for participants of team events, `solo` otherwise.
   - `events.is_team_event` is retained as the team-mechanics switch (team sizes, create_team);
     the app keeps it in sync with `capabilities.teams`.
2. **`register_for_event` gains an explicit `p_participation_mode` parameter** and validates it
   against availability; auto-resolution happens only when exactly one mode is available (the
   result is still stored). The old 3-arg signature is dropped (an overload would be ambiguous to
   PostgREST named-argument calls); grants re-issued per the 00002 convention. Account creation now
   keys on the chosen mode: solo participants get personal accounts even in solo+team events.
3. **Mode is enforced in the database, not just the UI:** `create_team`/`join_team` reject
   participants whose stored mode is not `team`; `resolve_qr` routes by the participant's mode
   rather than the event format (a solo participant in a mixed event resolves to their personal
   account).
4. **Column-grant hardening:** the table-wide `UPDATE` privilege on `participants` for
   `authenticated` is replaced with `UPDATE (display_name, registration_data)`. `participation_mode`,
   `team_id` and `qr_token` are writable only through the SECURITY DEFINER RPCs — this also closes
   the pre-existing hole where a participant could set their own `team_id` directly, bypassing
   join_team's size checks. RLS (`participants_update_own`) continues to scope rows.
5. **Capabilities become editable after creation** (frontend `SettingsPage` panel writing the
   existing `events.capabilities` jsonb + `is_team_event` sync). Availability changes never mutate
   existing participants' stored modes; the UI warns that changes affect future registrations only.
   Dormant capabilities (attendance, submissions, judging, deadlines, feedback, certificates)
   remain flags awaiting their own milestones.

## Consequences

- Dashboards read `participant.participation_mode`, never `event.is_team_event` or `team_id`
  presence — the solo+team acceptance test (participant A solo, participant B team, different
  dashboards in one event) is the contract.
- Registration becomes a two-step flow (custom fields → EMP-controlled mode step).
- Leaderboards already aggregate `accounts` rows of both owner types per event, so mixed events
  rank solo participants and teams together with no change.
- Terminology: UI labels move to universal wording ("Scoring"/"unit name", "Tasks") while schema
  names (`currency_name`, `activities`) remain — the `organizer` → "Event Manager" precedent.

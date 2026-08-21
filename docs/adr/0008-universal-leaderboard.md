# ADR-0008: Universal configurable leaderboard

**Status:** Accepted · 2026-08-20 · Migration `00013_leaderboard_config.sql` (renumbers the
deferred `events.club_id NOT NULL` wave to **00014**)

## Context

The leaderboard was hardcoded around team/gamified events: membership derived solely from
`accounts` rows, the empty state said "No teams yet", and there was no way to configure what is
ranked, by what metric, or who may see it. A registered participant in a team-configured event was
invisible until a team existed (correct data-wise, but unconfigurable and mislabeled), and
post-ADR-0007 mixed events silently blended individual and team balances.

## Decision

1. **Configuration lives on the event** — `events.leaderboard_config jsonb` with keys `enabled`,
   `entity` (`auto`/`individuals`/`teams`/`combined`), `metric` (`balance`/`tasks`), `visibility`
   (`public`/`participants`/`hidden`), `show_member_count`. `'{}'` reproduces legacy behavior
   exactly: enabled follows the points capability, entity derives from participation availability,
   visibility maps from `public_leaderboard`.
2. **One scoring source.** Both metrics are computed from the existing ledger — `balance` is
   `accounts.balance`; `tasks` counts distinct tasks with a positive transaction per account. No
   second scoring system exists.
3. **Combined ranking is explicit, not silent.** Individuals and teams share the same ledger,
   starting balance and transaction rules, so combined ranking compares the same metric per entry;
   a team still pools its members into one balance. The settings UI states this caveat and the
   Event Manager opts in; `auto` chooses combined only for solo+team events.
4. **Nonsensical configurations are prevented in the UI** (solo-only events rank individuals,
   team-only rank teams; only mixed events offer a choice) and degrade safely in SQL (`auto`
   fallback).
5. **Visibility is enforced in the RPC**, not the UI: `hidden` admits event staff/service only;
   `participants` keeps the existing member check; `public` admits anon. `public_leaderboard` stays
   as the anon events-row switch, synced by the UI to `visibility = 'public'`.
6. **Privacy by construction**: the RPC returns rank, display/team name, balance, member count and
   task count — never emails, phones or registration data.
7. **Labels come from event configuration**: the metric column is titled by the event's scoring
   unit (`currency_name_plural`) or "Tasks"; entity labels follow the configured entity. Empty
   states are entity-aware ("No participants/teams on the leaderboard yet").

## Consequences

- `get_leaderboard` was dropped/recreated (return type gained `tasks_completed`); its anon +
  authenticated grants are re-issued in 00013.
- Live updates keep riding the existing accounts realtime subscription.
- The "registered but invisible" report is resolved by ADR-0007 + this ADR together: solo
  registrants now hold accounts from registration, and team-only leaderboards say so honestly while
  teamless team-mode participants remain (correctly) unranked until they join one.

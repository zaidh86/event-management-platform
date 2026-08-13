# ADR-0004: Migration strategy from current EMP to the platform model

**Status:** Accepted · 2026-08-13

## Context

EMP is a working system (auth, events, transactions, realtime, game API). The platform expansion
must never break a running event or change legacy behavior. No migration files are created in
Phase 0 — this ADR fixes the rules and the sequence they will follow in Phase 1+.

## Decision — principles

1. **Additive only.** No renames, drops, or type changes to existing columns/tables. Deprecations
   are removed no earlier than one full release after their replacement ships.
2. **Defaults reproduce today.** New columns default to values that make legacy rows behave
   identically (`capabilities` → legacy game-set; `club_id` → General club).
3. **Backfill, then constrain.** Nullable first → backfill → verify → NOT NULL.
4. **Owner protection lives in the database** (trigger + partial unique index), not in client code.
5. **RLS staged:** new policies land alongside existing ones and are proven by the per-role test
   matrix before any existing policy is tightened (ADR-0005).
6. **UI behind data-presence flags:** club navigation and capability panels render only when their
   data exists; the current flat UI remains the fallback until Phase 2 completes.
7. **Every migration ships with a written rollback note** in the same PR.
8. **Gate rhythm at every wave:** `npm run build` + `npm run lint` + auth/realtime/transaction
   regression + role-matrix browser tests.

## Decision — migration waves (Phase 1 unless noted)

| Wave | Contents | Rollback posture |
|---|---|---|
| 1 | `clubs`, `club_members`, seed General club | Drop tables (no consumers yet) |
| 2 | `events.club_id` nullable + backfill to General + index | Drop column |
| 3 | `events.capabilities` jsonb, default legacy set | Drop column |
| 4 | Owner: partial unique index + protection trigger; assign owner via documented runbook (manual SQL by the human owner) | Drop trigger/index; role reverts to super_admin |
| 5 | RLS additions for clubs/club_members + club-scoped management policies | Drop new policies (old ones still intact) |
| 6 | `club_id` NOT NULL after verification window | Re-relax to nullable |
| 7+ (Phase 3) | Per-module tables (attendance, submissions, judging_scores, rubrics, feedback, certificates) — one wave per module, each with its own plan, RLS, and flag | Per-module drop |

## Consequences

- The app is shippable after every wave; day-one behavioral diff for existing users is zero.
- Frontend Phase 1 data-layer work (additive `api.ts` reads/writes, `isOwner` in AuthContext) can
  land between waves 4 and 5 without waiting for the full sequence.
- The `supabase/migrations/` directory remains untouched until the user approves Phase 1.

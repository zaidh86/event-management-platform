# ADR-0003: Capability-based event configuration

**Status:** Accepted · 2026-08-13

## Context

Today every event implicitly gets the full game-style feature set (points, teams, leaderboard, QR,
games API). The platform vision requires hackathons, workshops, quizzes, and literary competitions
that use different, smaller subsets — without N hardcoded event types.

## Decision

1. **Capabilities, not event types, are the configuration unit.** An "event type" is a UI preset
   that pre-fills a capability set at creation; after creation, capabilities are edited directly.

2. **Storage: `events.capabilities jsonb`** with a typed frontend contract:

   ```ts
   interface EventCapabilities {
     teams: boolean
     points: boolean          // implies leaderboard + realtime UI
     qr: boolean              // scan stations
     attendance: boolean      // check-in lists
     submissions: boolean
     judging: boolean         // requires submissions
     deadlines: boolean
     feedback: boolean
     certificates: boolean
     games_api: boolean       // existing game integration
   }
   ```

   Column default = the **legacy set** (`teams/points/qr/games_api` true per current behavior), so
   every existing event is bit-identical in behavior after migration (ADR-0004).

3. **Frontend capability registry:** one module maps each capability to its tabs, dashboard cards,
   settings panel, and routes. Every capability-owned UI seam checks the flag — no scattered
   ad-hoc conditionals.

4. **Presets (frontend-only):** Casino night, Hackathon, Literary competition, Workshop, Custom —
   as defined in `docs/PRODUCT.md`. Presets never exist in the database.

5. **DB posture:** capabilities are product configuration, not security. RLS never grants access
   based on a capability flag (ADR-0005); a disabled capability hides UI and skips queries, nothing
   more. Optional CHECK constraints (e.g. `judging ⇒ submissions`) may be added later; the frontend
   registry enforces dependencies in v1.

## Consequences

- jsonb keeps Phase 3 module additions migration-free (new key + default-false semantics: absent =
  false in the frontend contract).
- Tradeoff accepted: jsonb has no DB-level typing — mitigated by a single TS type + runtime
  normalizer at the api.ts boundary.
- Settings UI becomes "a panel per enabled capability" (Phase 2).
- The projector, leaderboard, and scan tabs become `points`/`qr`-gated instead of universal.

## Alternatives considered

- *Boolean columns per capability:* rejected — migration per module forever.
- *Join table `event_capabilities`:* rejected — relational ceremony with no querying need yet; can be
  extracted later if per-capability config objects outgrow jsonb.

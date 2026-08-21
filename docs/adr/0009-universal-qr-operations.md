# ADR-0009: Universal QR + Event Operations

**Status:** Accepted (Phase 3) · **Migration:** `00014_universal_qr_operations.sql`

## Context

EMP's initial QR implementation hardcoded exactly two QR meanings — participant
QR and team QR — both resolved by `resolve_qr` into a scoring context. Real
events need an arbitrary number of QR *operations*: attendance, verification,
scoring, event promotion/registration, feedback collection, and (later)
judging. Hardcoding each use case would multiply schemas and scanners.

## Decisions

### 1. QR configurations, not QR kinds

`qr_configs` — one row per configured QR operation per event: `label`,
`description`, `target` (`participant | team | event | feedback`), `actions[]`,
`scanner_access[]`, `is_enabled`, `config` (action extras), `sort_order`.
An event may have zero or many. Nothing anywhere assumes "at most two".

### 2. One physical token, many purposes

Participant (`p_…`) and team (`t_…`) tokens are **unchanged** and remain the
QR payloads for participant/team targets. A config defines *what may be done*
when that token is scanned — it does not re-issue tokens. This preserves the
existing QR generation, the visible/copyable token UX, `resolve_qr`, and the
Games API byte-for-byte. Event/feedback targets get a config-owned `q_…` token
(the poster/venue QR).

### 3. Actions are target-scoped and validated in the schema

- participant → `attendance`, `scoring`, `verification`
- team → `scoring`, `verification` (a future `judging` extends this list —
  new migration, same architecture)
- event → `registration`, `info`
- feedback → `feedback`

A CHECK constraint rejects nonsense (`event` + `attendance` etc.).

### 4. Server-side enforcement: `perform_scan`

The single station entry point (SECURITY DEFINER). Verifies, in order: config
exists + enabled → event active → action ∈ config.actions → scanner authorized
(config `scanner_access` mapped onto real event roles via `has_event_role` /
`is_event_member`; platform admins and `service_role` pass; **never**
client-claimed) → token resolves → token belongs to the config's event →
action-specific rules. The frontend is untrusted throughout.

### 5. Duplicate rules are per-action, not global

- **attendance** — once per participant per event, enforced by a UNIQUE
  constraint (race-proof); duplicates return `status:'duplicate'` with the
  original timestamp, and the attempt is still logged.
- **verification / scoring** — repeatable; every scan is a ledger row. Scoring
  amounts still flow only through `process_transaction` (00001) with its own
  authorization; `perform_scan` merely resolves the scoring context.
- **feedback** — per-form `one_response_per_user`, enforced by a
  `(form_id, dedupe_key)` UNIQUE where `dedupe_key = auth.uid()` when the rule
  applies. Anonymous public responses cannot be attributed to a person and are
  accepted as-is — an accepted limitation, stated here deliberately.

### 6. Scan ledger

`scans` records event, config, target, target id, action, scanner, result
(`ok | duplicate | rejected`) and metadata. Written **only** by SECURITY
DEFINER functions (no client write grants/policies). Staff-readable per event.
Attendance rows additionally land in `attendance` (event, participant, scan,
recorder, timestamp) for Phase 4/5 analytics.

### 7. Public resolution: `resolve_public_qr`

Anon-callable, but only resolves `event`/`feedback` `q_…` tokens of enabled
configs on active/ended events, returning the minimum promotional surface
(name, slug, description, branding, status, configured actions). Creating and
enabling an event QR **is** the Event Manager's publication decision — that is
why this bypasses `public_leaderboard`. Participant/team tokens are never
resolvable anonymously. Participants-only feedback forms return a
`requires_signin` marker instead of the form.

### 8. Feedback is EMP-native and minimal

`feedback_forms` (title, description, `questions` jsonb, status
draft/published/closed, access public/participants, `one_response_per_user`) +
`feedback_responses`. Question types: `short_text`, `long_text`, `rating`,
`single_choice`, `multi_choice`, each with `required`. `submit_feedback`
(SECURITY DEFINER, anon+authenticated) validates publish state, access,
required answers, strips unknown keys, and applies the dedupe rule. Responses
are readable by Event Managers and their own respondent only.

### 9. "Event Manager" predicate

`can_manage_event(event_id)` = organizer `has_event_role` OR
`is_club_admin(event.club_id)` — the exact `events_update` (00011) surface,
now reusable in policies. Used by qr_configs/feedback write policies and
attendance/response deletes.

### 10. Legacy fallback, no backfill

Events with **zero** enabled QR configs behave exactly as before: "My QR
codes" renders the legacy participant/team cards and the scan station runs the
legacy `resolve_qr` scoring flow. No data backfill; the live database needs no
seeding when 00014 is applied.

### 11. Capability integration

The dormant `attendance` and `feedback` capability flags become editable in
Event Settings and gate the *UI surfaces* (attendance status, feedback tab,
action choices offered in the QR builder). Server functions gate on config and
form state — disabling a capability hides surfaces without bricking data.

### 12. Projector mode consumes the existing leaderboard

`/e/:slug/projector` renders `get_leaderboard` (00013) — same visibility,
entity, metric rules; fixed top-10; live via the same accounts realtime
channel; public-safe fields only (names, scores, member counts). No second
leaderboard system.

## Numbering

The deferred `events.club_id` NOT NULL wave renumbers from 00014 to **00015**.

# ADR-0001: Clubs domain model

**Status:** Accepted · 2026-08-13 · Amended 2026-08-14 (club deletion, migration 00010)
**Deciders:** Platform owner (user) + roadmap approval

> **Amendment (00010):** the "no club deletion in v1" decision below is superseded. Club deletion is
> now supported as a **platform-level** action: `00010_club_deletion.sql` adds the DELETE grant for
> `authenticated` plus policy `clubs_delete ... using (is_super_admin())`, so platform owner and
> super admins may delete a club; **club admins may not delete a club, including their own**, and
> neither may members or anon. The cascade caution that motivated the original decision is preserved
> rather than solved: `events.club_id` keeps its NO ACTION behavior, so deleting a club that still
> owns events fails with SQLSTATE 23503 and rolls back — **no event data is ever cascade-deleted**.
> Only an empty club can be deleted, and only its `club_members` rows follow it. No slug is exempt.

> **Amendment 2 (2026-08-14, proposed 00011): the General fallback club is retired.** The decision
> below that "clubs are mandatory … a system-created *General* club absorbs all pre-existing and
> club-less events" is superseded: **every event now belongs to a real club, and there is no
> fallback**. `default_event_club()` and the `club_id is null` / General arms of `events_insert`
> (00005) are removed, and the General row is deleted once it owns nothing. This closes a silent
> failure mode rather than opening one: `default_event_club()` resolves the club by slug with a
> non-STRICT `SELECT INTO`, so deleting the row *without* removing the machinery would stamp
> `club_id = NULL` on every later event with no error. Consequence to note: event creation now
> requires club-admin standing in a real club, so club admins must be appointed by a platform
> administrator — there is no self-serve path.

## Context

EMP grows from a flat event list into EMP → Clubs → Club Events. Events need an owning organization;
clubs need admins and analytics. The current schema has no organization layer.

## Decision

1. **Clubs are mandatory.** Every event belongs to exactly one club. A system-created **"General"
   club** absorbs all pre-existing and club-less events, so there is exactly one code path.

2. **New tables (design sketch — actual migrations are written in Phase 1, not now):**

   ```
   clubs
     id uuid pk, slug text unique, name text, description text default '',
     logo_url text null, banner_url text null,
     created_by uuid references profiles, created_at, updated_at

   club_members
     id uuid pk, club_id uuid references clubs, user_id uuid references profiles,
     role text check (role in ('club_admin','member')), created_at,
     unique (club_id, user_id)
   ```

3. **`events.club_id uuid references clubs`** — added nullable, backfilled to the General club,
   then constrained NOT NULL (see ADR-0004 for staging).

4. Club-level theming/branding mirrors event branding fields (logo, banner) but is **not** applied to
   platform chrome (ADR-0006 containment rule applies).

## Consequences

- Home/navigation becomes role-aware and club-scoped (Phase 2 UI work).
- Club analytics aggregate over `events.club_id` (Phase 3).
- `slug` enables future public club pages — deferred, not designed here.
- Deleting a club is intentionally unsupported in v1 (archive semantics only), avoiding cascade
  design for event history. Revisit post-Phase 3.

## Alternatives considered

- *Optional clubs* (events may be club-less): rejected — permanent double code path in queries, RLS,
  and UI.
- *Clubs as a "tag" on events without membership:* rejected — club admins need real, RLS-enforceable
  authority.

# ADR-0001: Clubs domain model

**Status:** Accepted · 2026-08-13
**Deciders:** Platform owner (user) + roadmap approval

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

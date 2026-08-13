# ADR-0002: Role hierarchy, Platform Owner protection, permission matrix

**Status:** Accepted · 2026-08-13 · Amended 2026-08-13 (owner-grant context fix, migration 00008)

> **Amendment (00008):** as shipped in 00007, `protect_profile_role()` could never actually
> perform the documented SQL-editor bootstrap: its final guard (inherited from 00001) rejected any
> role change when `is_super_admin()` was false — and `is_super_admin()` is always false when
> `auth.uid()` is null, which is precisely the SQL-editor context. 00007 also referenced `NEW` on
> code paths reachable during DELETE, where `NEW` does not exist. `00008_fix_owner_grant_context.sql`
> replaces the function body only. The **administrative SQL context** is now defined as:
> `auth.uid() is null AND auth.role() not in ('service_role','anon')` — so the SQL editor/psql/
> migrations can grant the initial owner (and change other global roles, a deliberate consequence),
> while app clients and service-role requests can never grant ownership. Owner demotion/deletion
> remains blocked in **every** context including the SQL editor; deliberate ownership transfer
> requires the break-glass procedure in `docs/runbooks/assign-platform-owner.md`. The deferred
> `club_id NOT NULL` wave renumbers from 00008 to **00009**.

## Context

Current model: `profiles.role ∈ {user, super_admin}` (global) + `event_members.role ∈
{organizer, activity_admin, volunteer, participant}` (per event). The platform vision adds a
protected Platform Owner above super admins and a Club Admin layer between platform and events.

## Decision

### Hierarchy

```
Platform Owner  (exactly one; protected; can create/remove super admins)
  └─ Super Admin  (platform administration; can create other super admins; cannot touch the Owner)
      └─ Club Admin        (scope: one club, via club_members.role)
          └─ Event Manager (scope: one event — the EXISTING `organizer` role, never renamed)
              ├─ Activity Admin  (kept — zero migration cost, station-level admin)
              ├─ Volunteer
              └─ Participant
```

**Reuse over invention:** no existing enum value is renamed or removed. Changes are additive only:
`platform_owner` joins `GlobalRole`; `club_admin` lives on the new `club_members` table (ADR-0001).

### Platform Owner protection (DB-level, not UI-level)

- Exactly-one enforcement: partial unique index on `profiles.role` where `role = 'platform_owner'`.
- A `BEFORE UPDATE OR DELETE` trigger on `profiles` rejects any statement that would change the
  owner row's `role` or delete the row — **regardless of who issued it**, including super admins and
  service-role misuse from application bugs.
- Only the owner may grant or revoke `super_admin`? **No** — per the vision, super admins may create
  other super admins. The trigger therefore guards only the owner row; super-admin grants are policy-
  level (see ADR-0005).
- Bootstrap: the owner is assigned once by direct SQL in the Supabase dashboard by the human platform
  owner (documented runbook step in Phase 1), never by application code.

### Effective permission resolution (frontend + RLS share this logic)

`isOwner ⇒ isSuperAdmin ⇒ (club-scoped: isClubAdmin(club)) ⇒ (event-scoped: isEventManager(event)
⇒ isStaff(event))`. Higher scopes imply lower ones downward along their own branch only — a Club
Admin of the Literary Club has no authority in the CS Club.

### Permission matrix (authoritative)

| Action | Owner | Super Admin | Club Admin | Event Mgr | Activity Admin | Volunteer | Participant |
|---|---|---|---|---|---|---|---|
| Create/remove super admins | ● | ● create only | — | — | — | — | — |
| Remove/demote Owner | blocked by trigger for everyone | — | — | — | — | — | — |
| Manage any club/event | ● | ● | own club | assigned event | — | — | — |
| Create club events, assign managers | ● | ● | ● | — | — | — | — |
| Configure event, manage participants | ● | ● | — | ● | — | — | — |
| Projector mode (403 otherwise) | ● | ● | — | ● | — | — | — |
| Event ops: QR, check-in, stations | ● | ● | — | ● | ● | ● | — |
| Register / participate / own results | ● | ● | ● | ● | ● | ● | ● |

## Consequences

- `AuthContext` gains `isOwner`; existing `isSuperAdmin` behavior is unchanged (owner ⊇ super admin).
- Club Admins deliberately do **not** inherit event-manager rights on their club's events; they
  assign managers instead (separation of duties; revisit if it proves annoying in practice).
- Projector-mode guard (approved UI plan) needs no redesign — its allowed set is
  owner ∪ super_admin ∪ event organizer.

## Alternatives considered

- *Owner as env-pinned user id:* rejected — opaque, breaks on account rotation, invisible to RLS.
- *Renaming `organizer` → `event_manager`:* rejected — pure churn across code, RLS, and data for a
  cosmetic label; UI copy can say "Event Manager" while the enum stays `organizer`.

# ADR-0005: RLS and security design for the platform model

**Status:** Accepted (design) · 2026-08-13 · Policies are written and reviewed in Phase 1, not now.
· Amended 2026-08-14 (table grants, migration 00009)

> **Amendment (00009):** the Phase 1 RLS matrix caught that 00004 created `clubs`/`club_members`
> with RLS policies but **no table grants**. This project's Supabase instance has no baseline
> default privileges on the public schema — 00003 established the convention of explicit,
> least-privilege, per-table grants mirroring the RLS policy surface, and every new table must ship
> grants alongside its policies or PostgREST denies access at the grant gate before RLS runs
> (SQLSTATE 42501). `00009_phase1_table_grants.sql` corrects the two tables (authenticated:
> policy-mirroring grants, no clubs DELETE; anon: none; service_role: full CRUD). **Standing rule
> for all Phase 3 module tables: grants + policies land together in the same migration.**

## Context

Security in EMP is enforced by Supabase RLS; the client is untrusted. The platform model adds two
authority scopes (platform owner, club) and future module tables. Existing event-scoped policies
must keep working unchanged while new ones land.

## Threat model (what RLS must hold against)

- **Cross-club isolation:** a Club Admin or Event Manager of club X must not read/manage club Y's
  members, events, or analytics.
- **Privilege escalation:** a club_admin must not grant themselves platform roles; nobody edits
  `profiles.role` except super admins/owner (and never the owner row — trigger, ADR-0002).
- **Participant privacy:** registration data readable only by the participant and their event's
  staff; never club-wide or platform-public.
- **Capability flags are not security** (ADR-0003): disabling a capability hides UI; RLS alone
  decides data access.
- **Client-guard honesty:** UI 403 screens (e.g. projector) are UX; RLS is the enforcement layer.

## Decision — policy design (sketches; exact SQL in Phase 1 with security review)

- `clubs`: SELECT for all authenticated users (clubs directory). INSERT/UPDATE: super admins/owner;
  UPDATE also club_admins of that club. No DELETE in v1 (archive semantics, ADR-0001).
- `club_members`: SELECT: members of that club + super admins/owner. INSERT/UPDATE/DELETE:
  club_admins of that club + super admins/owner. A club_admin cannot modify their own row's role to
  escape auditability? — allowed in v1, revisit; the real guard is that club roles grant no platform
  authority.
- `events`: existing policies untouched. Additional management predicate extended from
  "organizer of event ∨ super_admin" to "… ∨ platform_owner"; club-scoped creation policy: INSERT
  allowed to club_admins of `club_id` (+ super admins/owner).
- `profiles.role`: UPDATE restricted to super admins/owner; owner row immutable via trigger.
- Module tables (Phase 3): each module's plan includes its policies; default posture = event-staff
  write, participant reads own rows, public reads nothing.
- Helper predicates (`is_super_admin()`, `is_platform_admin()`, `is_club_admin(club_id)`) as
  `security definer` SQL functions to keep policies readable and consistent — mirroring however the
  existing migration implements role checks (to be confirmed against `00001_init.sql` in Phase 1
  before writing any SQL).

## Verification strategy

1. **Per-role SQL test matrix:** for each (role × table × operation) cell of the ADR-0002 matrix, a
   test asserting allow/deny — run against a local/staging Supabase before tightening anything.
2. **Browser role suite** (webapp-testing): role-specific scenarios incl. direct-URL 403 checks.
3. **security-review skill** pass over the full policy diff before wave 5 merges.
4. Realtime note: subscription filters are convenience, not security — Realtime respects RLS; tests
   must confirm club-scoped rows never reach unauthorized subscribers.

## Consequences

- Existing event flows keep their current policies until the matrix proves the new ones.
- The permission matrix in ADR-0002 is the single source of truth; any policy PR cites the cells it
  implements.

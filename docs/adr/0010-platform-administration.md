# ADR-0010: Platform Administration & Event Lifecycle Polish

**Status:** Accepted (Phase 4) · **Migration:** `00015_platform_administration.sql`

## Context

Through Phase 3, EMP had a complete club-first event operations stack but no
platform-management surface: no settings entry, no super-admin management UI,
featuring/curation did not exist, and ownership handover relied on a
break-glass SQL-editor runbook. The Home page still mixed personal event lists
into the platform level.

## Decisions

### 1. Settings split: Personal vs Platform

`/settings` (every signed-in user): account info (display name via the
existing `profiles_update_own` RLS; email read-only), appearance (the existing
ThemeContext preference). No new account-management machinery — password/email
change flows are not part of the existing architecture and are not invented
here.

`/admin` (platform admins only): administrators, ownership, featured events.
Platform controls never appear in club/event settings; the two areas are
visually and navigationally distinct.

### 2. Super-admin management uses the existing model — nothing new

The roles remain exactly `user | super_admin | platform_owner` on
`profiles.role`. Grant/revoke is a plain `UPDATE profiles SET role`, authorized
by the **existing** `profiles_update_admin` policy + `protect_profile_role`
trigger (super admins change roles; nobody touches the owner row; ownership is
never grantable via the app). The UI restricts grant/revoke controls to the
Platform Owner; the database's documented authority (any super admin) is
unchanged. No client-provided role value is ever trusted — the trigger is the
enforcement.

### 3. First-signup bootstrap: documented, not rewritten

`handle_new_user` (00007) still promotes the first signup to super_admin when
no admin/owner exists. This is the intentional development bootstrap.
**Production deployment item (unchanged, tracked):** before opening public
signups on a fresh production database, create the owner via the runbook first
(making the bootstrap arm unreachable) or ship a separate controlled change
disabling it. Phase 4 deliberately does not alter it.

### 4. Ownership transfer replaces the break-glass concept

`transfer_platform_ownership(new_owner_id)` — SECURITY DEFINER, caller must
**be** the platform owner. Demote-then-promote inside one transaction
satisfies the single-owner partial unique index at every step; row locks
serialize concurrent attempts; any failure rolls the whole transfer back
(never ownerless, never dual-owned). The owner-protection trigger stays armed:
it gains a transaction-local gate (`set_config(..., is_local => true)`) that
only the transfer function can open — PostgREST cannot reach
`pg_catalog.set_config`, so no API client can forge it. No triggers are
disabled, no raw SQL is exposed, and the admin-SQL-context runbook path for
*initial* owner creation still works.

UI: owner-only "Ownership" section → pick an administrator (super admins
listed first as the eligible pool) → type the target's email to confirm →
ConfirmDialog → transfer → the caller's session continues as Super Admin.

### 5. Featured events: explicit curation, one boolean

`events.is_featured` (default false) + partial index. No popularity algorithm
— featuring is a deliberate platform-admin act. Because `events_update` RLS
legitimately lets organizers/club admins update their events, the column is
guarded by the ENABLE ALWAYS trigger `protect_event_featured` (insert +
update): only `is_super_admin()` (owner inherits) or the admin SQL context may
change it — verified role-by-role in PGlite. The control lives in Platform
Settings only; Event Managers never see a disabled toggle.

### 6. Home page architecture

Welcome → **Featured events** (curated cards, EmptyState when none) → Clubs
(my clubs / browse) → **About EMP** (small, subtle). The personal "Recent
events" list and any Ongoing/Previous split are platform-level no more —
event lifecycle lists live inside clubs.

### 7. Club event lifecycle listing

Club → Events groups by real status: **Ongoing** (`active`), **Previous**
(`ended`), and a manager-only **Drafts & archived** group (RLS already hides
drafts from non-members; the UI mirrors it). Each group has a clean
EmptyState. Event cards unchanged.

### 8. Lifecycle polish, not lifecycle replacement

Statuses stay `draft | active | ended | archived`. The event Overview gains a
manager-only lifecycle panel: what the current status means, plus the
transitions (draft→activate with **readiness checks**, active→end,
ended→archive/reopen, archived→restore). Readiness checks are lightweight and
client-side (name, club assigned, scoring unit when points are on, sane team
sizes when teams are on, at least one open participation mode) — the server
lifecycle model is untouched; a failed check blocks the Activate button with
an explanation, nothing more.

## Numbering

The deferred `events.club_id` NOT NULL wave renumbers from 00015 to **00016**.

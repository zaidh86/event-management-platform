# Phase 1 — Core Platform (Clubs · Capabilities · Platform Owner) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Clubs layer, capability-based event configuration, and the protected Platform
Owner role — with zero behavioral change for existing events and users.

**Architecture:** Additive-only SQL migrations (00004–00007) following the conventions of
`supabase/migrations/00001_init.sql` (text+CHECK roles, `security definer` helper predicates,
`<table>_<action>` policy names), plus additive TypeScript data-layer changes. The existing UI keeps
running unchanged; club-aware UI arrives in Phase 2.

**Tech Stack:** Supabase (Postgres + RLS), React 19 + TypeScript, supabase-js v2.

**Spec:** `docs/PRODUCT.md`, `docs/adr/0001…0005` (this plan implements them; read both).

## Global Constraints

- DO NOT modify: transaction functions (`_apply_transaction`, `process_transaction`), auth flow,
  `game_api_submit`, realtime publications, existing enum values (`organizer` etc. stay verbatim).
- Additive-only: no renames, drops of existing columns/tables, or type changes (ADR-0004 §1).
- Every migration ships with its rollback note (included per task) and is applied **one wave at a
  time** via Supabase SQL editor or `supabase db push`, with its verification queries run before
  the next wave.
- Migrations are numbered `00004…00007`, plus correctives `00008_fix_owner_grant_context.sql`
  (see Task 4 amendment) and `00009_phase1_table_grants.sql` (see Task 1 amendment). The deferred
  club_id NOT NULL wave is now `00010`, deliberately **excluded** from this plan and needing
  separate approval after a verification window (ADR-0004 wave 6).
- Gate at plan end: `npm run build` + `npm run lint` clean; browser regression (login, event flows,
  realtime leaderboard); RLS matrix green; security review of the full SQL diff.
- The project has no JS test runner; TS tasks verify via build + lint + browser checks. SQL tasks
  verify via the RLS matrix script (Task 5) — that is the test suite for this phase.

---

### Task 1: Migration 00004 — clubs, club_members, helpers, RLS, seed

> **⚠ Amendment (post-execution):** the 00004 SQL below creates the tables and policies but omits
> **table grants**, which this project requires explicitly (no baseline default privileges — see
> 00003 and the ADR-0005 amendment). The RLS matrix caught the omission (42501 before RLS).
> Corrected by `supabase/migrations/00009_phase1_table_grants.sql`. When adding future tables,
> ship grants + policies together — do not copy this version without them.

**Files:**
- Create: `supabase/migrations/00004_clubs.sql`

**Interfaces:**
- Produces: tables `public.clubs`, `public.club_members`; functions
  `public.is_club_member(uuid) → boolean`, `public.is_club_admin(uuid) → boolean` (both
  `security definer`, super-admin-inclusive like `has_event_role`). Later tasks rely on these names.

- [ ] **Step 1: Write the migration file exactly as follows**

```sql
-- 00004: Clubs layer (ADR-0001). Additive only; General club absorbs legacy events in 00005.

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  logo_url text,
  banner_url text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger clubs_touch before update on public.clubs
for each row execute function public.touch_updated_at();

create table public.club_members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('club_admin', 'member')),
  created_at timestamptz not null default now(),
  unique (club_id, user_id)
);

create index club_members_user_idx on public.club_members (user_id, club_id);
create index club_members_club_idx on public.club_members (club_id, role);

-- helper predicates, mirroring is_event_member / has_event_role conventions
create function public.is_club_member(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_members where club_id = p_club_id and user_id = auth.uid());
$$;

create function public.is_club_admin(p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1 from club_members
    where club_id = p_club_id and user_id = auth.uid() and role = 'club_admin'
  );
$$;

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;

-- clubs: directory readable by all signed-in users; created by platform admins;
-- edited by that club's admins; no DELETE policy (archive semantics, ADR-0001).
create policy clubs_select on public.clubs
  for select to authenticated using (true);
create policy clubs_insert on public.clubs
  for insert to authenticated with check (is_super_admin());
create policy clubs_update on public.clubs
  for update to authenticated using (is_club_admin(id)) with check (is_club_admin(id));

create policy club_members_select on public.club_members
  for select to authenticated using (is_club_member(club_id) or is_super_admin());
create policy club_members_insert on public.club_members
  for insert to authenticated with check (is_club_admin(club_id));
create policy club_members_update on public.club_members
  for update to authenticated using (is_club_admin(club_id));
create policy club_members_delete on public.club_members
  for delete to authenticated using (is_club_admin(club_id));

-- Seed the General club (idempotent; skipped on a fresh DB with no admin yet —
-- 00005 repeats this insert and the app trigger in 00005 covers late creation).
insert into public.clubs (slug, name, description, created_by)
select 'general', 'General', 'Default club for platform-wide and legacy events.',
       (select id from profiles where role = 'super_admin' order by created_at limit 1)
where not exists (select 1 from clubs where slug = 'general')
  and exists (select 1 from profiles where role = 'super_admin');
```

- [ ] **Step 2: Apply wave 1** — paste into Supabase SQL editor (or `supabase db push`). Expected: success, no errors.
- [ ] **Step 3: Verify**

```sql
select slug, name from clubs;                            -- expect: general | General
select proname from pg_proc where proname in ('is_club_member','is_club_admin');  -- expect both
select polname from pg_policy where polrelid = 'public.clubs'::regclass;          -- 3 policies
```

- [ ] **Step 4: Rollback note (include in PR):** `drop table public.club_members; drop table public.clubs; drop function public.is_club_admin(uuid); drop function public.is_club_member(uuid);` — safe while nothing references them (i.e., before 00005).
- [ ] **Step 5: Commit** — `git add supabase/migrations/00004_clubs.sql && git commit -m "feat(db): clubs layer — tables, helpers, RLS, General seed (ADR-0001)"`

---

### Task 2: Migration 00005 — events.club_id, backfill, default trigger, insert-policy fix

**Files:**
- Create: `supabase/migrations/00005_events_club.sql`

**Interfaces:**
- Consumes: `clubs`, `is_club_admin(uuid)` from Task 1.
- Produces: `events.club_id uuid` (nullable this phase), backfilled; trigger
  `events_default_club`; replaced policy `events_insert`.

- [ ] **Step 1: Write the migration file exactly as follows**

```sql
-- 00005: events belong to clubs (ADR-0001). Nullable now; NOT NULL is wave 00008 (separate approval).

alter table public.events add column club_id uuid references public.clubs (id);
create index events_club_idx on public.events (club_id);

-- Re-run the General seed (covers fresh DBs where 00004's seed was skipped).
insert into public.clubs (slug, name, description, created_by)
select 'general', 'General', 'Default club for platform-wide and legacy events.',
       (select id from profiles where role = 'super_admin' order by created_at limit 1)
where not exists (select 1 from clubs where slug = 'general')
  and exists (select 1 from profiles where role = 'super_admin');

update public.events
set club_id = (select id from clubs where slug = 'general')
where club_id is null;

-- New events without an explicit club land in General (keeps the current
-- "anyone can create an event" flow working unchanged until Phase 2 UI).
create function public.default_event_club()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.club_id is null then
    select id into new.club_id from clubs where slug = 'general';
  end if;
  return new;
end $$;

create trigger events_default_club before insert on public.events
for each row execute function public.default_event_club();

-- SECURITY FIX required by the new column: without this, any user could create
-- an event stamped with any club_id ("club spoofing"). Recreated same-name
-- policy preserves the legacy path (General) and adds the club-admin path.
drop policy events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated with check (
    created_by = auth.uid()
    and (
      club_id is null
      or club_id = (select id from clubs where slug = 'general')
      or is_club_admin(club_id)
    )
  );
```

- [ ] **Step 2: Apply wave 2.** Expected: success.
- [ ] **Step 3: Verify**

```sql
select count(*) from events where club_id is null;        -- expect: 0
-- as a normal signed-in user in the app: create an event → it must land in General.
-- attempt (via API) inserting an event with a non-General club you don't admin → RLS error.
```

- [ ] **Step 4: Rollback note:** `drop trigger events_default_club on public.events; drop function public.default_event_club(); alter table public.events drop column club_id;` then re-create the original `events_insert` policy from 00001 (`with check (created_by = auth.uid())`).
- [ ] **Step 5: Commit** — `git commit -m "feat(db): events.club_id + General backfill + spoof-safe insert policy (ADR-0001/0005)"`

---

### Task 3: Migration 00006 — event capabilities

**Files:**
- Create: `supabase/migrations/00006_event_capabilities.sql`

**Interfaces:**
- Produces: `events.capabilities jsonb` — keys: `teams, points, qr, attendance, submissions,
  judging, deadlines, feedback, certificates, games_api` (booleans). Task 7's normalizer is the
  single TS authority for defaults.

- [ ] **Step 1: Write the migration file exactly as follows**

```sql
-- 00006: capability-based event configuration (ADR-0003).
-- Default = legacy game-set so every existing event behaves identically.

alter table public.events add column capabilities jsonb not null default '{
  "teams": true, "points": true, "qr": true,
  "attendance": false, "submissions": false, "judging": false,
  "deadlines": false, "feedback": false, "certificates": false,
  "games_api": true
}'::jsonb;

-- Align the teams flag with reality for existing rows (individual events ≠ team events).
update public.events
set capabilities = jsonb_set(capabilities, '{teams}', to_jsonb(is_team_event));
```

- [ ] **Step 2: Apply wave 3.** Expected: success.
- [ ] **Step 3: Verify**

```sql
select capabilities ->> 'points' as points, capabilities ->> 'teams' as teams, is_team_event
from events limit 5;   -- points=true everywhere; teams matches is_team_event
```

- [ ] **Step 4: Rollback note:** `alter table public.events drop column capabilities;`
- [ ] **Step 5: Commit** — `git commit -m "feat(db): events.capabilities jsonb, legacy defaults (ADR-0003)"`

---

### Task 4: Migration 00007 — Platform Owner role + protection; runbook

> **⚠ Amendment (post-execution):** the `protect_profile_role()` body embedded below shipped with a
> guard-ordering bug — its final guard rejects the documented SQL-editor owner grant
> (`is_super_admin()` is always false when `auth.uid()` is null), and it references `NEW` on
> DELETE paths. Do **not** copy this version. The corrected function is
> `supabase/migrations/00008_fix_owner_grant_context.sql`; behavior spec in ADR-0002's amendment.

**Files:**
- Create: `supabase/migrations/00007_platform_owner.sql`
- Create: `docs/runbooks/assign-platform-owner.md`

**Interfaces:**
- Produces: role value `platform_owner`; `is_platform_owner() → boolean`; redefined
  `is_super_admin()` (owner-inclusive — this is how the owner inherits every existing policy);
  extended `protect_profile_role` trigger (UPDATE **and** DELETE).

- [ ] **Step 1: Write the migration file exactly as follows**

```sql
-- 00007: Platform Owner (ADR-0002). Exactly one, protected at the database layer.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('user', 'super_admin', 'platform_owner'));

-- at most one owner, enforced structurally
create unique index profiles_single_owner_idx on public.profiles ((role))
  where role = 'platform_owner';

create function public.is_platform_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'platform_owner');
$$;

-- Owner inherits super-admin everywhere: every existing policy and function that
-- calls is_super_admin() now covers the owner with zero further changes.
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('super_admin', 'platform_owner')
  );
$$;

-- Signup bootstrap: first user is super_admin only if no admin OR owner exists yet.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from profiles where role in ('super_admin', 'platform_owner'))
         then 'user' else 'super_admin' end
  );
  return new;
end $$;

-- Owner protection: the owner row cannot be demoted or deleted by ANYONE through
-- the API; ownership cannot be granted by app clients (only the SQL-editor
-- runbook, where auth.uid() is null). Super admins keep managing other roles.
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'platform_owner'
     and (tg_op = 'DELETE' or new.role is distinct from old.role) then
    raise exception 'The platform owner cannot be demoted or removed';
  end if;
  if tg_op = 'UPDATE' and new.role = 'platform_owner'
     and old.role is distinct from new.role and auth.uid() is not null then
    raise exception 'Platform ownership cannot be granted through the application';
  end if;
  if tg_op = 'UPDATE' and new.role is distinct from old.role and not public.is_super_admin() then
    raise exception 'Only a super admin can change global roles';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger on_profile_updated on public.profiles;
create trigger on_profile_updated
before update or delete on public.profiles
for each row execute function public.protect_profile_role();
```

- [ ] **Step 2: Write `docs/runbooks/assign-platform-owner.md`** — content:

```markdown
# Runbook: assign the Platform Owner (one-time)

Run in the Supabase SQL editor (auth.uid() is null there — the protection trigger
allows the grant only in this context). Requires 00007 applied.

    update profiles set role = 'platform_owner' where email = '<owner-email>';

Verify (both must pass):

    select email, role from profiles where role = 'platform_owner';  -- exactly 1 row
    update profiles set role = 'user' where role = 'platform_owner'; -- must FAIL:
    -- "The platform owner cannot be demoted or removed"
```

- [ ] **Step 3: Apply wave 4, then execute the runbook** for the user's account. Expected: grant succeeds; the demotion check in the runbook fails with the trigger's message.
- [ ] **Step 4: Verify protection from the application side** — as a super admin in the app, attempt to change the owner's role via the members/profile path (or a direct supabase-js `update`): must error with "The platform owner cannot be demoted or removed".
- [ ] **Step 5: Rollback note:** re-`create or replace` the 00001 versions of `is_super_admin`, `handle_new_user`, `protect_profile_role`; `drop trigger on_profile_updated` and recreate as `before update` only; `drop index profiles_single_owner_idx;` demote owner in SQL editor, then restore the original two-value check constraint.
- [ ] **Step 6: Commit** — `git commit -m "feat(db): platform_owner role, single-owner index, DB-level protection (ADR-0002)"`

---

### Task 5: RLS verification matrix

**Files:**
- Create: `tests/rls/phase1_matrix.sql`

**Interfaces:**
- Consumes: everything from Tasks 1–4. This is the phase's test suite (run in SQL editor or psql
  against the project DB **after** waves 1–4; safe: runs inside a rolled-back transaction).

- [ ] **Step 1: Write the matrix script exactly as follows**

```sql
-- Phase 1 RLS matrix. Wrap in a transaction and roll back: no residue.
begin;

-- Impersonation helper pattern (Supabase RLS testing):
--   set local role authenticated;
--   set local request.jwt.claims to '{"sub":"<user-uuid>","role":"authenticated"}';
-- Seed throwaway identities (bypasses RLS as postgres):
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'rls-clubadmin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'rls-member@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'rls-outsider@test.local')
  on conflict do nothing;
-- handle_new_user created their profiles as 'user' (an admin/owner already exists).

insert into clubs (slug, name, created_by)
values ('rls-test-club', 'RLS Test Club',
        (select id from profiles where role in ('super_admin','platform_owner') limit 1));
insert into club_members (club_id, user_id, role) values
  ((select id from clubs where slug='rls-test-club'), '00000000-0000-0000-0000-00000000000a', 'club_admin'),
  ((select id from clubs where slug='rls-test-club'), '00000000-0000-0000-0000-00000000000b', 'member');

-- CASE 1: outsider cannot read the test club's roster (cross-club isolation)
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
do $$ begin
  if exists (select 1 from club_members where club_id = (select id from clubs where slug='rls-test-club')) then
    raise exception 'FAIL case 1: outsider read club roster';
  end if; raise notice 'PASS case 1'; end $$;

-- CASE 2: outsider cannot insert an event into the test club (spoof guard)
do $$ begin
  begin
    insert into events (name, slug, club_id, created_by)
    values ('Spoof', 'rls-spoof', (select id from clubs where slug='rls-test-club'),
            '00000000-0000-0000-0000-00000000000c');
    raise exception 'FAIL case 2: club spoofing allowed';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS case 2';
  end; end $$;

-- CASE 3: club member (non-admin) cannot add members
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$ begin
  begin
    insert into club_members (club_id, user_id, role)
    values ((select id from clubs where slug='rls-test-club'), '00000000-0000-0000-0000-00000000000c', 'member');
    raise exception 'FAIL case 3: member managed roster';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS case 3';
  end; end $$;

-- CASE 4: club admin CAN add members
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$ begin
  insert into club_members (club_id, user_id, role)
  values ((select id from clubs where slug='rls-test-club'), '00000000-0000-0000-0000-00000000000c', 'member');
  raise notice 'PASS case 4'; end $$;

-- CASE 5: owner demotion blocked even for postgres (trigger, not RLS)
reset role;
do $$ begin
  begin
    update profiles set role = 'user' where role = 'platform_owner';
    raise exception 'FAIL case 5: owner demoted';
  exception when others then
    if sqlerrm like '%cannot be demoted%' then raise notice 'PASS case 5';
    else raise; end if;
  end; end $$;

rollback;  -- nothing persists
```

- [ ] **Step 2: Run it.** Expected output: `PASS case 1` … `PASS case 5`, then rollback. Any FAIL stops the phase — apply systematic-debugging before touching policies.
- [ ] **Step 3: Commit** — `git commit -m "test(db): Phase 1 RLS matrix (clubs isolation, spoof guard, owner protection)"`

---

### Task 6: Domain types

**Files:**
- Modify: `src/lib/types.ts` (additive only)

**Interfaces:**
- Produces (consumed by Tasks 7–9): `ClubRole`, `Club`, `ClubMember`, `EventCapabilities`;
  `GlobalRole` gains `'platform_owner'`; `EmpEvent` gains `club_id: string | null` and
  `capabilities: EventCapabilities`.

- [ ] **Step 1: Add to `types.ts`** (and extend `GlobalRole` / `EmpEvent` in place):

```ts
export type GlobalRole = 'user' | 'super_admin' | 'platform_owner'
export type ClubRole = 'club_admin' | 'member'

export interface Club {
  id: string
  slug: string
  name: string
  description: string
  logo_url: string | null
  banner_url: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ClubMember {
  id: string
  club_id: string
  user_id: string
  role: ClubRole
  created_at: string
}

export interface EventCapabilities {
  teams: boolean
  points: boolean
  qr: boolean
  attendance: boolean
  submissions: boolean
  judging: boolean
  deadlines: boolean
  feedback: boolean
  certificates: boolean
  games_api: boolean
}
// EmpEvent additions:
//   club_id: string | null
//   capabilities: EventCapabilities
```

- [ ] **Step 2: `npm run build`** — expect PASS (types are additive; `capabilities` may need a temporary optional marker until Task 7's normalizer guarantees it — prefer `capabilities: EventCapabilities` + normalize at the API boundary).
- [ ] **Step 3: Commit** — `git commit -m "feat(types): club, club member, capabilities, platform_owner"`

---

### Task 7: Capability normalizer

**Files:**
- Create: `src/lib/capabilities.ts`

**Interfaces:**
- Produces: `LEGACY_CAPABILITIES: EventCapabilities`, `normalizeCapabilities(raw: unknown,
  isTeamEvent: boolean): EventCapabilities` — the single TS authority for defaults; absent key =
  false, except the legacy default object used when the column is missing entirely (pre-00006 rows
  in dev snapshots).

- [ ] **Step 1: Write the module**

```ts
import type { EventCapabilities } from './types'

export const LEGACY_CAPABILITIES: EventCapabilities = {
  teams: true, points: true, qr: true,
  attendance: false, submissions: false, judging: false,
  deadlines: false, feedback: false, certificates: false,
  games_api: true,
}

// jsonb from the DB is untyped; absent keys mean false, absent column means legacy.
export function normalizeCapabilities(raw: unknown, isTeamEvent: boolean): EventCapabilities {
  const src = (raw && typeof raw === 'object' ? raw : LEGACY_CAPABILITIES) as Record<string, unknown>
  const get = (k: keyof EventCapabilities) => src[k] === true
  return {
    teams: raw == null ? isTeamEvent : get('teams'),
    points: get('points'), qr: get('qr'), attendance: get('attendance'),
    submissions: get('submissions'), judging: get('judging') && get('submissions'),
    deadlines: get('deadlines'), feedback: get('feedback'),
    certificates: get('certificates'), games_api: get('games_api'),
  }
}
```

- [ ] **Step 2: `npm run build` + `npm run lint`** — PASS.
- [ ] **Step 3: Commit** — `git commit -m "feat(lib): capability normalizer with legacy defaults (ADR-0003)"`

---

### Task 8: Club data access

**Files:**
- Modify: `src/lib/api.ts` (append a `-- clubs --` section; additive only)

**Interfaces:**
- Consumes: `Club`, `ClubMember`, `ClubRole` (Task 6); tables/policies (Tasks 1–2).
- Produces: `listClubs(): Promise<Club[]>` · `getClubBySlug(slug): Promise<Club | null>` ·
  `listMyClubMemberships(userId): Promise<ClubMember[]>` · `listClubMembers(clubId):
  Promise<(ClubMember & { profile: Profile })[]>` · `createClub(fields): Promise<Club>` ·
  `updateClub(id, fields): Promise<Club>` · `addClubMemberByEmail(clubId, email, role):
  Promise<void>` · `updateClubMemberRole(memberId, role): Promise<void>` ·
  `removeClubMember(memberId): Promise<void>` · `listClubEvents(clubId): Promise<EmpEvent[]>`

- [ ] **Step 1: Implement following the file's existing patterns** (`throwIf`, `.maybeSingle()`,
  ordered selects; `addClubMemberByEmail` mirrors `addMemberByEmail`'s profile-lookup-then-insert
  shape, including its "must sign up first" error).
- [ ] **Step 2:** Also thread `normalizeCapabilities` into the event mappers (`listMyEvents`,
  `getEvent`, `getEventBySlug`) so `EmpEvent.capabilities` is always populated.
- [ ] **Step 3: `npm run build` + `npm run lint`** — PASS.
- [ ] **Step 4: Commit** — `git commit -m "feat(api): club data access + capability normalization"`

---

### Task 9: AuthContext owner awareness

**Files:**
- Modify: `src/contexts/AuthContext.tsx`

**Interfaces:**
- Produces: `isOwner: boolean` on `AuthState`; `isSuperAdmin` becomes
  `profile?.role === 'super_admin' || profile?.role === 'platform_owner'` (mirrors the SQL-side
  redefinition of `is_super_admin()` so client checks agree with RLS).

- [ ] **Step 1: Implement** — add `isOwner: profile?.role === 'platform_owner'` to the context
  value + interface; update `isSuperAdmin` expression; default context gets `isOwner: false`.
- [ ] **Step 2: `npm run build` + `npm run lint`** — PASS.
- [ ] **Step 3: Browser check** — sign in as the owner account: super-admin badge still shows
  (inheritance), no console errors.
- [ ] **Step 4: Commit** — `git commit -m "feat(auth): platform owner awareness (owner ⊇ super admin)"`

---

### Task 10: Phase gate

- [ ] `npm run build` + `npm run lint` — clean.
- [ ] RLS matrix (Task 5) — all PASS.
- [ ] Browser regression (webapp-testing): login → home → event → leaderboard realtime update →
  scan flow unaffected; legacy events behave identically (capabilities default on).
- [ ] Security review (security-review skill) over the full SQL diff of 00004–00007.
- [ ] verification-before-completion: report with evidence; **stop before 00008 (NOT NULL)** —
  separate approval per ADR-0004.

## Self-review notes (per writing-plans)

- Spec coverage: ADR-0001 → Tasks 1–2; ADR-0002 → Task 4 + 9; ADR-0003 → Tasks 3, 7, 8;
  ADR-0004 → wave ordering + rollback notes; ADR-0005 → Task 5 + policy SQL. Wave 6 (NOT NULL)
  intentionally out of scope.
- Type consistency: `is_club_admin(uuid)` used in 00005 policy matches Task 1 definition;
  `EventCapabilities` keys in 00006 default JSON match Task 6/7 exactly (10 keys).
- Placeholder scan: all SQL/TS content inline; Task 8 references existing api.ts patterns by name
  rather than repeating 40 lines of boilerplate — the executor reads the file being modified.

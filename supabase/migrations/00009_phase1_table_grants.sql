-- 00009: table grants for the Phase 1 tables (fixes the 00004 omission).
--
-- This project has no baseline default privileges on the public schema (see
-- 00003): every new table needs explicit grants or PostgREST denies access at
-- the table-privilege gate before RLS runs — exactly what the Phase 1 RLS
-- matrix caught (42501 on clubs as `authenticated`). Grants below mirror the
-- RLS policy surface, least-privilege, per the 00003 conventions. RLS remains
-- the row-level enforcement layer on both tables.

-- authenticated: reads gated by RLS SELECT policies; writes only where an RLS
-- write policy exists. clubs gets NO delete grant: no delete policy (archive
-- semantics, ADR-0001) — grant-less + policy-less is the intended double lock.
grant select, insert, update on public.clubs to authenticated;
grant select, insert, update, delete on public.club_members to authenticated;

-- anon: nothing — no anon policies exist on either table.

-- service_role: server-side only, mirrors 00003's all-tables convention
-- (00003 ran before these tables existed, so they were not enumerated).
grant select, insert, update, delete on public.clubs to service_role;
grant select, insert, update, delete on public.club_members to service_role;

-- Rollback:
--   revoke all on public.clubs, public.club_members from authenticated, service_role;

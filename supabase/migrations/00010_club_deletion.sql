-- 00010: club deletion — platform administrators only (ADR-0001/0002 amendment).
--
-- 00004 created clubs with no DELETE policy and 00009 deliberately withheld the
-- DELETE grant from `authenticated` ("archive semantics", the documented double
-- lock). Club deletion is now a supported platform-level action, so this
-- migration adds the minimum required pair.
--
-- Authorization is the grant AND the policy together: `authenticated` holds the
-- table privilege, but RLS admits only is_super_admin() — which covers
-- super_admin and, through 00007's redefinition, platform_owner. A club_admin
-- cannot delete a club, including their own; neither can members, ordinary
-- users, or anon (no grant, no policy).
--
-- events.club_id keeps its NO ACTION referential behavior ON PURPOSE (00005:3):
-- deleting a club that still owns events fails with SQLSTATE 23503 and the whole
-- statement rolls back, so no event, participant, team, activity, account,
-- transaction or announcement is ever cascade-deleted by a club delete. Only an
-- empty club can be deleted, and only its club_members rows follow it (the
-- pre-existing ON DELETE CASCADE from 00004).
--
-- No slug is exempt. The General fallback club is retired in the same change set
-- (00011), so there is no privileged row for this policy to protect — and an
-- exemption would make any future club whose name slugifies to 'general'
-- permanently undeletable.
--
-- APPLY 00010 AND 00011 TOGETHER, as one script in a single run. Applying this
-- file alone leaves a window in which a super admin can delete the still-live
-- General club while its fallback machinery is armed — the exact silent-orphan
-- case 00011 exists to prevent.

grant delete on public.clubs to authenticated;

-- idempotent: Postgres has no CREATE POLICY IF NOT EXISTS, and a re-paste of this
-- file would otherwise fail with 42710
drop policy if exists clubs_delete on public.clubs;
create policy clubs_delete on public.clubs
  for delete to authenticated using (is_super_admin());

-- Rollback:
--   drop policy clubs_delete on public.clubs;
--   revoke delete on public.clubs from authenticated;

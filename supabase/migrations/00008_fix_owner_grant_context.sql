-- 00008: corrective patch for 00007 (ADR-0002 amendment).
--
-- Bug: 00007's protect_profile_role() documented that an administrative SQL
-- context (Supabase SQL editor, auth.uid() IS NULL) could grant the initial
-- platform_owner, but its final guard — inherited from 00001 — rejected ANY
-- role change when is_super_admin() was false, and is_super_admin() is always
-- false when auth.uid() IS NULL. The documented bootstrap path never worked.
-- Second defect: the 00007 version referenced NEW in expressions reachable
-- during DELETE, where NEW does not exist in a delete trigger.
--
-- This migration replaces ONLY the function body. The on_profile_updated
-- trigger, profiles_single_owner_idx, profiles_role_check, is_platform_owner(),
-- is_super_admin(), and handle_new_user() are untouched.

create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Administrative SQL context = no end-user JWT at all: Supabase SQL editor,
  -- psql, migrations. service_role and anon requests also carry a null
  -- auth.uid(), so they are excluded explicitly and never count as admin.
  v_admin_ctx boolean := auth.uid() is null
    and coalesce(auth.role(), '') not in ('service_role', 'anon');
begin
  -- DELETE first: NEW is not available in a delete trigger.
  if tg_op = 'DELETE' then
    if old.role = 'platform_owner' then
      raise exception 'The platform owner cannot be demoted or removed';
    end if;
    return old;
  end if;

  -- UPDATE from here on.
  -- 1. The owner row is permanent: no role change by anyone, in any context.
  if old.role = 'platform_owner' and new.role is distinct from old.role then
    raise exception 'The platform owner cannot be demoted or removed';
  end if;

  if new.role is distinct from old.role then
    -- 2. Ownership is granted only from an administrative SQL context.
    if new.role = 'platform_owner' and not v_admin_ctx then
      raise exception 'Platform ownership cannot be granted through the application';
    end if;

    -- 3. Every other global-role change: super admins, or the admin SQL context.
    if new.role <> 'platform_owner'
       and not v_admin_ctx
       and not public.is_super_admin() then
      raise exception 'Only a super admin can change global roles';
    end if;
  end if;

  return new;
end $$;

-- 00015: platform administration (ADR-0010).
--
-- Two additions, both platform-authority-gated at the DATABASE layer:
--
--   1. events.is_featured — explicit platform curation for the Home page.
--      Only platform admins (super_admin / platform_owner, per is_super_admin())
--      may set or clear it: the events_update RLS policy lets organizers and
--      club admins update their events, so a dedicated trigger guards this one
--      column the same way protect_profile_role guards profiles.role.
--
--   2. transfer_platform_ownership() — a deliberate, atomic, application-level
--      ownership transfer that REPLACES the documented break-glass runbook
--      (SQL-editor trigger context) for handovers. The single-owner invariant
--      (profiles_single_owner_idx, 00007) and the owner-protection trigger stay
--      fully armed; the transfer opens a transaction-local, function-scoped
--      bypass that nothing else can reach:
--        * the gate is a GUC set via set_config(..., is_local => true) inside
--          the SECURITY DEFINER function — it exists only for the remainder of
--          that transaction;
--        * PostgREST exposes only functions in the public schema, so API
--          clients cannot call pg_catalog.set_config to forge the gate;
--        * the function itself verifies the CALLER is the platform owner
--          before opening it.
--      Demote-then-promote ordering satisfies the single-owner unique index,
--      and both updates share one transaction: any failure rolls the whole
--      transfer back, so the platform is never ownerless and never dual-owned.
--
-- The first-signup bootstrap (handle_new_user, 00007) is intentionally NOT
-- changed here: it is the documented development bootstrap, and hardening it
-- for production deployment is tracked as a separate controlled change.
--
-- NOTE on numbering: the deferred events.club_id NOT NULL wave renumbers again,
-- from 00015 to 00016 (still requires its own approval).
--
-- Additive; 00001-00014 untouched (protect_profile_role is replaced body-only,
-- the same corrective pattern 00008 used). Rollback notes at the end.

-- ============================================================================
-- 1. FEATURED EVENTS
-- ============================================================================

alter table public.events add column is_featured boolean not null default false;

-- the Home page reads only featured rows; a partial index keeps that cheap
create index events_featured_idx on public.events (created_at desc)
  where is_featured;

-- Column guard: featuring is platform curation, not event configuration.
-- Admin SQL context (auth.uid() null, not service/anon — same definition as
-- 00008) is allowed so migrations/runbooks keep working.
create function public.protect_event_featured()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_admin_ctx boolean := auth.uid() is null
    and coalesce(auth.role(), '') not in ('service_role', 'anon');
begin
  if tg_op = 'INSERT' then
    if new.is_featured and not (v_admin_ctx or public.is_super_admin()) then
      raise exception 'Only platform administrators can feature events';
    end if;
  elsif new.is_featured is distinct from old.is_featured
        and not (v_admin_ctx or public.is_super_admin()) then
    raise exception 'Only platform administrators can feature events';
  end if;
  return new;
end $$;

create trigger protect_event_featured
before insert or update on public.events
for each row execute function public.protect_event_featured();

-- replica-mode-proof, mirroring protect_event_club (00011)
alter table public.events enable always trigger protect_event_featured;

-- ============================================================================
-- 2. OWNERSHIP TRANSFER
-- ============================================================================

-- 2a. protect_profile_role gains exactly one new arm: the transaction-local
--     transfer gate. Every 00008 rule is otherwise unchanged, including the
--     unconditional block on DELETING the owner row (a transfer never deletes).
create or replace function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Administrative SQL context = no end-user JWT at all: Supabase SQL editor,
  -- psql, migrations. service_role and anon requests also carry a null
  -- auth.uid(), so they are excluded explicitly and never count as admin.
  v_admin_ctx boolean := auth.uid() is null
    and coalesce(auth.role(), '') not in ('service_role', 'anon');
  -- Transaction-local gate opened ONLY inside transfer_platform_ownership()
  -- (set_config with is_local => true); unreachable through the API surface.
  v_transfer boolean := coalesce(current_setting('emp.ownership_transfer', true), '')
    = 'transfer_platform_ownership';
begin
  -- DELETE first: NEW is not available in a delete trigger.
  if tg_op = 'DELETE' then
    if old.role = 'platform_owner' then
      raise exception 'The platform owner cannot be demoted or removed';
    end if;
    return old;
  end if;

  -- UPDATE from here on.
  -- 1. The owner row changes role only through an active ownership transfer.
  if old.role = 'platform_owner' and new.role is distinct from old.role
     and not v_transfer then
    raise exception 'The platform owner cannot be demoted or removed';
  end if;

  if new.role is distinct from old.role then
    -- 2. Ownership is granted only from an administrative SQL context or an
    --    active ownership transfer.
    if new.role = 'platform_owner' and not v_admin_ctx and not v_transfer then
      raise exception 'Platform ownership cannot be granted through the application';
    end if;

    -- 3. Every other global-role change: super admins, the admin SQL context,
    --    or an active transfer (whose caller is the owner anyway).
    if new.role <> 'platform_owner'
       and not v_admin_ctx
       and not v_transfer
       and not public.is_super_admin() then
      raise exception 'Only a super admin can change global roles';
    end if;
  end if;

  return new;
end $$;

-- 2b. The transfer itself.
create function public.transfer_platform_ownership(p_new_owner_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner profiles%rowtype;
  v_target profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- row locks serialize concurrent transfer attempts
  select * into v_owner from profiles where id = auth.uid() for update;
  if not found or v_owner.role is distinct from 'platform_owner' then
    raise exception 'Only the platform owner can transfer ownership';
  end if;
  if p_new_owner_id = v_owner.id then
    raise exception 'You already are the platform owner';
  end if;

  select * into v_target from profiles where id = p_new_owner_id for update;
  if not found then
    raise exception 'Target account not found';
  end if;

  -- open the transaction-local gate, then demote BEFORE promote so the
  -- single-owner partial unique index is satisfied at every step
  perform set_config('emp.ownership_transfer', 'transfer_platform_ownership', true);
  update profiles set role = 'super_admin' where id = v_owner.id;
  update profiles set role = 'platform_owner' where id = v_target.id;
  perform set_config('emp.ownership_transfer', '', true);

  -- both updates share this transaction: a failure anywhere rolls everything
  -- back, so exactly one owner exists before, during (index-wise) and after
  return jsonb_build_object(
    'status', 'ok',
    'previous_owner_id', v_owner.id,
    'new_owner_id', v_target.id,
    'new_owner_email', v_target.email
  );
end $$;

-- the function authorizes its caller itself; anon has no business here
revoke all on function public.transfer_platform_ownership(uuid) from public, anon;
grant execute on function public.transfer_platform_ownership(uuid) to authenticated;

-- ============================================================================
-- Rollback:
--   drop function public.transfer_platform_ownership(uuid);
--   -- restore the 00008 body of protect_profile_role() verbatim
--   drop trigger protect_event_featured on public.events;
--   drop function public.protect_event_featured();
--   alter table public.events drop column is_featured;
-- ============================================================================

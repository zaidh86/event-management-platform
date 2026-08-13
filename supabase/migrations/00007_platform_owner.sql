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

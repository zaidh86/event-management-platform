-- EMP — Event Management Platform: initial schema
-- Source of truth for the database. Apply with `supabase db reset` / `supabase db push`
-- or paste into the Supabase SQL editor on a fresh project.

create extension if not exists pgcrypto;

-- ============================================================================
-- TABLES
-- ============================================================================

-- 1:1 with auth.users. Global role only; event-scoped roles live in event_members.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'user' check (role in ('user', 'super_admin')),
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'ended', 'archived')),
  -- team configuration
  is_team_event boolean not null default false,
  team_size_min int not null default 1 check (team_size_min >= 1),
  team_size_max int not null default 4 check (team_size_max >= 1),
  -- currency configuration
  currency_name text not null default 'Point',
  currency_name_plural text not null default 'Points',
  currency_image_url text, -- null = app default image
  starting_balance numeric not null default 0,
  min_balance numeric not null default 0,
  allow_negative boolean not null default false,
  -- registration: array of field definitions
  -- [{ key, label, type: 'text'|'number'|'select', required, options? }]
  registration_fields jsonb not null default '[]',
  -- branding
  logo_url text,
  banner_url text,
  theme_color text not null default '#6d28d9',
  public_leaderboard boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (team_size_max >= team_size_min)
);

-- Event-scoped roles. One role per user per event.
create table public.event_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('organizer', 'activity_admin', 'volunteer', 'participant')),
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  qr_token text not null unique default ('t_' || encode(gen_random_bytes(12), 'hex')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  display_name text not null,
  registration_data jsonb not null default '{}',
  qr_token text not null unique default ('p_' || encode(gen_random_bytes(12), 'hex')),
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

-- Balance holder: one per participant (individual events) or per team (team events).
-- balance is only ever written by _apply_transaction().
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  owner_type text not null check (owner_type in ('participant', 'team')),
  owner_id uuid not null,
  balance numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (owner_type, owner_id)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  description text not null default '',
  kind text not null check (kind in ('configured', 'integrated')),
  -- { entry_fee, reward, deduction, time_limit_seconds, rules, ... } — open-ended
  config jsonb not null default '{}',
  -- integrated activities: SHA-256 hex of the API key (plaintext never stored)
  api_key_hash text,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

-- Append-only ledger. Every balance change has exactly one row here.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  activity_id uuid references public.activities (id) on delete set null,
  amount numeric not null,
  type text not null check (type in ('award', 'deduct', 'entry_fee', 'adjustment', 'starting_balance')),
  description text not null default '',
  metadata jsonb not null default '{}',
  actor_id uuid references public.profiles (id), -- null when applied by an integrated game / system
  actor_label text, -- e.g. 'game:Blackjack' or 'system'
  created_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null,
  body text not null default '',
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- INDEXES (hot paths: leaderboard, ledgers, membership, QR lookup)
-- ============================================================================

create index accounts_leaderboard_idx on public.accounts (event_id, balance desc);
create index transactions_event_idx on public.transactions (event_id, created_at desc);
create index transactions_account_idx on public.transactions (account_id, created_at desc);
create index event_members_user_idx on public.event_members (user_id, event_id);
create index event_members_event_idx on public.event_members (event_id, role);
create index participants_event_idx on public.participants (event_id);
create index participants_user_idx on public.participants (user_id);
create index participants_team_idx on public.participants (team_id);
create index teams_event_idx on public.teams (event_id);
create index activities_event_idx on public.activities (event_id);
create index activities_key_idx on public.activities (api_key_hash) where api_key_hash is not null;
create index announcements_event_idx on public.announcements (event_id, created_at desc);

-- ============================================================================
-- HELPER FUNCTIONS (security definer to avoid RLS recursion in policies)
-- ============================================================================

create function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'super_admin');
$$;

create function public.is_event_member(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from event_members where event_id = p_event_id and user_id = auth.uid());
$$;

create function public.has_event_role(p_event_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or exists (
    select 1 from event_members
    where event_id = p_event_id and user_id = auth.uid() and role = any (p_roles)
  );
$$;

create function public.current_user_team_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select team_id from participants where user_id = auth.uid() and team_id is not null;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-create profile on signup. The very first user becomes super_admin
-- (bootstrap; further super admins are promoted by an existing one).
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from profiles where role = 'super_admin') then 'user' else 'super_admin' end
  );
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Event creator automatically becomes its organizer.
create function public.handle_new_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into event_members (event_id, user_id, role)
  values (new.id, new.created_by, 'organizer')
  on conflict (event_id, user_id) do nothing;
  return new;
end $$;

create trigger on_event_created
after insert on public.events
for each row execute function public.handle_new_event();

-- Only super admins may change global roles.
create function public.protect_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_super_admin() then
    raise exception 'Only a super admin can change global roles';
  end if;
  return new;
end $$;

create trigger on_profile_updated
before update on public.profiles
for each row execute function public.protect_profile_role();

create function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger events_touch before update on public.events
for each row execute function public.touch_updated_at();

-- ============================================================================
-- TRANSACTION CORE — the ONLY code path that changes balances
-- ============================================================================

-- Internal. Locks the account row, enforces the event's minimum balance,
-- appends the ledger row, updates the balance. Not callable by clients.
create function public._apply_transaction(
  p_account_id uuid,
  p_amount numeric,
  p_type text,
  p_activity_id uuid,
  p_description text,
  p_metadata jsonb,
  p_actor_id uuid,
  p_actor_label text
) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare
  v_acc accounts%rowtype;
  v_ev events%rowtype;
  v_min numeric;
  v_tx transactions%rowtype;
begin
  select * into v_acc from accounts where id = p_account_id for update;
  if not found then
    raise exception 'Account not found';
  end if;

  select * into v_ev from events where id = v_acc.event_id;

  v_min := case when v_ev.allow_negative then v_ev.min_balance else greatest(v_ev.min_balance, 0) end;
  if v_acc.balance + p_amount < v_min then
    raise exception 'Insufficient balance: current % %, minimum allowed %',
      v_acc.balance, v_ev.currency_name_plural, v_min;
  end if;

  insert into transactions (event_id, account_id, activity_id, amount, type, description, metadata, actor_id, actor_label)
  values (v_acc.event_id, p_account_id, p_activity_id, p_amount, p_type,
          coalesce(p_description, ''), coalesce(p_metadata, '{}'::jsonb), p_actor_id, p_actor_label)
  returning * into v_tx;

  update accounts set balance = balance + p_amount, updated_at = now() where id = p_account_id;
  return v_tx;
end $$;

revoke all on function public._apply_transaction from public, anon, authenticated;

-- Staff-facing entry point (volunteers, activity admins, organizers).
create function public.process_transaction(
  p_account_id uuid,
  p_amount numeric,
  p_type text default 'award',
  p_activity_id uuid default null,
  p_description text default '',
  p_metadata jsonb default '{}'
) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select a.event_id, e.status into v_event_id, v_status
  from accounts a join events e on e.id = a.event_id
  where a.id = p_account_id;
  if v_event_id is null then
    raise exception 'Account not found';
  end if;

  if p_type not in ('award', 'deduct', 'entry_fee', 'adjustment') then
    raise exception 'Invalid transaction type %', p_type;
  end if;
  if p_type = 'award' and p_amount <= 0 then
    raise exception 'Award amount must be positive';
  end if;
  if p_type in ('deduct', 'entry_fee') and p_amount >= 0 then
    raise exception 'Deduction amount must be negative';
  end if;
  if p_amount = 0 then
    raise exception 'Amount cannot be zero';
  end if;

  if p_type = 'adjustment' then
    -- manual corrections: organizers only, allowed while not archived
    if not has_event_role(v_event_id, array['organizer']) then
      raise exception 'Only organizers can make adjustments';
    end if;
    if v_status = 'archived' then
      raise exception 'Event is archived';
    end if;
  else
    if not has_event_role(v_event_id, array['organizer', 'activity_admin', 'volunteer']) then
      raise exception 'Not authorized to record transactions for this event';
    end if;
    if v_status <> 'active' then
      raise exception 'Event is not active';
    end if;
  end if;

  return _apply_transaction(p_account_id, p_amount, p_type, p_activity_id,
                            p_description, p_metadata, auth.uid(), null);
end $$;

revoke all on function public.process_transaction from public, anon;

-- ============================================================================
-- REGISTRATION / TEAMS
-- ============================================================================

create function public.register_for_event(
  p_event_id uuid,
  p_display_name text,
  p_registration_data jsonb default '{}'
) returns public.participants
language plpgsql security definer set search_path = public as $$
declare
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_acc_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select * into v_ev from events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;
  if v_ev.status <> 'active' then
    raise exception 'Registration is not open for this event';
  end if;
  if exists (select 1 from participants where event_id = p_event_id and user_id = auth.uid()) then
    raise exception 'Already registered for this event';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'Display name is required';
  end if;

  insert into participants (event_id, user_id, display_name, registration_data)
  values (p_event_id, auth.uid(), trim(p_display_name), coalesce(p_registration_data, '{}'::jsonb))
  returning * into v_p;

  insert into event_members (event_id, user_id, role)
  values (p_event_id, auth.uid(), 'participant')
  on conflict (event_id, user_id) do nothing;

  -- individual events: account per participant. team events: account created with the team.
  if not v_ev.is_team_event then
    insert into accounts (event_id, owner_type, owner_id)
    values (p_event_id, 'participant', v_p.id)
    returning id into v_acc_id;
    if v_ev.starting_balance <> 0 then
      perform _apply_transaction(v_acc_id, v_ev.starting_balance, 'starting_balance',
                                 null, 'Starting balance', '{}'::jsonb, null, 'system');
    end if;
  end if;

  return v_p;
end $$;

revoke all on function public.register_for_event from public, anon;

create function public.create_team(p_event_id uuid, p_name text)
returns public.teams
language plpgsql security definer set search_path = public as $$
declare
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_team teams%rowtype;
  v_acc_id uuid;
begin
  select * into v_ev from events where id = p_event_id;
  if not found or not v_ev.is_team_event then
    raise exception 'Not a team event';
  end if;
  if v_ev.status <> 'active' then
    raise exception 'Event is not active';
  end if;
  select * into v_p from participants where event_id = p_event_id and user_id = auth.uid();
  if not found then
    raise exception 'Register for the event before creating a team';
  end if;
  if v_p.team_id is not null then
    raise exception 'You are already in a team';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Team name is required';
  end if;

  insert into teams (event_id, name, created_by)
  values (p_event_id, trim(p_name), auth.uid())
  returning * into v_team;

  insert into accounts (event_id, owner_type, owner_id)
  values (p_event_id, 'team', v_team.id)
  returning id into v_acc_id;
  if v_ev.starting_balance <> 0 then
    perform _apply_transaction(v_acc_id, v_ev.starting_balance, 'starting_balance',
                               null, 'Starting balance', '{}'::jsonb, null, 'system');
  end if;

  update participants set team_id = v_team.id where id = v_p.id;
  return v_team;
end $$;

revoke all on function public.create_team from public, anon;

create function public.join_team(p_team_id uuid)
returns public.teams
language plpgsql security definer set search_path = public as $$
declare
  v_team teams%rowtype;
  v_ev events%rowtype;
  v_p participants%rowtype;
  v_count int;
begin
  -- lock the team row to serialize concurrent joins against the size limit
  select * into v_team from teams where id = p_team_id for update;
  if not found then
    raise exception 'Team not found';
  end if;
  select * into v_ev from events where id = v_team.event_id;
  if v_ev.status <> 'active' then
    raise exception 'Event is not active';
  end if;
  select * into v_p from participants where event_id = v_team.event_id and user_id = auth.uid();
  if not found then
    raise exception 'Register for the event before joining a team';
  end if;
  if v_p.team_id is not null then
    raise exception 'You are already in a team';
  end if;
  select count(*) into v_count from participants where team_id = p_team_id;
  if v_count >= v_ev.team_size_max then
    raise exception 'Team is full (max % members)', v_ev.team_size_max;
  end if;

  update participants set team_id = p_team_id where id = v_p.id;
  return v_team;
end $$;

revoke all on function public.join_team from public, anon;

-- ============================================================================
-- QR RESOLUTION (staff scanning)
-- ============================================================================

create function public.resolve_qr(p_qr_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_p participants%rowtype;
  v_team teams%rowtype;
  v_acc accounts%rowtype;
  v_ev events%rowtype;
begin
  select * into v_p from participants where qr_token = p_qr_token;
  if found then
    select * into v_ev from events where id = v_p.event_id;
    if auth.uid() is not null
       and not has_event_role(v_p.event_id, array['organizer', 'activity_admin', 'volunteer']) then
      raise exception 'Not authorized to scan for this event';
    end if;
    -- team events: points live on the team account
    if v_ev.is_team_event then
      if v_p.team_id is null then
        raise exception 'Participant has no team yet';
      end if;
      select * into v_team from teams where id = v_p.team_id;
      select * into v_acc from accounts where owner_type = 'team' and owner_id = v_team.id;
      return jsonb_build_object(
        'kind', 'team', 'event_id', v_p.event_id,
        'participant_id', v_p.id, 'participant_name', v_p.display_name,
        'team_id', v_team.id, 'name', v_team.name,
        'account_id', v_acc.id, 'balance', v_acc.balance
      );
    end if;
    select * into v_acc from accounts where owner_type = 'participant' and owner_id = v_p.id;
    return jsonb_build_object(
      'kind', 'participant', 'event_id', v_p.event_id,
      'participant_id', v_p.id, 'name', v_p.display_name,
      'account_id', v_acc.id, 'balance', v_acc.balance
    );
  end if;

  select * into v_team from teams where qr_token = p_qr_token;
  if found then
    if auth.uid() is not null
       and not has_event_role(v_team.event_id, array['organizer', 'activity_admin', 'volunteer']) then
      raise exception 'Not authorized to scan for this event';
    end if;
    select * into v_acc from accounts where owner_type = 'team' and owner_id = v_team.id;
    return jsonb_build_object(
      'kind', 'team', 'event_id', v_team.event_id,
      'team_id', v_team.id, 'name', v_team.name,
      'account_id', v_acc.id, 'balance', v_acc.balance
    );
  end if;

  raise exception 'Unknown QR code';
end $$;

-- anon must not resolve QR tokens; service_role (game API) may.
revoke all on function public.resolve_qr from public, anon;

-- ============================================================================
-- LEADERBOARD
-- ============================================================================

create function public.get_leaderboard(p_event_id uuid)
returns table (
  rank bigint,
  account_id uuid,
  owner_type text,
  owner_id uuid,
  name text,
  balance numeric,
  member_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ev events%rowtype;
begin
  select * into v_ev from events where id = p_event_id;
  if not found then
    raise exception 'Event not found';
  end if;
  if not v_ev.public_leaderboard
     and coalesce(auth.role(), '') <> 'service_role' -- game-api Edge Function
     and not is_event_member(p_event_id)
     and not is_super_admin() then
    raise exception 'Leaderboard is not public for this event';
  end if;

  return query
  select
    row_number() over (order by a.balance desc, coalesce(t.name, p.display_name) asc) as rank,
    a.id as account_id,
    a.owner_type,
    a.owner_id,
    coalesce(t.name, p.display_name) as name,
    a.balance,
    case when a.owner_type = 'team'
         then (select count(*) from participants m where m.team_id = t.id)
         else 1::bigint end as member_count
  from accounts a
  left join teams t on a.owner_type = 'team' and t.id = a.owner_id
  left join participants p on a.owner_type = 'participant' and p.id = a.owner_id
  where a.event_id = p_event_id
  order by a.balance desc, coalesce(t.name, p.display_name) asc;
end $$;

grant execute on function public.get_leaderboard to anon, authenticated;

-- ============================================================================
-- GAME INTEGRATION API (called by the game-api Edge Function with service role)
-- ============================================================================

create function public.game_api_submit(
  p_activity_id uuid,
  p_qr_token text,
  p_amount numeric,
  p_description text default '',
  p_metadata jsonb default '{}'
) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare
  v_act activities%rowtype;
  v_ev events%rowtype;
  v_info jsonb;
begin
  select * into v_act from activities where id = p_activity_id;
  if not found or v_act.kind <> 'integrated' or not v_act.is_active then
    raise exception 'Activity is not an active integrated activity';
  end if;
  select * into v_ev from events where id = v_act.event_id;
  if v_ev.status <> 'active' then
    raise exception 'Event is not active';
  end if;
  if p_amount = 0 then
    raise exception 'Amount cannot be zero';
  end if;

  v_info := resolve_qr(p_qr_token);
  if (v_info ->> 'event_id')::uuid <> v_act.event_id then
    raise exception 'QR code belongs to a different event';
  end if;

  return _apply_transaction(
    (v_info ->> 'account_id')::uuid,
    p_amount,
    case when p_amount > 0 then 'award' else 'deduct' end,
    p_activity_id,
    coalesce(nullif(p_description, ''), v_act.name),
    coalesce(p_metadata, '{}'::jsonb),
    null,
    'game:' || v_act.name
  );
end $$;

revoke all on function public.game_api_submit from public, anon, authenticated;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_members enable row level security;
alter table public.teams enable row level security;
alter table public.participants enable row level security;
alter table public.accounts enable row level security;
alter table public.activities enable row level security;
alter table public.transactions enable row level security;
alter table public.announcements enable row level security;

-- profiles: readable by signed-in users (needed to add members by email);
-- users edit their own row; role changes gated by trigger + super admin policy.
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles
  for update to authenticated using (is_super_admin()) with check (is_super_admin());

-- events
create policy events_select_public on public.events
  for select to anon using (public_leaderboard = true and status in ('active', 'ended'));
create policy events_select_auth on public.events
  for select to authenticated using (
    status <> 'draft' or created_by = auth.uid() or is_event_member(id) or is_super_admin()
  );
create policy events_insert on public.events
  for insert to authenticated with check (created_by = auth.uid());
create policy events_update on public.events
  for update to authenticated using (has_event_role(id, array['organizer']))
  with check (has_event_role(id, array['organizer']));
create policy events_delete on public.events
  for delete to authenticated using (is_super_admin());

-- event_members: members can see the roster; organizers manage it.
create policy event_members_select on public.event_members
  for select to authenticated using (is_event_member(event_id) or is_super_admin());
create policy event_members_insert on public.event_members
  for insert to authenticated with check (has_event_role(event_id, array['organizer']));
create policy event_members_update on public.event_members
  for update to authenticated using (has_event_role(event_id, array['organizer']));
create policy event_members_delete on public.event_members
  for delete to authenticated using (has_event_role(event_id, array['organizer']));

-- teams: visible to event members (join lists); created via RPC; renamed by organizer.
create policy teams_select on public.teams
  for select to authenticated using (is_event_member(event_id) or is_super_admin());
create policy teams_update on public.teams
  for update to authenticated using (has_event_role(event_id, array['organizer']));
create policy teams_delete on public.teams
  for delete to authenticated using (has_event_role(event_id, array['organizer']));

-- participants: staff see everyone; participants see themselves + teammates.
create policy participants_select on public.participants
  for select to authenticated using (
    user_id = auth.uid()
    or has_event_role(event_id, array['organizer', 'activity_admin', 'volunteer'])
    or (team_id is not null and team_id in (select current_user_team_ids()))
  );
create policy participants_update_own on public.participants
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy participants_delete on public.participants
  for delete to authenticated using (has_event_role(event_id, array['organizer']));

-- accounts: staff, owners, and (for public-leaderboard events) everyone can read.
-- NO direct writes for anyone — balances change only via _apply_transaction.
create policy accounts_select_staff on public.accounts
  for select to authenticated using (
    has_event_role(event_id, array['organizer', 'activity_admin', 'volunteer'])
  );
create policy accounts_select_own on public.accounts
  for select to authenticated using (
    (owner_type = 'participant' and exists (
      select 1 from participants p where p.id = owner_id and p.user_id = auth.uid()))
    or (owner_type = 'team' and owner_id in (select current_user_team_ids()))
  );
create policy accounts_select_public on public.accounts
  for select to anon, authenticated using (
    exists (select 1 from events e where e.id = event_id and e.public_leaderboard = true)
  );

-- activities: members see them; organizers manage them.
create policy activities_select on public.activities
  for select to authenticated using (is_event_member(event_id) or is_super_admin());
create policy activities_insert on public.activities
  for insert to authenticated with check (has_event_role(event_id, array['organizer']));
create policy activities_update on public.activities
  for update to authenticated using (has_event_role(event_id, array['organizer']));
create policy activities_delete on public.activities
  for delete to authenticated using (has_event_role(event_id, array['organizer']));

-- transactions: staff see the event ledger; owners see their own account's rows.
-- NO direct writes — rows are inserted only by _apply_transaction.
create policy transactions_select_staff on public.transactions
  for select to authenticated using (
    has_event_role(event_id, array['organizer', 'activity_admin', 'volunteer'])
  );
create policy transactions_select_own on public.transactions
  for select to authenticated using (
    exists (
      select 1 from accounts a
      where a.id = account_id
        and ((a.owner_type = 'participant' and exists (
                select 1 from participants p where p.id = a.owner_id and p.user_id = auth.uid()))
             or (a.owner_type = 'team' and a.owner_id in (select current_user_team_ids())))
    )
  );

-- announcements: members read; organizers write.
create policy announcements_select on public.announcements
  for select to authenticated using (is_event_member(event_id) or is_super_admin());
create policy announcements_insert on public.announcements
  for insert to authenticated with check (has_event_role(event_id, array['organizer']));
create policy announcements_update on public.announcements
  for update to authenticated using (has_event_role(event_id, array['organizer']));
create policy announcements_delete on public.announcements
  for delete to authenticated using (has_event_role(event_id, array['organizer']));

-- ============================================================================
-- STORAGE: event media bucket (logos, banners, currency images)
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('event-media', 'event-media', true)
on conflict (id) do nothing;

create policy "event media read" on storage.objects
  for select using (bucket_id = 'event-media');
create policy "event media upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'event-media' and owner = auth.uid());
create policy "event media update" on storage.objects
  for update to authenticated using (bucket_id = 'event-media' and owner = auth.uid());
create policy "event media delete" on storage.objects
  for delete to authenticated using (bucket_id = 'event-media' and owner = auth.uid());

-- ============================================================================
-- REALTIME
-- ============================================================================

alter publication supabase_realtime add table public.accounts;
alter publication supabase_realtime add table public.transactions;
alter publication supabase_realtime add table public.announcements;

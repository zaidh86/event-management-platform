-- This project is missing Supabase's usual baseline table grants on the public
-- schema, so every PostgREST/Realtime request is denied at the table-grant gate
-- before RLS is consulted, and the game-api Edge Function's service-role lookup
-- of `activities` fails. Restore access with least-privilege grants that mirror
-- the RLS policy surface exactly (RLS remains the row-level enforcement layer).

-- anon: read-only, and only where an anon policy exists (public leaderboard).
grant select on public.events, public.accounts to anon;

-- authenticated: read everything (row visibility gated by RLS SELECT policies)...
grant select on public.profiles, public.events, public.event_members, public.teams,
                public.participants, public.accounts, public.activities,
                public.transactions, public.announcements to authenticated;

-- ...and write only where an RLS write policy exists. accounts and transactions
-- get NO write grants for client roles: balances move only via the
-- process_transaction / game_api_submit RPCs (SECURITY DEFINER).
grant update on public.profiles to authenticated;
grant insert, update, delete on public.events to authenticated;
grant insert, update, delete on public.event_members to authenticated;
grant update, delete on public.teams to authenticated;          -- insert via create_team RPC
grant update, delete on public.participants to authenticated;   -- insert via register_for_event RPC
grant insert, update, delete on public.activities to authenticated;
grant insert, update, delete on public.announcements to authenticated;

-- service_role: server-side only (Edge Function); never shipped to clients.
grant select, insert, update, delete on all tables in schema public to service_role;

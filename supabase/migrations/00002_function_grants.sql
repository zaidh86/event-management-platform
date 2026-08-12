-- 00001_init revoked EXECUTE from `public` on the RPC entry points, which also
-- removed the implicit PUBLIC grant — leaving them executable by postgres only.
-- Restore the intended callers. The security model is unchanged:
--   * anon gets nothing (except get_leaderboard, granted in 00001)
--   * _apply_transaction stays owner-only — it is reached exclusively through
--     the SECURITY DEFINER entry points below, which do their own checks.

-- Frontend entry points (called via supabase.rpc as the authenticated role;
-- each function enforces auth.uid() / event-role permissions itself).
grant execute on function public.process_transaction(uuid, numeric, text, uuid, text, jsonb) to authenticated;
grant execute on function public.register_for_event(uuid, text, jsonb) to authenticated;
grant execute on function public.create_team(uuid, text) to authenticated;
grant execute on function public.join_team(uuid) to authenticated;
grant execute on function public.resolve_qr(text) to authenticated;

-- game-api Edge Function entry points (called with the service role key,
-- never exposed to clients).
grant execute on function public.resolve_qr(text) to service_role;
grant execute on function public.game_api_submit(uuid, text, numeric, text, jsonb) to service_role;

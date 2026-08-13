# Runbook: assign the Platform Owner (one-time)

Run in the Supabase SQL editor. **Requires migrations 00007 AND 00008 applied** —
the 00007 trigger alone rejects this grant (guard-ordering bug, fixed by
`00008_fix_owner_grant_context.sql`; see the amendment in ADR-0002).

The grant works only in an administrative SQL context: no end-user JWT
(`auth.uid()` is null) and not a `service_role`/`anon` request. The SQL editor
qualifies; application clients and the service key never do.

```sql
update profiles set role = 'platform_owner' where email = '<owner-email>';
```

Verify (both must pass):

```sql
-- exactly 1 row:
select email, role from profiles where role = 'platform_owner';

-- must FAIL with "The platform owner cannot be demoted or removed":
update profiles set role = 'user' where role = 'platform_owner';
```

Notes:
- The partial unique index `profiles_single_owner_idx` guarantees at most one owner;
  attempting to grant a second owner fails with a unique violation.
- Application clients (any request with a signed-in user) can never grant or remove
  ownership; the trigger rejects both regardless of the caller's role.
- The service-role key bypasses RLS but NOT this trigger: it cannot grant ownership
  (excluded from the admin context) nor demote/delete the owner.
- Ownership is permanent by design — even this SQL context cannot demote the owner.
  **Deliberate ownership transfer (break-glass):** in the SQL editor,
  `alter table public.profiles disable trigger on_profile_updated;` → demote the
  old owner and grant the new one → `alter table public.profiles enable trigger
  on_profile_updated;` — then re-run the verification queries above.

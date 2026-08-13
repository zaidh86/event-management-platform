# Runbook: assign the Platform Owner (one-time)

Run in the Supabase SQL editor (auth.uid() is null there — the protection trigger
allows the grant only in this context). Requires migration 00007 applied.

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
- The service-role key bypasses RLS but NOT this trigger; demotion/deletion of the
  owner row is blocked even for service-role callers. Keep the service key secret.

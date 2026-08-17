# BES — Build & Engineering Standards

**HOW we build EMP.** (See [EMP.md](./EMP.md) for WHAT.)

## Stack

- **Frontend:** Vite + React 19 + TypeScript (strict), react-router-dom, plain CSS
  (design tokens in `src/index.css`, no UI framework).
- **Backend:** Supabase — PostgreSQL, Auth, Realtime, Storage, Edge Functions.
- **Deploy:** Vercel (SPA rewrite in `vercel.json`); Supabase hosted project.
- **Libraries kept minimal:** `@supabase/supabase-js`, `qrcode.react` (QR
  render), `html5-qrcode` (camera scan). Add nothing without a reason.

## Project layout

```
supabase/
  migrations/           numbered SQL migrations — the schema source of truth
  functions/game-api/   Edge Function: external game integration API
src/
  lib/                  supabase client, types, helpers (pure, no React)
  contexts/             AuthContext (session + profile + event roles)
  components/           shared UI (guards, layout, QR, etc.)
  pages/                route components, grouped by area
    auth/  clubs/  events/  public/
docs/                   product definition, ADRs, runbooks, integration guide (committed)
claude/                 working docs (EMP.md, BES.md) — committed (not gitignored)
```

## Non-negotiable rules

1. **Never hardcode an event.** Anything Cyber Casino needs is a *configuration*
   feature (currency name/image, branding, rules JSON…).
2. **Balances are ledger-derived.** Only the `process_transaction` SQL RPC may
   change `accounts.balance` or insert `transactions`. RLS blocks direct writes
   for everyone; the RPC is SECURITY DEFINER and does its own permission checks.
3. **External games get an API, not a database.** Edge Function + hashed
   per-activity API keys. No service-role key ever leaves the server side.
4. **RLS on every table.** Client uses only the anon key. Policies follow the
   role model in EMP.md; helper SQL functions (`is_event_role`, `is_super_admin`)
   keep policies readable and are STABLE for performance.
5. **Keep the app runnable at all times.** Missing `.env` shows a friendly
   setup screen, never a white screen. `npm run build` must pass before a task
   is called done.

## Database conventions

- Migrations are append-only, numbered `0000N_name.sql`; never edit an applied one.
- `uuid` PKs via `gen_random_uuid()`; `timestamptz` `created_at default now()`.
- `numeric` for balances/amounts (not float).
- JSONB for open-ended config (`events.registration_fields`, `activities.config`,
  `transactions.metadata`) — validated in app code and in RPCs where it matters.
- Indexes for every hot path: leaderboard `(event_id, balance desc)`,
  transactions `(event_id, created_at desc)`, `(account_id, created_at desc)`,
  qr token unique indexes, membership `(user_id, event_id)`.
- QR tokens: random opaque strings (`p_`/`t_` prefix + 24 hex chars from
  `gen_random_bytes`), NOT ids — unguessable, revocable.

## Realtime

Use `postgres_changes` subscriptions, filtered by `event_id`, for: accounts
(leaderboard/balance), announcements, transactions (own account). One channel
per concern per page; always `removeChannel` on unmount. Public leaderboard
works without auth (view + policy allow anon read when `events.public_leaderboard`).

## Frontend conventions

- TypeScript strict; shared domain types in `src/lib/types.ts` mirror DB rows.
- Data access via small typed helpers in `src/lib/api.ts` — pages don't build
  queries inline.
- Route guards: `RequireAuth`, `RequireEventRole(roles)`; redirect to login,
  preserve `from`.
- Errors: every mutation surfaces failure to the user (inline message); no
  silent catch.
- Currency display always uses the event's configured name/image via the
  `useCurrency`/`fmtPoints` helpers (singular/plural aware).

## Security checklist (each feature)

- [ ] RLS policy covers the new table/columns
- [ ] Mutations go through RPC when they touch balances
- [ ] No secrets in client bundle (only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- [ ] Role checked server-side (RLS/RPC), client checks are UX only

## Testing / verification

- `npm run build` (tsc + vite) and `npm run lint` clean before finishing a task.
- SQL migrations must run cleanly on a fresh database via
  `supabase db reset` (or applied in order via the SQL editor).
- Manual smoke path: register → org creates event → participant registers →
  volunteer scans → points move → leaderboard updates live.

## Environment

`.env` (gitignored), from `.env.example`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Edge Function secrets (Supabase dashboard): none beyond built-ins — the
service role key is injected automatically as `SUPABASE_SERVICE_ROLE_KEY`.

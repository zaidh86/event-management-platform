# EMP — Event Management Platform

A generic, reusable platform for running club events with configurable points
currency, activities, QR scanning, secure transactions and live leaderboards.
Built with React + Vite + TypeScript on Supabase (Auth, Postgres, Realtime,
Storage, Edge Functions). Deploys to Vercel.

> Cyber Casino is just the *first event* configured on this platform — nothing
> event-specific is hardcoded.

## Quick start

1. **Create a Supabase project** (free tier is fine).
2. In the SQL editor, run [`supabase/migrations/00001_init.sql`](supabase/migrations/00001_init.sql)
   (or `supabase db push` with the CLI).
3. Copy `.env.example` → `.env` and fill `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from Settings → API.
4. ```bash
   npm install
   npm run dev
   ```
5. Sign up — **the first account automatically becomes Super Admin.**
6. Create an event, configure it in Settings (currency, teams, branding,
   registration fields), then set its status to **Active**.

For external game integrations, deploy the Edge Function:

```bash
supabase functions deploy game-api --no-verify-jwt
```

## Roles

| Role | How it's granted |
|---|---|
| Super Admin | first signup (then promoted by existing super admins) |
| Event Organizer | creates an event, or added via Members tab |
| Activity/Game Admin | added via Members tab |
| Volunteer | added via Members tab |
| Participant | self-registers on an active event |

## Key properties

- **Ledger-based points** — balances only change via the `process_transaction`
  SQL function (row-locked, min-balance enforced, full audit trail).
- **RLS everywhere** — the browser only ever holds the anon key.
- **External games** integrate through the `game-api` Edge Function with a
  per-activity API key; they never touch the database. See
  [docs/GAME_INTEGRATION.md](docs/GAME_INTEGRATION.md).
- **Realtime** — leaderboard, balances and announcements update live.

## Scripts

- `npm run dev` — dev server
- `npm run build` — typecheck + production build
- `npm run lint` — oxlint

## Deploy (Vercel)

Import the repo, framework preset **Vite**, add the two `VITE_*` env vars.
`vercel.json` already contains the SPA rewrite.

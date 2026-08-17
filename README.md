# EMP — Event Management Platform

An Event Management Platform where clubs and organizations create and manage
their clubs, configure their club environment, and run configurable events
within them. Every event shares a general configuration layer — registration,
participation format, branding, activities — with event-specific capabilities
(gamified scoring, live leaderboards, QR operations, external game
integrations, and more) enabled per event on top of that foundation.

Built with React + Vite + TypeScript on Supabase (Auth, Postgres + RLS,
Realtime, Storage, Edge Functions). Deploys to Vercel.

```
Platform
  └── Clubs / Organizations        club profile · members · club admins
        └── Events                 belong to exactly one club
              ├── General configuration   name · registration · format · branding
              └── Capabilities            points/leaderboard · QR · teams · games · …
```

> Nothing event-specific is hardcoded: a casino night, a hackathon, and a
> workshop are the same engine with different capabilities enabled.

## Quick start

1. **Create a Supabase project** (free tier is fine).
2. In the SQL editor, run the migrations in
   [`supabase/migrations/`](supabase/migrations/) **in numeric order**
   (or `supabase db push` with the CLI).
3. Copy `.env.example` → `.env` and fill `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from Settings → API.
4. ```bash
   npm install
   npm run dev
   ```
5. Sign up — **the first account automatically becomes Super Admin.**
6. Assign the Platform Owner once, via
   [`docs/runbooks/assign-platform-owner.md`](docs/runbooks/assign-platform-owner.md).
7. Create a club, add club admins in its Members tab, then create events
   inside the club — general configuration first, capabilities on top.

For external game integrations, deploy the Edge Function:

```bash
supabase functions deploy game-api --no-verify-jwt
```

## Roles

| Role | Scope | How it's granted |
|---|---|---|
| Platform Owner | platform | one-time SQL runbook; protected at the database layer (cannot be demoted or removed) |
| Super Admin | platform | first signup; then promoted by existing super admins |
| Club Admin | one club | promoted in the club's Members tab (`club_members.role`) |
| Club Member | one club | added in the club's Members tab |
| Event Organizer | one event | creates an event, or added via the event's Members tab |
| Activity/Game Admin, Volunteer | one event | added via the event's Members tab |
| Participant | one event | self-registers on an active event |

The Platform Owner inherits Super Admin everywhere, and platform admins hold
club-admin authority in every club without needing membership rows — enforced
in SQL (`is_super_admin()`, `is_club_admin()`), not just in the UI. Normal
role and membership administration happens **through the website**; the SQL
editor is only for the owner bootstrap, migrations, and break-glass recovery.

## Key properties

- **Clubs are the container** — events belong to clubs; club admins manage
  only their own club (RLS-enforced isolation).
- **Capability-based events** — `events.capabilities` gates features per
  event; legacy defaults keep older events behaving identically.
- **Ledger-based points** — balances only change via the `process_transaction`
  SQL function (row-locked, min-balance enforced, full audit trail).
- **RLS everywhere** — the browser only ever holds the anon key; table grants
  and policies ship together for every table.
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

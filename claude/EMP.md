# EMP — Event Management Platform

**WHAT we are building.** (See [BES.md](./BES.md) for HOW.)

## Vision

A generic, reusable platform for running club events with points, activities,
QR-based interactions, and live leaderboards. **Cyber Casino is only the first
event** that will run on it — nothing about any specific event may be hardcoded.

```
EVENT MANAGEMENT PLATFORM
        │
        ▼
    CREATE EVENT
        │
   ┌────┴────┐
   ▼         ▼
CONFIGURE   BUILD /
ACTIVITY    INTEGRATE
   │         │
   └────┬────┘
        ▼
   EVENT ENGINE
        │
   ┌────┼────┐
   ▼    ▼    ▼
  QR  POINTS  LEADERBOARD
        │
        ▼
    TRANSACTIONS
        │
        ▼
     ANALYTICS
```

## Two ways to add activities

1. **Configured activity** — created inside EMP by an organizer. Rules, rewards,
   deductions, entry fee, time limit etc. live in a JSON config. Volunteers /
   activity admins record results manually via QR scan + award/deduct.
2. **Integrated activity** — a club member builds a real external game/project.
   It talks to EMP only through the **Game Integration API** (Supabase Edge
   Function) using a per-activity API key. External games must NOT touch the
   database or balances directly. **EMP is the single source of truth** for
   participants, points, transactions and the leaderboard.

## Roles (RBAC)

| Role | Scope | Powers |
|---|---|---|
| Super Admin | global | everything, manage all events & users |
| Event Organizer | per event | configure event, activities, members, announcements, adjust balances |
| Activity/Game Admin | per event (per activity) | run activities, award/deduct points |
| Volunteer | per event | scan QR, submit results, view participant info |
| Participant | per event | register, view own balance/transactions, team, leaderboard |

Global role lives on `profiles.role` (`super_admin` | `user`). Event-scoped
roles live in `event_members`. A user can hold different roles in different
events. Participants are rows in `participants` (registration), and get an
`event_members` row with role `participant`.

## Core MVP feature checklist

- [x] Email/password auth (Supabase Auth), secure sessions
- [x] RBAC: super admin, organizer, activity admin, volunteer, participant
- [x] Event creation & configuration (status: draft → active → ended → archived)
- [x] Individual AND team events; configurable min/max team size
- [x] Participant registration with **configurable registration fields** (JSON schema on event)
- [x] Team management: create/join teams, unique team QR codes
- [x] Configurable currency: name (singular/plural), custom image (Supabase Storage) with replaceable default, starting balance, minimum balance, optional negative balance
- [x] Configurable activities (entry fee, reward, deduction, time limit, custom rules JSON)
- [x] External game integration (Edge Function `game-api`, per-activity API keys)
- [x] Secure transaction system: append-only ledger, atomic balance updates via SQL RPC with row locking, full audit trail
- [x] QR: unique QR token per participant AND per team; volunteer scanning (camera via html5-qrcode)
- [x] Dashboards: participant, volunteer, organizer/admin
- [x] Live leaderboard (Supabase Realtime), optional public (no-auth) leaderboard page
- [x] Event branding: name, logo, banner, theme color; images in Supabase Storage
- [x] Announcements, delivered realtime
- [x] Vercel deployment (SPA)

## Domain model (summary)

- `profiles` — 1:1 with `auth.users`; global role.
- `events` — all configuration: team settings, currency, registration field
  definitions, branding, leaderboard visibility.
- `event_members` — (event_id, user_id, role) event-scoped roles.
- `participants` — registration row; `registration_data` jsonb; unique `qr_token`.
- `teams` — team events; unique `qr_token`; members via `participants.team_id`.
- `accounts` — balance holder; `owner_type` = 'participant' | 'team'.
  Individual events: one account per participant. Team events: one per team.
- `activities` — both kinds; `kind` = 'configured' | 'integrated';
  `config` jsonb (entry_fee, reward, deduction, time_limit_seconds, rules…);
  integrated ones store `api_key_hash` (never the plaintext key).
- `transactions` — append-only ledger; every balance change goes through the
  `process_transaction` RPC; carries actor, activity, type, amount, metadata.
- `announcements` — per event, realtime broadcast.

## Points flow (invariant)

**All** balance changes go through the SQL function `process_transaction`
(SECURITY DEFINER): permission check → `SELECT … FOR UPDATE` on account →
min-balance check → insert transaction → update balance. No client, page, or
external game ever writes `accounts.balance` or `transactions` directly.
The Game Integration API's `submit-result` calls the same function.

## Game Integration API (contract for club members)

Base: `https://<project>.supabase.co/functions/v1/game-api`
Auth header: `x-api-key: <activity API key>` (shown once at creation; only a
SHA-256 hash is stored).

| Endpoint | Method | Purpose |
|---|---|---|
| `/resolve?qr=<token>` | GET | Resolve a participant/team QR token → id, display name, balance |
| `/submit-result` | POST | `{ qr_token, amount, description?, metadata? }` → transaction via ledger (amount may be negative; entry fee/limits enforced server-side) |
| `/leaderboard` | GET | Current standings for the activity's event |

The API key is scoped to one activity in one event. EMP enforces min balance,
event status (must be `active`), and writes the audit trail.

## Scalability target

200 concurrent users minimum, ~600 target (participants + volunteers +
organizers + leaderboard viewers). Handled by: indexed queries, single-RPC
transaction path (one round trip, row-level lock only on the affected account),
Supabase Realtime (postgres_changes) instead of polling, and a leaderboard view
backed by `accounts(event_id, balance desc)` index. Do NOT over-engineer for
millions of users.

## Build ownership

- EMP itself, one reference game, and the first integration: built here.
- Other club members build their own games later against the Game Integration API.

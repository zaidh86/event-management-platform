# EMP Game Integration Guide

Build your own game and connect it to an EMP event. Your game keeps its own
gameplay logic and UI; EMP stays the **source of truth** for participants,
points, transactions and the leaderboard. Your game never talks to the
database — only to the Game Integration API.

## Getting access

1. An event organizer creates an **Integrated activity** for your game in the
   EMP Activities tab.
2. They send you the **API key** (shown once, e.g. `emp_ab12…`). Treat it like
   a password: keep it server-side in your game, never in public client code.

## API

Base URL:

```
https://<project-ref>.supabase.co/functions/v1/game-api
```

Every request needs the header:

```
x-api-key: <your activity API key>
```

The key is scoped to **one activity in one event**. All amounts are in the
event's configured currency.

### 1. Resolve a player's QR code

Participants (and teams) each have a QR code in their EMP dashboard. Scan it in
your game (or let them type it) and resolve it:

```
GET /resolve?qr=p_1a2b3c...
```

```json
{
  "activity": { "id": "…", "name": "Blackjack", "config": { "entry_fee": 10 } },
  "kind": "participant",
  "event_id": "…",
  "name": "Ada",
  "account_id": "…",
  "balance": 120
}
```

For team events you get `"kind": "team"` and the team's shared balance.

### 2. Submit a result (award or deduct points)

```
POST /submit-result
Content-Type: application/json

{
  "qr_token": "p_1a2b3c...",
  "amount": 50,
  "description": "Blackjack round win",
  "metadata": { "round": 3, "hand": "20 vs 19" }
}
```

- `amount` — positive to award, **negative to deduct** (e.g. entry fee, loss).
- The response contains the recorded transaction. EMP enforces the event's
  minimum-balance rule; a deduction below the minimum returns HTTP 422 with an
  error message — handle it (e.g. refuse to start a round the player can't afford).
- Every call is written to the audit ledger, attributed to your game.

### 3. Event leaderboard

```
GET /leaderboard
```

Returns current standings for your activity's event (rank, name, balance).

## Rules

- Charge entry fees and pay rewards according to the activity config the
  organizer set with you (`config` is returned by `/resolve`).
- Never store or share the API key in client-side/public code. If it leaks,
  ask the organizer to rotate it (old key stops working immediately).
- Don't spam: one `submit-result` per game outcome, not per frame.
- HTTP status codes: `401` bad/missing key · `400` malformed request ·
  `403` QR from another event · `422` rejected by the ledger (e.g. balance) ·
  `404` unknown QR/route.

## Minimal example (Node)

```js
const BASE = 'https://<project-ref>.supabase.co/functions/v1/game-api'
const KEY = process.env.EMP_API_KEY

async function awardPoints(qrToken, amount, description) {
  const res = await fetch(`${BASE}/submit-result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify({ qr_token: qrToken, amount, description }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error)
  return body.transaction
}
```

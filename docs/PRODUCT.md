# EMP — Product Definition (Phase 0)

**Status:** Approved vision, Phase 0 documentation · 2026-08-13
**Companion docs:** `docs/adr/0001…0006`, EMP Platform Roadmap (artifact 🧭), EMP Identity Proposals (artifact 🎨)

## Vision

EMP is a **college event operating system**. Instead of every club building a one-off site per event,
any club in a college runs its events on EMP: registration, teams, operations (QR, check-in,
stations), live scoring, submissions and judging, results, feedback, certificates, and analytics —
with each event enabling only the capabilities it needs.

## Hierarchy

```
EMP (platform)
└── Clubs                 e.g. CS Club, Data Science Club, Literary Club, Cultural Club
    └── Club Events       hackathon, coding contest, quiz, essay competition, workshop, casino night…
        └── Activities & Operations   stations, games, submissions, judging, check-in
            └── Participants (individuals or teams)
                └── Analytics / results / certificates
```

## Terminology (frozen)

| Term | Meaning | DB reality |
|---|---|---|
| **Platform Owner** | The single protected creator/root of the platform | `profiles.role = 'platform_owner'` (exactly one) |
| **Super Admin** | Platform administrator | `profiles.role = 'super_admin'` (existing) |
| **Club** | An organization that runs events | `clubs` (new) |
| **Club Admin** | Manager of one club | `club_members.role = 'club_admin'` (new) |
| **Event** | A club-owned event | `events` + `events.club_id` (existing + new column) |
| **Event Manager** | Manager of one event — **the existing `organizer` role, never renamed** | `event_members.role = 'organizer'` |
| **Volunteer / Activity Admin / Participant** | Existing event-level roles, unchanged | `event_members.role`, `participants` |
| **Capability** | A feature module an event can enable | `events.capabilities` jsonb (new) |
| **Preset** | A named capability bundle offered at event creation (Hackathon, Workshop…) | Frontend template only |

## Personas & primary jobs

- **Platform Owner / Super Admin** — platform health, clubs directory, user administration (admin UI deferred; no API surface yet).
- **Club Admin** — club profile, creating events, assigning event managers, club analytics.
- **Event Manager** — configuring the event (capabilities, branding, registration), running it, projector mode.
- **Volunteer** — scan/check-in stations; fast, phone-first operations.
- **Participant** — register, participate, see own progress/results; phone-first.

## Capability catalog (target)

Basic (always on): name, description, branding, schedule/venue, organizing club, registration settings.
Configurable: individual/team participation · registration approval · attendance/check-in · points +
leaderboard + realtime · QR operations · submissions · judging + rubrics · deadlines/results ·
announcements · feedback · certificates · analytics · games API.

Preset examples: **Casino night** = teams+points+leaderboard+QR+realtime+games · **Hackathon** =
teams+submissions+judging+deadlines+results · **Literary competition** =
individual+submissions+judging+rubrics+certificates · **Workshop** =
registration+attendance+feedback+certificates.

Legacy compatibility rule: existing events receive the full game-style capability set by default and
behave identically after every migration.

## Non-goals (this cycle)

Invite links / join codes · email or push notifications (in-app only for now; ADR deferred to
Phase 3) · payment/ticketing · multi-college tenancy · native mobile apps.

## Identity

Platform chrome is professional and neutral; each event keeps its own theme (`events.theme_color`,
banners, currency imagery) constrained to fills/borders/badges — never body text. Platform identity
candidates and recommendation: `docs/adr/0006-visual-identity.md`.

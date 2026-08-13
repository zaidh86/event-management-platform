# ADR-0006: Platform visual identity — Emerald Command (composed)

**Status:** Accepted · 2026-08-13 · closes Phase 0
**Specimens:** EMP Identity Proposals artifact (🎨), round 2

## Context

The violet accent read as generic-AI and is retired. EMP lives in a college ecosystem whose identity
is green and white; the platform must echo that without copying institutional branding, and without
reading as a college portal, Supabase, a gaming platform, an AI dashboard, or a generic green SaaS
template. Round-2 candidates: D Emerald Command, E Forest+Gold, F Premium Green+White.

## Decision

**D — Emerald Command is the official EMP identity**, composed with the strongest aspects of E and F:

- **D (core):** deep emerald over green-tinted neutrals; single interactive accent; brand and
  liveness share the green — the ●-pulse motif is what says "live," and it stays.
- **F (composition rule):** authentication and participant-facing screens are **white-first** —
  more whitespace, lighter chrome, minimal borders. Operational/admin screens use the fuller
  structure.
- **E (composition rule):** **gold is the achievement color only** — rank #1, certificates, major
  celebratory moments. Gold is never interactive.

### Token values (drop into `src/index.css` as a value swap — Phase 2, first task)

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--bg` | `#f9fbfa` | `#101512` | white-first light ground; green-black dark |
| `--surface` / `--surface-2` | `#ffffff` / `#eef2f0` | `#171d19` / `#1e2620` | |
| `--border` | `#dde4e0` | `#2a352e` | green-grey, never pure grey |
| `--text` / `--text-muted` | `#17201b` / `#5b6862` | `#e7ede9` / `#9aa69f` | muted ≥ 4.5:1 both |
| `--accent` (fills) | `#0c7a50` (white text, 5.4:1) | `#4cc38a` (text `#04170e`) | dark mode: bright fill + deep text, no white-on-bright traps |
| `--accent-hover` | `#095c3c` | `#5fd39c` | |
| `--accent-text` (links, focus, active) | `#0c7a50` (5.0:1) | `#4cc38a` (8.5:1) | |
| `--live` | `= accent` + pulse motif | `= accent` + pulse | live is **always** dot/pulse + label, never color alone |
| `--pos` / `--neg` | `#0f7b53` / `#b91c1c` | `#34d399` / `#f87171` | success is static + icon (CircleCheck); that's what separates it from live |
| `--warn` | `#b45309` | `#fbbf24` | |
| `--gold` (achievement) | `#8a6117` | `#d9a33c` | rank #1, certificates, celebration — only |
| `--theme` (per-event) | organizer-set | organizer-set | containment unchanged: fills/borders/badges, never body text |

### Accent budget (binding)

1. **Emerald** marks interactive + brand + live: primary buttons, links, focus rings, active nav,
   pulse dots. Never decorative washes, never content backgrounds, never body text.
2. **Gold** appears at most once per screen in chrome (rank #1 digit, certificate seal,
   celebration moment).
3. **Semantic colors are separate and single-purpose:** live (pulse+green), success (icon+green),
   warning (amber), error (red), achievement (gold). Color is never the only indicator.
4. **White-first surfaces** for auth + participant screens; structural density reserved for ops.

### Anti-lookalike differentiators (why this isn't Supabase/portal/template)

Deeper text-safe emerald vs. mint-on-black; green-*tinted* grounds instead of neutral black; light
mode as a first-class white-first identity; humanist weight-led type (no mono-accent styling); the
pulse-dot signature; zero gradients; gold reserved for achievement, not decoration.

## Consequences

- Phase 2's first task is the token swap + button/link/focus audit in both themes (WCAG ≥ 4.5:1
  text roles, verified in the browser suite).
- The projector and public leaderboard inherit the identity automatically via tokens; event themes
  keep their containment rule.
- Round-1 exploration (amber/teal/mono) is recorded in the artifact history; the amber "signal
  lamp" idea survives as the pulse-dot motif, transposed to emerald.

**Phase 0 is closed with this acceptance.**

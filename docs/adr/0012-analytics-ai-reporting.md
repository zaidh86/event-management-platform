# ADR-0012: Analytics, AI Assistance, Reporting & Certificates

**Status:** Accepted (Phase 6) · **Migration:** `00017_analytics_reporting.sql`

## Decisions

### 1. Analytics reads existing data — no new tables, no invented metrics

The Analytics surface aggregates what the platform already records under
existing staff RLS: participants, teams, attendance, the scans ledger, the
transactions ledger, feedback/reflection responses, submissions and judging
results. Every number is computed from real rows; when a capability is off or
data is missing, the UI says "not enough data" rather than fabricating.

### 2. DATA vs AI INTERPRETATION are strictly separated

`src/lib/insights.ts` is a **deterministic, rule-based analysis engine**: it
turns the aggregates into narrative findings and data-backed recommendations
(low attendance rate, task drop-off, judging incomplete, feedback response
rate, …). Its output is labeled "Computed from event data" — it is not an LLM
and is never presented as one.

LLM assistance is an **Edge Function concern**:
`supabase/functions/event-assistant/` (scaffold in-repo) authenticates the
caller, verifies event-manage rights, fetches a **controlled aggregate
snapshot** (counts and summaries only — never raw participant rows, emails or
judge notes), and only then consults the Anthropic API. The AI never has
database access; it sees exactly the snapshot. Deploying it requires
`supabase functions deploy event-assistant` + an `ANTHROPIC_API_KEY` secret —
tracked in the QA backlog as a deployment item. The in-app assistant panel
calls the function when deployed and otherwise answers from the loaded
aggregates with an explicit "data lookup (no AI)" label.

### 3. Reflections reuse the feedback engine

`feedback_forms.kind = 'feedback' | 'reflection'`. Builder, publish lifecycle,
public/participant access, response storage, dedupe and RLS are all inherited;
the UI labels reflections distinctly. Response summaries (counts, rating
averages, choice distributions) come from the same deterministic engine and
are labeled as computed; authorship labels (participant-written vs
AI-assisted) follow from kind + source labeling in the report.

### 4. Reports are print-native

The event report (`/events/:id/report`) is a manager-gated, print-optimized
page covering overview, registration/participation, attendance, scoring +
leaderboard, tasks, feedback/reflections, submissions + judging, computed
insights and recommendations. "Download PDF" uses the browser print pipeline —
no PDF dependency, no bundle cost, and the print stylesheet is the layout
contract. Role scoping: the route requires event-manage rights; the report
never includes judge identities/notes or participant contact data.

### 5. AI judging: schema-ready, human-first

`judge_evaluations.source='ai'` rows (00016) are displayed distinctly wherever
evaluations appear and are **excluded from human totals** by construction. AI
evaluation *generation* is deliberately not shipped until the Edge Function
path is deployed; comparison UI reads the same rows. AI never replaces human
evaluation — it can only sit beside it.

### 6. Certificates are universal and verifiable

The dormant `certificates` capability becomes real: Event Managers issue
participation/achievement/completion certificates to all registered, all
attended, one participant, or one team (`issue_certificates`, idempotent via
per-holder uniqueness). Each certificate carries an opaque `c_…` verify code;
`/cert/:code` renders a public, print-ready certificate through
`verify_certificate` (anon-safe: event name/branding, holder display name,
kind/title/detail, issue date — nothing else). Holders see their certificates
on their dashboard; managers issue/revoke from the Certificates tab.

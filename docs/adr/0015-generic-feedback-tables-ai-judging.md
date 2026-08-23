# ADR-0015 — Generic feedback, event table allocation, AI-assisted judging

Status: accepted (migration 00022, `ai-service` Edge Function)
Supersedes the per-target feedback part of ADR-0009/00019. Extends ADR-0011
(judging), ADR-0012 (AI reporting), ADR-0014 (respondent segregation).

## Context

Final pre-event pass. Four requirements landed together:

1. Feedback had grown a per-target model (00019: one response per respondent
   per team/participant, scanned-QR binding, an "Open feedback form" station
   action). The event wants the opposite: ONE generic form, ONE QR, repeat
   responses allowed, and context carried by the form's own questions.
2. Participants and teams need a table number in registration order.
3. Judges need to understand criteria at a glance, and AI should assist —
   never replace — human judging, including reading submitted PDFs.
4. Organizers want an AI reading of collected feedback.

## Decision 1 — Feedback is generic (retire per-target dedupe)

`submit_feedback` keeps its 4-argument signature (no `DROP FUNCTION`, no grant
re-issue, no PostgREST overload ambiguity) but **ignores the target arguments
and never deduplicates**: `dedupe_key` is always `gen_random_uuid()`, so the
00014 `(form_id, dedupe_key)` UNIQUE can never fire. `target_type`/`target_id`
stay as columns (historic rows keep their meaning); new rows are `'event'/null`.
`feedback_forms.one_response_per_user` is no longer enforced (default now
`false`; column kept; UI toggle removed).

Client side: the `feedback` action is no longer offered on participant/team
QR operations (`TARGET_ACTIONS` in `lib/qr.ts`); the DB CHECK that still
permits it is left alone (it tolerates legacy rows and is not a security
surface). The feedback-form target keeps owning its own QR, exactly as before,
and that same QR (same token, same `/q/` URL) is now also shown on the
participant dashboard so a participant can hold it up for anyone to scan.

Respondent categorization (00021) is untouched: it is a property of WHO
answered, not of what the answer is about.

## Decision 2 — Table allocation rides the existing registration paths

`events.table_config` (`{enabled, start_number, label}`) plus one table,
`event_tables` — one row per **registration unit**: a solo participant
(`participant_id`) or a team (`team_id`), exactly one set. Allocation happens in
AFTER INSERT triggers on `participants` (solo mode only) and `teams`, so
`register_for_event` / `create_team` are not rewritten and team members inherit
their team's table through `teams.id` — never their own row. Numbering is
serialized per event with a transaction advisory lock; `UNIQUE (event_id,
table_number)` is the backstop. Both owner FKs cascade, so 00021's participant
removal frees the row without knowing tables exist.

`assign_event_tables(event)` lets a manager backfill after enabling the feature
mid-event, in `created_at` order across both unit kinds. RLS: every event
member reads the allocation list (the physical room shows the same
information); managers may delete; writes only through the allocator.

## Decision 3 — Criteria carry separate human guidance and AI instructions

`judging_criteria.description` was, and remains, the human judge's guidance —
it was never an AI field, so it is relabelled ("Guidance for judges"), not
renamed. `ai_instructions` is added for what the AI should look for; empty
falls back to the guidance. Scoring is unchanged and is now explained in the
UI exactly as `get_judging_results` computes it: per criterion, the average of
**finalized human** scores across judges, × weight, summed.

## Decision 4 — AI is a suggestion row, never a result

The AI writes the entry's single `source='ai'` `judge_evaluations` row (slot
reserved since 00016) with validated `scores` and structured `details`
(summary, strengths, weaknesses, per-criterion reasoning + evidence, model,
generated_at). `get_judging_results` already filters `source='human'`, so AI
can never reach a total. A new permissive policy lets judges of the event
read AI rows (they have `judge_id = null` and were otherwise invisible to
judges). Judges see the suggestion beside their own score input, may copy it
into empty fields, and save through `save_evaluation` as before.

## Decision 5 — One AI service, one provider adapter, server-side only

`supabase/functions/_shared/ai.ts` exposes `analyzeSubmission()` and
`analyzeFeedback()` over one adapter with two wire formats (Gemini native;
OpenAI-compatible chat completions with `file` / `document_url` / no PDF part).
`supabase/functions/ai-service` authenticates the caller with their JWT,
authorizes through RLS/`can_manage_event` with the caller's client, then does
the narrow service-role work. Every output is schema-validated: criterion ids
must exist and be enabled, scores numeric within `[0, max]`, text bounded.
Failures map to clear HTTP statuses and the UI message "AI analysis is
temporarily unavailable. You can continue with manual judging."

Feedback analysis sends **answers only** — never respondent ids, categories,
timestamps or emails — and stores nothing.

### Provider chain (re-verified 2026-08-23, 3-provider pass)

Ordered chain, configured only through Edge Function secrets
(`supabase/functions/.env.example`); a request runs on the first provider and
advances ONLY on a recoverable provider failure (HTTP 429, 5xx, timeout,
network). Auth errors (401/403), other 4xx, unusable model output and EMP-side
input errors never cascade — a fallback must not hide a bug.

| Tier | Provider / model | Wire format | PDF |
|---|---|---|---|
| primary | Google Gemini `gemini-3.7-flash` | native `generateContent`, `x-goog-api-key`, `responseMimeType` + `responseJsonSchema` | `inlineData` (native, reads figures/tables) |
| fallback 1 | Mistral `mistral-medium-3-5` | OpenAI-compatible `/chat/completions`, `response_format: json_schema` | `document_url` data URL (Document QnA, built-in OCR) |
| fallback 2 | OpenRouter `z-ai/glm-5.2:free` | OpenAI-compatible, `response_format: json_schema`, `provider.require_parameters` | `file` part + `plugins:[file-parser/cloudflare-ai]` — the FREE parser, pinned so the billed `mistral-ocr` default is never used; text-only extraction |

Earlier picks (`gemini-2.5-flash`, `mistral-small-latest`, `openai/gpt-oss-120b:free`)
were superseded or removed by the providers. Free-tier numeric limits for
Gemini and Mistral are no longer public (AI Studio / Admin Panel only);
OpenRouter `:free` is 20 RPM and 50 RPD → 1,000 RPD after a one-time $10
purchase. Privacy: Gemini free tier may use inputs for product improvement
(enable billing for the event days to avoid this); Mistral free mode has an
opt-out toggle; OpenRouter free routes depend on the upstream provider.

Schema enforcement is requested from every provider, but EMP validation
(`validateSubmissionAnalysis` / `validateFeedbackAnalysis`) remains the
authority: criteria must exist and be enabled, scores clamp to `[0, max]`,
text is bounded, unknown keys are dropped. Tests: `npm run test:ai`
(`tests/ai/ai-adapter.test.mjs`, mocks only).

## Consequences

- Per-target feedback, team-feedback QRs and the station feedback action are
  gone from the product surface; the schema tolerates their history.
- Table numbers are stable once given; gaps from removals are filled only by an
  explicit manager re-run.
- AI costs one provider call per entry (cached in the AI row; `force` re-runs)
  regardless of judge count.
- `00021` and `00022` are both unapplied on production at the time of writing;
  apply in order. Rollback notes are at the end of each file.

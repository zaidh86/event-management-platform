# ADR-0011: Submissions, Judging & Evaluation

**Status:** Accepted (Phase 5) · **Migration:** `00016_judging_evaluation.sql`

## Context

EMP needed a universal evaluation stack: deliverables (submissions) and
configurable human judging, without hackathon-specific hardcoding and without
inventing parallel role/scoring systems.

## Decisions

1. **Judge is an event role, not a platform role.** `event_members.role`
   gains `'judge'` — assignment/removal is the existing Members surface,
   authorization is the existing `has_event_role()`. A judge in one event is
   nobody in another (event isolation verified). One-role-per-event stands;
   organizers may also evaluate (`save_evaluation` admits judge OR organizer)
   so a manager never needs a second membership row to judge.

2. **One submission per entrant, owner = stored participation mode.**
   `submissions` is owned by exactly one participant (solo) or one team
   (team mode; any teammate edits the shared entry). Ownership derives from
   `participants.participation_mode` (ADR-0007), never from event format.
   Shape: title + description + `content` jsonb answering the event's
   configured submission fields.

3. **Per-event configuration in `events.submission_config`** (jsonb, `{}`
   default, mirroring `leaderboard_config`): `deadline` (server-enforced in
   `save_submission`), `fields` (same field-definition shape as
   registration_fields), `instructions`, `results_visibility`
   (`hidden` default | `participants`).

4. **Lifecycle**: draft → submitted; editing (including a submitted entry)
   stays open until the deadline; a submitted entry never silently reverts to
   draft. Judges see submitted entries only; drafts are private to their
   owners and Event Managers.

5. **Criteria are data** (`judging_criteria`): name, description, max_score,
   weight, required, order, enabled — Event-Manager CRUD via RLS
   (`can_manage_event`). Nothing is hardcoded.

6. **Evaluations are per-judge and preserved** (`judge_evaluations`): one row
   per judge per submission (partial unique), scores as
   `{criterion_id: number}` validated server-side (unknown criterion →
   reject; range 0..max; required criteria enforced at finalization), private
   `notes`, draft/final status. Judges read only their own rows — independent
   judging, no peeking; Event Managers read all.

7. **Deterministic weighted scoring** in `get_judging_results`: per enabled
   criterion, the average of *finalized human* scores across judges;
   `raw_total = Σ avg`, `weighted_total = Σ (avg × weight)`; per-criterion
   breakdown returned as jsonb. No second ledger — judging data never touches
   accounts/transactions. Output excludes judge identities and notes, so the
   configurable participant visibility (`results_visibility='participants'`)
   is privacy-safe by construction.

8. **AI-ready, not AI-implemented**: `source 'human'|'ai'`, nullable
   `judge_id`, one AI row max per submission. Human totals ignore AI rows;
   manual judging is complete without AI (Phase 6 adds comparison).

## UI surfaces

Event tab **Judging** (staff + judges, when the judging capability is on):
managers get criteria CRUD, results table with breakdown, and judge roster
pointers; judges get their queue of submitted entries with per-criterion
scoring, notes, save-draft/finalize. Participants get a **My submission**
dashboard section (deadline-aware, mode-aware). Submissions settings (deadline,
instructions, fields, results visibility) live in Event Settings. Members page
role picker gains Judge.

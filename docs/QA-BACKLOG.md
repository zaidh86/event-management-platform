# EMP QA Backlog

Working rule (build-first mode): discovered issues are recorded here and fixed
in the final QA/hardening pass — not mid-feature. Statuses: OPEN, FIXED,
WONT-FIX, DEFERRED (with explanation). Do not delete items; update them.

Verification vocabulary used below:
- **repo** = implemented in the repository
- **live** = verified against the live Supabase database
- **pglite** = verified by local real-PostgreSQL replay suites
- **browser** = verified in a real (signed-in) browser
- **device** = verified on physical devices

---

## QA-001 — Leaderboard: participant missing in live UI
- Phase: 2.9 · Area: Leaderboard · Severity: High · Status: DEFERRED — repo+pglite paths proven (v17 22/22); the remaining doubt is specifically the signed-in live browser experience, which needs credentials/user (QA-010)
- Expected: Registered participants appear according to leaderboard configuration (entity, metric, visibility), and the Event Manager controls what is displayed.
- Actual: A registered participant was observed NOT appearing on the leaderboard in the live UI despite being registered.
- Reproduction: Register participant in live app → open leaderboard.
- Likely cause: live DB predated 00012/00013 at observation time (solo registrants got no account). 00012–00014 are now applied live; pglite proves the SQL path (v17 22/22), but **pglite does not prove the browser experience**.
- Target: Final QA — must be re-verified through the real signed-in browser against the live DB across: solo/team/mixed events, individuals/teams/combined, balance/tasks metrics, custom scoring unit, public/participants/hidden visibility, realtime updates, projector mode.

## QA-002 — Participant "My QR Codes" auto-provisioning
- Phase: 3 · Area: Participant QR · Severity: High · Status: FIXED (repo, final QA pass) — enabling the Attendance capability now auto-provisions an 'Attendance QR' operation (SettingsPage, idempotent); participants get labeled cards automatically. Live signed-in verification still under QA-010
- Expected: Enabling a capability (e.g. Attendance) automatically provisions the relevant participant-facing QR behavior — the participant sees the right cards (Attendance QR, Team QR when in a team, Feedback QR, etc.) with label, purpose, who scans it, when to show it. No participant-side configuration ever.
- Actual (repo): "My QR codes" is configuration-driven; with zero configs it falls back to legacy cards. But enabling the Attendance capability does NOT auto-create an Attendance QR operation — the Event Manager must add it manually in Settings → QR operations.
- Reproduction: Enable Attendance capability, add no QR config → participant sees generic legacy card, not an explicit "Attendance QR".
- Likely cause: no capability→default-config provisioning step.
- Target: Final QA (auto-provision defaults or clearer default cards). The visible/copyable p_/t_ token below the QR is intentional and must remain.

## QA-003 — Camera/scanner on real devices
- Phase: 3 · Area: Scanner · Severity: High · Status: DEFERRED — requires physical devices; nothing here can substitute
- Expected: Camera reliably starts after permission grant; all states (denied, in-use, unavailable, retry, stop, restart) behave on real hardware.
- Actual: NOT conclusively verified. The explicit-start state machine exists (repo) and classifies errors, but no physical-device test has been performed. Build/lint/pglite prove nothing here.
- Reproduction: n/a — requires Windows/Android/iOS-Safari/Chrome/Edge device pass.
- Target: Final QA (real devices). Do not claim fixed without device evidence.

## QA-004 — Silent no-op deletes (removeMember / removeClubMember / deleteActivity)
- Phase: 1–2 · Area: API · Severity: Medium · Status: FIXED — removeMember/removeClubMember/deleteActivity now verify a returned row and throw on RLS no-op
- Expected: An RLS-blocked delete surfaces an error.
- Actual: These helpers don't check affected rows; RLS-blocked deletes look like success (deleteEvent/deleteClub/deleteQrConfig already guard).
- Target: Final QA (add `.select('id')` + zero-row check).

## QA-005 — Orphaned public-bucket media
- Phase: 1 · Area: Storage · Severity: Low · Status: DEFERRED — needs a storage-cleanup job; nothing referenced breaks meanwhile
- Expected: Replaced/deleted event & club media is cleaned up.
- Actual: Uploads use timestamped paths; old objects linger in the public bucket forever.
- Target: Final QA / later maintenance job.

## QA-006 — RLS matrix extension (00010 onward)
- Phase: 1+ · Area: Testing · Severity: Medium · Status: DEFERRED — pglite suites v17-v21 cover 00012-00018 authorization locally; a live-DB matrix script remains a with-user QA task (the pre-00011 matrix file stays untouched)
- Expected: A live-DB-runnable RLS matrix covering clubs deletion, participation modes, leaderboard, QR ops, platform admin.
- Actual: tests/rls/phase1_matrix.sql covers pre-00011 only (must not be modified). pglite suites v17/v18/v19 cover the new surfaces locally, not against live.
- Target: Final QA (new matrix file; never edit the existing one).

## QA-007 — First-signup → super_admin bootstrap (production)
- Phase: 0 · Area: Auth · Severity: High (production only) · Status: DEFERRED — production deployment checklist item by design (ADR-0010 §3): create the owner via runbook before opening signups
- Expected: A fresh production DB cannot hand super_admin to a random first signup.
- Actual: Intentional dev bootstrap (00007). Deployment runbook: create the owner before opening signups (bootstrap arm then unreachable), or ship a controlled disable migration at deploy time.
- Target: Production deployment checklist (deliberate; see ADR-0010 §3).

## QA-008 — events.club_id NOT NULL
- Phase: 1 · Area: DB · Severity: Medium · Status: FIXED (repo) — migration 00018 enforces events.club_id NOT NULL with a loud orphan guard; pending live application
- Expected: Every event provably belongs to a club at the schema level.
- Actual: club_id remains nullable (deferred wave; renumbered repeatedly, now targeted at the hardening migration).
- Target: Final QA hardening migration.

## QA-009 — Mobile UX pass
- Phase: all · Area: UI · Severity: Medium · Status: DEFERRED — systematic mobile pass needs devices (QA-003/QA-010)
- Expected: All key screens usable on small viewports; 44px targets; no horizontal scroll.
- Actual: Responsive system exists; no systematic mobile pass performed.
- Target: Final QA (with real devices where possible).

## QA-010 — Signed-in browser E2E
- Phase: all · Area: Testing · Severity: High · Status: DEFERRED — needs credentials; all journeys exist in repo and are DB-verified in pglite
- Expected: Participant/Manager/Staff/Judge/Admin journeys clicked through in a real signed-in browser against live DB.
- Actual: Only signed-out browser smoke automated here (no credentials in this environment).
- Target: Final QA (requires credentials/user).

## QA-011 — Performance re-audit
- Phase: all · Area: Perf · Severity: Medium · Status: DEFERRED — bundle reviewed (all phase 3-6 pages lazy-loaded; main chunk ~134KB gzip; scanner chunk loads only on the scan page); Lighthouse re-run needs a served instance
- Expected: Re-run Lighthouse & bundle review after all phases (initial audit predates Phases 2–6).
- Actual: Not re-run; Scanner chunk (~372KB) is the largest lazy chunk (loaded only on scan page).
- Target: Final QA.

## QA-012 — Ownership transfer: DB accepts any target profile
- Phase: 4 · Area: Platform admin · Severity: Low · Status: WONT-FIX — documented as intended flexibility (ADR-0010): the DB function accepts any profile so a future owner does not have to pre-hold super_admin; the UI deliberately restricts the picker to Super Admins
- Expected: UI and DB agree on eligibility.
- Actual: transfer_platform_ownership accepts any existing profile; the "Super Admins only" restriction is UI-level. A transfer to a plain user also leaves them super_admin after a transfer-back (verified in pglite v19).
- Target: Final QA (decide: constrain function or document as intended flexibility).

## QA-013 — Participant self-scan UI
- Phase: 3 · Area: Scanner · Severity: Low · Status: DEFERRED — server-side authorization exists; the participant-facing scan surface is future UI work
- Expected: When a QR operation grants 'participant' scanner access, participants have a UI to scan.
- Actual: Server (perform_scan) authorizes it; the scan page is staff-gated — no participant surface.
- Target: Final QA / later phase.

## QA-014 — /q/ error copy when live DB lags repo
- Phase: 3 · Area: Public QR · Severity: Low · Status: FIXED — /q/ maps missing-RPC errors to a friendly message; self-resolves fully once migrations are applied live
- Actual: Against a DB without 00014 the /q/ page surfaced a raw PostgREST message ("Could not find the function… in the schema cache"). Self-resolved once 00014 was applied live, but unknown-function/RPC errors should map to a friendly message.
- Target: Final QA.

## QA-015 — Anon listing shows published public forms of archived events
- Phase: 3 · Area: Feedback · Severity: Low · Status: FIXED (repo) — migration 00018 rewrites the anon feedback-form policy to exclude archived events; pending live application
- Actual: Submissions to archived events are blocked, but the form row itself remains anon-listable (observed in pglite v18).
- Target: Final QA (policy tweak or accept + document).

## QA-016 — AI assistant / AI judging require Edge Function deployment
- Phase: 6 · Area: AI · Severity: Medium · Status: DEFERRED (deployment item)
- Expected: LLM-backed event assistant answers; future AI judging comparison rows.
- Actual (repo): supabase/functions/event-assistant is scaffolded (caller auth, staff-only, controlled aggregate snapshot, Anthropic API); the in-app panel falls back to labeled deterministic data-lookup answers until deployed. AI judging generation is intentionally not shipped; the judge_evaluations schema (source='ai') and results display are ready.
- Target: user deployment — `supabase functions deploy event-assistant` + `supabase secrets set ANTHROPIC_API_KEY=...`.
- Update (submission pass): submission PDFs now live in the private `submission-docs` bucket (00020), readable by service_role — so the deployed function can later fetch a document and pass it to the Anthropic API as a document content block. PDF **upload** is implemented; PDF **extraction** and **AI PDF analysis** are NOT implemented and remain deferred to this deployment item.

## QA-017 — Live database lags the repository
- Phase: 4-QA · Area: DB · Severity: High (blocking new features live) · Status: OPEN (user action)
- Actual (updated, Informatique Exhib pass): live Supabase now has 00001-00018 applied. Migration **00019** (public-first browsing, clubs.department, judge scanner role + feedback QR action, per-target feedback) is repo-only, pglite-verified (v22: 45/45), and must be applied as one script. Until then, signed-out visitors get a graceful error instead of the club/event directory, the department field doesn't persist, Judge isn't accepted by qr_configs, and per-target feedback dedupe isn't live.
- Target: manual application before Informatique Exhib.

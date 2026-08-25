// EMP ai-service Edge Function (ADR-0015).
//
// The ONLY place EMP talks to an AI provider. Two tasks:
//
//   suggest_scores   { submission_id, force? }
//     judge/organizer of the entry's event → reads the SUBMITTED entry (title,
//     description, fields, attached PDF from the private submission-docs
//     bucket) and the event's ENABLED criteria → asks the provider for a
//     per-criterion suggestion → validates → stores it as the entry's single
//     source='ai' judge_evaluations row (status 'draft', judge_id null) →
//     returns that row. Re-uses the stored row unless force=true.
//     The AI row NEVER feeds get_judging_results: totals are human-only.
//
//   analyze_feedback { form_id }
//     Event Manager of the form's event → reads the form's responses → sends
//     ONLY the answers (no respondent ids, categories, timestamps, emails) →
//     returns a validated organizer summary. Nothing is stored.
//
// Security model (same as event-assistant): the caller is authenticated with
// THEIR OWN JWT and authorization is probed with THEIR permissions through
// RLS; the service role is used only afterwards, for the narrow reads/writes
// the task needs. The provider key never leaves this function.
//
// Provider chain (Gemini → Mistral → OpenRouter) lives in _shared/ai.ts and is
// configured ONLY through Edge Function secrets — see supabase/functions/.env.example.
//
// Deploy:   supabase functions deploy ai-service
// Secrets:  supabase secrets set --env-file supabase/functions/.env

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AiError, analyzeFeedback, analyzeReport, analyzeSubmission, bytesToBase64,
  loadProviderChain, runWithFallback,
  type Attachment, type CriterionSpec,
} from "../_shared/ai.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PDF_MAX_BYTES = 10 * 1024 * 1024; // matches the submission-docs bucket cap (00020)
const FEEDBACK_MAX_RESPONSES = 400;     // bounded prompt; newest responses first
// Whole-request budget for the provider chain, below the Edge Function
// wall-clock limit so a slow chain ends with a clean timeout, not a killed
// function. Override with AI_REQUEST_BUDGET_MS.
const REQUEST_BUDGET_MS = Math.max(20_000, Number(Deno.env.get("AI_REQUEST_BUDGET_MS") ?? 140_000) || 140_000);
// judges may re-run an analysis, but not hammer a paid provider: a fresh
// result younger than this is returned instead of regenerated (managers exempt)
const FORCE_COOLDOWN_MS = 2 * 60_000;
// question labels that mark identity fields — their answers are never sent
// to the AI (the summary needs opinions, not names)
const IDENTITY_LABEL = /^(full\s+)?name$|\b(e-?mail|phone|mobile|whatsapp|roll\s*(no\.?|number)?|registration\s*(no\.?|number)|student\s*id|enrol?ment\s*(no\.?|number))\b/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.task !== "string") return json({ error: "task is required" }, 400);

    // 1. Authenticate the caller with their own JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData, error: userErr } = await asCaller.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    if (body.task === "suggest_scores") {
      return await suggestScores(asCaller, service, body);
    }
    if (body.task === "analyze_feedback") {
      return await feedbackSummary(asCaller, service, body);
    }
    if (body.task === "analyze_report") {
      return await reportAnalysis(asCaller, service, body);
    }
    return json({ error: `Unknown task "${body.task}"` }, 400);
  } catch (e) {
    if (e instanceof AiError) {
      const status = e.kind === "missing_key" || e.kind === "unsupported" ? 503
        : e.kind === "rate_limited" ? 429
        : e.kind === "timeout" ? 504
        : e.kind === "input" ? 400
        : 502; // auth / unavailable / network / provider / bad_output
      // metadata only — never the request, the key or any document
      console.warn(JSON.stringify({ ai: "request_failed", kind: e.kind, status: e.status ?? null }));
      return json({ error: e.message, kind: e.kind }, status);
    }
    console.error("ai-service failure", e);
    return json({ error: "AI service failed unexpectedly." }, 500);
  }
});

// deno-lint-ignore no-explicit-any
type Client = any;

// ---- suggest_scores ---------------------------------------------------------------------

async function suggestScores(asCaller: Client, service: Client, body: Record<string, unknown>) {
  const submissionId = String(body.submission_id ?? "");
  const force = body.force === true;
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) return json({ error: "submission_id is required" }, 400);

  // 2. Authorize with the CALLER's permissions: submissions RLS (00016) admits
  //    judges only for SUBMITTED entries of events they judge, plus managers.
  const { data: sub, error: subErr } = await asCaller
    .from("submissions").select("*").eq("id", submissionId).maybeSingle();
  if (subErr || !sub) return json({ error: "Submission not found or not accessible" }, 404);
  const { data: membership } = await asCaller
    .from("event_members").select("role")
    .eq("event_id", sub.event_id).eq("user_id", (await asCaller.auth.getUser()).data.user.id)
    .maybeSingle();
  const { data: mayManage } = await asCaller.rpc("can_manage_event", { p_event_id: sub.event_id });
  if (membership?.role !== "judge" && mayManage !== true) {
    return json({ error: "Only judges and Event Managers of this event can request AI suggestions" }, 403);
  }
  if (sub.status !== "submitted") return json({ error: "This entry has not been submitted yet" }, 400);

  // 3. Event gate: AI assistance must be switched on by the Event Manager
  const { data: ev } = await service
    .from("events").select("name,status,submission_config").eq("id", sub.event_id).single();
  if (!ev) return json({ error: "Event not found" }, 404);
  if (ev.submission_config?.ai_assist !== true) {
    return json({ error: "AI-assisted judging is not enabled for this event (Event settings → Submissions)." }, 400);
  }

  // 4. Cached result unless forced (and even then, a result younger than the
  //    cooldown is reused unless an Event Manager asks)
  const { data: existing } = await service
    .from("judge_evaluations").select("*")
    .eq("submission_id", submissionId).eq("source", "ai").maybeSingle();
  if (existing) {
    const generatedAt = Date.parse(String(existing.details?.generated_at ?? "")) || 0;
    const fresh = Date.now() - generatedAt < FORCE_COOLDOWN_MS;
    if (!force || (fresh && mayManage !== true)) return json({ evaluation: existing, cached: true });
  }

  // 5. Criteria (enabled only) — the validator maps suggestions back to these
  const { data: criteriaRows } = await service
    .from("judging_criteria").select("id,name,description,ai_instructions,max_score")
    .eq("event_id", sub.event_id).eq("is_enabled", true).order("sort_order");
  const criteria: CriterionSpec[] = (criteriaRows ?? []).map((c: Record<string, unknown>) => ({
    id: String(c.id), name: String(c.name), description: String(c.description ?? ""),
    ai_instructions: String(c.ai_instructions ?? ""), max_score: Number(c.max_score),
  }));
  if (criteria.length === 0) return json({ error: "This event has no enabled judging criteria yet." }, 400);

  // 6. The PDF, if any — from the private bucket, server-side, size-capped
  let attachment: Attachment | undefined;
  if (sub.document_path) {
    const { data: file, error: dlErr } = await service.storage
      .from("submission-docs").download(sub.document_path);
    if (dlErr || !file) return json({ error: "The attached PDF could not be read." }, 502);
    if (file.size > PDF_MAX_BYTES) return json({ error: "The attached PDF is too large for AI analysis (10 MB limit)." }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
      return json({ error: "The attached document is not a valid PDF." }, 400);
    }
    attachment = { mime: "application/pdf", base64: bytesToBase64(bytes), name: sub.document_name || "report.pdf" };
  }

  // 7. Ask the provider chain (first capable provider; next only on a
  //    recoverable provider failure), validate, store
  const chain = loadProviderChain();
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  const { result: analysis, provider } = await runWithFallback(chain, attachment !== undefined, (cfg) =>
    analyzeSubmission(cfg, {
      title: String(sub.title ?? "").slice(0, 300),
      description: String(sub.description ?? "").slice(0, 20_000),
      fields: (sub.content && typeof sub.content === "object") ? sub.content : {},
      attachment,
      eventName: String(ev.name),
      instructions: String(ev.submission_config?.instructions ?? "").slice(0, 2000),
    }, criteria), deadline);
  const usedModel = provider.model;

  const scores: Record<string, number> = {};
  for (const s of analysis.suggestions) scores[s.criterion_id] = s.suggested_score;
  const details = {
    model: usedModel,
    generated_at: new Date().toISOString(),
    summary: analysis.summary,
    strengths: analysis.strengths,
    weaknesses: analysis.weaknesses,
    suggestions: analysis.suggestions,
    pdf_analyzed: attachment !== undefined,
  };
  const notes = `AI suggestion (${usedModel}) — advisory only.`;

  // one AI row per submission (judge_evaluations_ai_one, 00016): upsert by hand
  const { data: prior } = await service
    .from("judge_evaluations").select("id")
    .eq("submission_id", submissionId).eq("source", "ai").maybeSingle();
  const row = prior
    ? await service.from("judge_evaluations")
        .update({ scores, notes, details, status: "draft" }).eq("id", prior.id).select().single()
    : await service.from("judge_evaluations")
        .insert({
          event_id: sub.event_id, submission_id: submissionId, judge_id: null,
          source: "ai", scores, notes, details, status: "draft",
        }).select().single();
  if (row.error || !row.data) {
    // code + message only — never `details`/`hint`, which can carry row content
    console.error(JSON.stringify({ ai: "ai_row_write_failed", code: row.error?.code ?? null, message: row.error?.message ?? null }));
    return json({ error: "The suggestion was generated but could not be stored." }, 500);
  }
  return json({ evaluation: row.data, cached: false });
}

// ---- analyze_report (00025) ----------------------------------------------------------------
// Event Report review for CLUB AUTHORITY only (super_admin / club_admin /
// convener = is_club_admin, the 00021 chokepoint — deliberately NOT
// can_manage_event, so a plain organizer does not qualify). The criteria come
// from event_report_analysis_criteria — the feature's OWN table — NEVER from
// judging_criteria; the two systems are architecturally separate. The result
// goes back to the caller and is NEVER written to judge_evaluations: official
// judging stays human.

const REPORT_PATH = /^reports\/[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]{1,120}\.pdf$/;

async function reportAnalysis(asCaller: Client, service: Client, body: Record<string, unknown>) {
  const eventId = String(body.event_id ?? "");
  const documentPath = String(body.document_path ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json({ error: "event_id is required" }, 400);
  if (!REPORT_PATH.test(documentPath) || split1(documentPath) !== eventId.toLowerCase()) {
    return json({ error: "Invalid report path" }, 400);
  }

  // authorize with the CALLER's permissions: the event's club, then the one
  // club-authority predicate. No service-role reads before this passes.
  const { data: ev, error: evErr } = await asCaller
    .from("events").select("id,club_id,name").eq("id", eventId).maybeSingle();
  if (evErr || !ev) return json({ error: "Event not found or not accessible" }, 404);
  const { data: authorized } = await asCaller.rpc("is_club_admin", { p_club_id: ev.club_id });
  if (authorized !== true) {
    return json({ error: "Only club administrators and conveners can run Event Report analysis" }, 403);
  }

  // the report document, from the PRIVATE bucket, server-side
  const { data: file, error: dlErr } = await service.storage
    .from("submission-docs").download(documentPath);
  if (dlErr || !file) return json({ error: "The report document could not be read — upload it first." }, 404);
  if (file.size > PDF_MAX_BYTES) return json({ error: "The report is too large for AI analysis (10 MB limit)." }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 5 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") {
    return json({ error: "The report document is not a valid PDF." }, 400);
  }
  const attachment: Attachment = { mime: "application/pdf", base64: bytesToBase64(bytes), name: "report.pdf" };

  // the feature's OWN criteria table — enabled rows only, read fresh every
  // run. judging_criteria is deliberately never consulted here.
  const { data: criteriaRows } = await service
    .from("event_report_analysis_criteria")
    .select("id,name,description,ai_instructions,max_score,weight")
    .eq("event_id", eventId).eq("is_enabled", true).order("sort_order");
  const rows = (criteriaRows ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    return json({ error: "No Event Report Analysis criteria are configured for this event yet — add them above the upload." }, 400);
  }
  const aiCriteria: CriterionSpec[] = rows.map((c) => ({
    id: String(c.id), name: String(c.name), description: String(c.description ?? ""),
    ai_instructions: String(c.ai_instructions ?? ""), max_score: Number(c.max_score),
  }));

  const chain = loadProviderChain();
  const { result: analysis, provider } = await runWithFallback(chain, true, (cfg) =>
    analyzeReport(cfg, String(ev.name), attachment, aiCriteria), Date.now() + REQUEST_BUDGET_MS);

  // one entry per enabled analysis criterion, in configured order
  const byId = new Map(analysis.suggestions.map((s) => [s.criterion_id, s]));
  const criteria = rows.map((c) => {
    const id = String(c.id);
    const s = byId.get(id);
    return {
      criterion_id: id,
      criterion: String(c.name),
      max_score: Number(c.max_score),
      weight: Number(c.weight),
      ...(s ? { suggested_score: s.suggested_score, reasoning: s.reasoning, evidence: s.evidence } : {}),
    };
  });

  return json({
    analysis: {
      model: provider.model,
      summary: analysis.summary,
      strengths: analysis.strengths,
      weaknesses: analysis.weaknesses,
      criteria,
    },
  });
}

function split1(path: string): string {
  return path.split("/")[1]?.toLowerCase() ?? "";
}

// ---- analyze_feedback ---------------------------------------------------------------------

async function feedbackSummary(asCaller: Client, service: Client, body: Record<string, unknown>) {
  const formId = String(body.form_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(formId)) return json({ error: "form_id is required" }, 400);

  // authorize with the caller's permissions: only Event Managers may read responses
  const { data: form, error: formErr } = await asCaller
    .from("feedback_forms").select("id,event_id,title,questions").eq("id", formId).maybeSingle();
  if (formErr || !form) return json({ error: "Feedback form not found or not accessible" }, 404);
  const { data: mayManage } = await asCaller.rpc("can_manage_event", { p_event_id: form.event_id });
  if (mayManage !== true) return json({ error: "Only Event Managers can analyze feedback" }, 403);

  const { data: ev } = await service.from("events").select("name").eq("id", form.event_id).single();
  // answers ONLY — respondent identity, category and timing never leave the database
  const { data: responses } = await service
    .from("feedback_responses").select("answers")
    .eq("form_id", formId).order("created_at", { ascending: false })
    .limit(FEEDBACK_MAX_RESPONSES);
  // identity-type questions (name, roll number, email, …) are dropped from
  // both the question list and every answer before anything leaves the server
  const questions = (Array.isArray(form.questions) ? form.questions : [])
    .map((q: Record<string, unknown>) => ({ key: String(q.key), label: String(q.label), type: String(q.type) }))
    .filter((q: { label: string }) => !IDENTITY_LABEL.test(q.label.trim()));
  const keep = new Set(questions.map((q: { key: string }) => q.key));
  const answers = (responses ?? []).map((r: { answers: unknown }) => {
    const a = (r.answers && typeof r.answers === "object") ? r.answers as Record<string, unknown> : {};
    return Object.fromEntries(Object.entries(a).filter(([k]) => keep.has(k)));
  }).filter((a: Record<string, unknown>) => Object.keys(a).length > 0);
  if (answers.length === 0) return json({ error: "There are no responses to analyze yet." }, 400);

  const chain = loadProviderChain();
  const { result: analysis, provider } = await runWithFallback(chain, false, (cfg) =>
    analyzeFeedback(cfg, {
      eventName: String(ev?.name ?? "Event"),
      formTitle: String(form.title),
      questions,
      responses: answers,
    }), Date.now() + REQUEST_BUDGET_MS);
  return json({ analysis: { ...analysis, model: provider.model } });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

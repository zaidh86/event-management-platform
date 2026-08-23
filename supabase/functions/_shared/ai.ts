// EMP AI Service — provider adapter (ADR-0015).
//
// ONE abstraction the rest of EMP talks to:
//   analyzeSubmission()  — PDF/description → structured analysis + per-criterion
//                          score suggestions (advisory; validated before use)
//   analyzeFeedback()    — feedback answers → organizer summary
//
// Below it, ONE provider adapter chosen by environment — never by the client:
//   AI_PROVIDER = "gemini"            Google Gemini API (native PDF input)
//   AI_PROVIDER = "openai_compatible" any /chat/completions endpoint
//                                     (OpenAI, Mistral, Groq, OpenRouter, …)
// Provider secrets live ONLY in Edge Function secrets (supabase secrets set);
// the browser never sees a key, a base URL or a model id.
//
// Every call: timeout, bounded input, strict JSON parsing, schema validation.
// Any failure is surfaced as an AiError with a human-readable message — the
// caller shows it and human judging continues unaffected.

export class AiError extends Error {
  constructor(message: string, public readonly kind:
    | "missing_key" | "rate_limited" | "timeout" | "provider" | "bad_output" | "unsupported" | "input") {
    super(message);
  }
}

export interface AiConfig {
  provider: "gemini" | "openai_compatible";
  apiKey: string;
  model: string;
  baseUrl: string;
  // how a PDF is attached on openai_compatible endpoints:
  //   "file"          OpenAI-style {type:"file", file:{filename, file_data}}
  //   "document_url"  Mistral-style {type:"document_url", document_url: data URL}
  //   "none"          provider cannot read PDFs — analysis proceeds from text only
  pdfPart: "file" | "document_url" | "none";
  timeoutMs: number;
  label: string;
}

function readConfig(prefix: "AI" | "AI_FALLBACK", label: string): AiConfig | null {
  const env = (k: string) => (Deno.env.get(`${prefix}_${k}`) ?? "").trim();
  const apiKey = env("PROVIDER_API_KEY");
  if (!apiKey) return null;
  const provider = (env("PROVIDER") || "gemini") as AiConfig["provider"];
  if (provider !== "gemini" && provider !== "openai_compatible") {
    throw new AiError(`Unknown ${prefix}_PROVIDER "${provider}"`, "unsupported");
  }
  const model = env("MODEL") || (provider === "gemini" ? "gemini-2.5-flash" : "");
  if (!model) throw new AiError(`${prefix}_MODEL is not set.`, "missing_key");
  const baseUrl = (env("BASE_URL") ||
    (provider === "gemini"
      ? "https://generativelanguage.googleapis.com/v1beta"
      : "https://api.openai.com/v1")).replace(/\/+$/, "");
  const pdfRaw = env("PDF_PART") || "file";
  const pdfPart = (["file", "document_url", "none"].includes(pdfRaw) ? pdfRaw : "file") as AiConfig["pdfPart"];
  const timeoutMs = Math.max(10_000, Number(env("TIMEOUT_MS") || 90_000) || 90_000);
  return { provider, apiKey, model, baseUrl, pdfPart, timeoutMs, label };
}

// Primary is required; the fallback is optional and only consulted when the
// primary fails for a transient reason (rate limit, outage, timeout). Both are
// server-side secrets — see supabase/functions/.env.example.
export function loadConfig(): { primary: AiConfig; fallback: AiConfig | null } {
  const primary = readConfig("AI", "primary");
  if (!primary) {
    throw new AiError("AI is not configured on this server (missing AI_PROVIDER_API_KEY).", "missing_key");
  }
  return { primary, fallback: readConfig("AI_FALLBACK", "fallback") };
}

// run a task on the primary, then (for transient failures only) the fallback
export async function withFallback<T>(
  cfgs: { primary: AiConfig; fallback: AiConfig | null },
  run: (cfg: AiConfig) => Promise<T>,
): Promise<T> {
  try {
    return await run(cfgs.primary);
  } catch (e) {
    const transient = e instanceof AiError && ["rate_limited", "provider", "timeout"].includes(e.kind);
    if (!cfgs.fallback || !transient) throw e;
    return await run(cfgs.fallback);
  }
}

// ---- generic "ask for JSON" primitive ---------------------------------------------

export interface Attachment { mime: "application/pdf"; base64: string; name: string }

interface AskArgs {
  system: string;
  user: string;
  attachment?: Attachment;
  maxOutputTokens: number;
}

// Returns the parsed JSON object the model produced. Never returns fabricated
// data: if the provider fails or the output is not JSON, an AiError is thrown.
export async function askForJson(cfg: AiConfig, args: AskArgs): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const raw = cfg.provider === "gemini"
      ? await callGemini(cfg, args, controller.signal)
      : await callOpenAiCompatible(cfg, args, controller.signal);
    return parseJsonLoose(raw);
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new AiError("The AI provider took too long to respond.", "timeout");
    }
    throw new AiError(`AI provider request failed: ${(e as Error)?.message ?? String(e)}`, "provider");
  } finally {
    clearTimeout(timer);
  }
}

function mapHttpError(status: number, body: string): AiError {
  const snippet = body.slice(0, 300).replace(/\s+/g, " ");
  if (status === 401 || status === 403) return new AiError("The AI provider rejected the server's API key.", "provider");
  if (status === 429) return new AiError("The AI provider is rate-limiting requests right now — try again in a minute.", "rate_limited");
  if (status === 413) return new AiError("The document is too large for the AI provider.", "input");
  if (status >= 500) return new AiError(`The AI provider is unavailable (HTTP ${status}).`, "provider");
  return new AiError(`AI provider error ${status}: ${snippet}`, "provider");
}

// Gemini generateContent: inline PDF (≤ ~20 MB request), JSON response mode.
async function callGemini(cfg: AiConfig, a: AskArgs, signal: AbortSignal): Promise<string> {
  const parts: unknown[] = [];
  if (a.attachment) {
    parts.push({ inline_data: { mime_type: a.attachment.mime, data: a.attachment.base64 } });
  }
  parts.push({ text: a.user });
  const resp = await fetch(
    `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`,
    {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: a.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: a.maxOutputTokens,
          response_mime_type: "application/json",
        },
      }),
    },
  );
  if (!resp.ok) throw mapHttpError(resp.status, await resp.text());
  const body = await resp.json();
  const text = (body?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) {
    const reason = body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason;
    throw new AiError(`The AI returned no content${reason ? ` (${reason})` : ""}.`, "bad_output");
  }
  return text;
}

// OpenAI-compatible chat completions. PDFs travel as the OpenAI "file" content
// part (data URL); providers that do not support it return an error we surface.
async function callOpenAiCompatible(cfg: AiConfig, a: AskArgs, signal: AbortSignal): Promise<string> {
  const content: unknown[] = [];
  if (a.attachment && cfg.pdfPart === "file") {
    content.push({
      type: "file",
      file: {
        filename: a.attachment.name,
        file_data: `data:${a.attachment.mime};base64,${a.attachment.base64}`,
      },
    });
  } else if (a.attachment && cfg.pdfPart === "document_url") {
    content.push({
      type: "document_url",
      document_url: `data:${a.attachment.mime};base64,${a.attachment.base64}`,
    });
  }
  const userText = a.attachment && cfg.pdfPart === "none"
    ? `${a.user}\n\n(NOTE: a PDF was attached but this provider cannot read PDFs — judge from the text above only and say so in the summary.)`
    : a.user;
  content.push({ type: "text", text: userText });
  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: a.maxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: a.system },
        { role: "user", content },
      ],
    }),
  });
  if (!resp.ok) throw mapHttpError(resp.status, await resp.text());
  const body = await resp.json();
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text) throw new AiError("The AI returned no content.", "bad_output");
  return text;
}

// models occasionally wrap JSON in ``` fences despite JSON mode
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
    }
    throw new AiError("The AI response was not valid JSON.", "bad_output");
  }
}

// ---- task: submission analysis + score suggestions ----------------------------------

export interface CriterionSpec {
  id: string;
  name: string;
  description: string;
  ai_instructions: string;
  max_score: number;
}

export interface SubmissionInput {
  title: string;
  description: string;
  fields: Record<string, unknown>;
  attachment?: Attachment;
  eventName: string;
  instructions: string;
}

export interface CriterionSuggestion {
  criterion_id: string;
  criterion: string;
  suggested_score: number;
  max_score: number;
  reasoning: string;
  evidence: string[];
}

export interface SubmissionAnalysis {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: CriterionSuggestion[];
}

export async function analyzeSubmission(
  cfg: AiConfig, input: SubmissionInput, criteria: CriterionSpec[],
): Promise<SubmissionAnalysis> {
  if (criteria.length === 0) throw new AiError("This event has no enabled judging criteria.", "input");
  const system =
    "You are an assistant to the HUMAN judges of a student project competition. " +
    "You read ONE submission (a written description and, if attached, a PDF report — read its text, " +
    "figures, screenshots, tables and diagrams) and suggest a score for EACH judging criterion, with " +
    "concise reasoning grounded in specific evidence from the submission. Be fair, consistent and " +
    "conservative: do not reward claims that the submission does not substantiate. Never invent " +
    "content that is not in the submission. Your suggestions are advisory; a human decides. " +
    "Respond with JSON only, matching exactly the schema in the user message.";
  const rubric = criteria.map((c) => ({
    criterion_id: c.id,
    criterion: c.name,
    max_score: c.max_score,
    guidance: c.description || "(none)",
    ai_instructions: c.ai_instructions || "(use the guidance)",
  }));
  const user = [
    `Event: ${input.eventName}`,
    input.instructions ? `Submission instructions given to participants: ${input.instructions}` : "",
    `Submission title: ${input.title}`,
    `Submission description:\n${input.description || "(none)"}`,
    Object.keys(input.fields).length > 0 ? `Additional fields: ${JSON.stringify(input.fields)}` : "",
    input.attachment ? "A PDF report is attached — analyze it in full." : "No PDF is attached.",
    "",
    `Judging criteria (score each from 0 to its max_score, decimals allowed):\n${JSON.stringify(rubric, null, 1)}`,
    "",
    "Return JSON with this exact shape:",
    JSON.stringify({
      summary: "2–4 sentences: what the project is and does",
      strengths: ["…"],
      weaknesses: ["…"],
      suggestions: [{
        criterion_id: "<criterion_id from the rubric>",
        criterion: "<criterion name>",
        suggested_score: 0,
        max_score: 0,
        reasoning: "1–3 sentences",
        evidence: ["short quotes or concrete references from the submission"],
      }],
    }),
  ].filter((l) => l !== "").join("\n");

  const raw = await askForJson(cfg, { system, user, attachment: input.attachment, maxOutputTokens: 4000 });
  return validateSubmissionAnalysis(raw, criteria);
}

// Strict validation: every suggestion must map to a real, enabled criterion;
// numeric, within [0, max]; text fields bounded. Unknown criteria are dropped,
// not guessed. No extra keys survive.
export function validateSubmissionAnalysis(raw: unknown, criteria: CriterionSpec[]): SubmissionAnalysis {
  if (!raw || typeof raw !== "object") throw new AiError("AI output was not an object.", "bad_output");
  const o = raw as Record<string, unknown>;
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const suggestionsRaw = Array.isArray(o.suggestions) ? o.suggestions : [];
  const seen = new Set<string>();
  const suggestions: CriterionSuggestion[] = [];
  for (const s of suggestionsRaw) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const id = String(r.criterion_id ?? "");
    const c = byId.get(id);
    if (!c || seen.has(id)) continue;
    const score = Number(r.suggested_score);
    if (!Number.isFinite(score)) continue;
    seen.add(id);
    suggestions.push({
      criterion_id: c.id,
      criterion: c.name,
      suggested_score: Math.min(Math.max(Math.round(score * 100) / 100, 0), c.max_score),
      max_score: c.max_score,
      reasoning: str(r.reasoning, 1200) || "No reasoning given.",
      evidence: strList(r.evidence, 8, 300),
    });
  }
  if (suggestions.length === 0) {
    throw new AiError("The AI did not produce a usable score suggestion for any criterion.", "bad_output");
  }
  return {
    summary: str(o.summary, 2000) || "No summary given.",
    strengths: strList(o.strengths, 10, 300),
    weaknesses: strList(o.weaknesses, 10, 300),
    suggestions,
  };
}

// ---- task: feedback analysis ---------------------------------------------------------

export interface FeedbackInput {
  eventName: string;
  formTitle: string;
  questions: { key: string; label: string; type: string }[];
  // answers ONLY — no respondent ids, names, emails, timestamps
  responses: Record<string, unknown>[];
}

export interface FeedbackAnalysis {
  response_count: number;
  summary: string;
  went_well: string[];
  positive_themes: string[];
  needs_improvement: string[];
  complaints: string[];
  recommended_actions: string[];
  priority: string;
}

export async function analyzeFeedback(cfg: AiConfig, input: FeedbackInput): Promise<FeedbackAnalysis> {
  if (input.responses.length === 0) throw new AiError("There are no responses to analyze yet.", "input");
  const system =
    "You summarize anonymous event feedback for the organizers of a college event. " +
    "Work ONLY from the responses given; never invent respondents, counts or quotes. " +
    "Be concrete and actionable. Do not speculate about who wrote anything. " +
    "Respond with JSON only, matching exactly the schema in the user message.";
  const user = [
    `Event: ${input.eventName}`,
    `Form: ${input.formTitle}`,
    `Questions: ${JSON.stringify(input.questions)}`,
    `Responses (${input.responses.length}, answers keyed by question key):`,
    JSON.stringify(input.responses),
    "",
    "Return JSON with this exact shape:",
    JSON.stringify({
      summary: "3–5 sentences overall",
      went_well: ["…"],
      positive_themes: ["…"],
      needs_improvement: ["…"],
      complaints: ["…"],
      recommended_actions: ["ordered, most impactful first"],
      priority: "the single most important recommendation, one sentence",
    }),
  ].join("\n");
  const raw = await askForJson(cfg, { system, user, maxOutputTokens: 2500 });
  return validateFeedbackAnalysis(raw, input.responses.length);
}

export function validateFeedbackAnalysis(raw: unknown, count: number): FeedbackAnalysis {
  if (!raw || typeof raw !== "object") throw new AiError("AI output was not an object.", "bad_output");
  const o = raw as Record<string, unknown>;
  const summary = str(o.summary, 3000);
  if (!summary) throw new AiError("The AI did not produce a summary.", "bad_output");
  return {
    response_count: count,
    summary,
    went_well: strList(o.went_well, 12, 400),
    positive_themes: strList(o.positive_themes, 12, 400),
    needs_improvement: strList(o.needs_improvement, 12, 400),
    complaints: strList(o.complaints, 12, 400),
    recommended_actions: strList(o.recommended_actions, 10, 400),
    priority: str(o.priority, 600) || "—",
  };
}

// ---- helpers ------------------------------------------------------------------------

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim() !== "")
    .slice(0, maxItems).map((x) => (x as string).trim().slice(0, maxLen));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

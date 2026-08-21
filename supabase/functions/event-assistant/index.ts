// EMP event-assistant Edge Function (ADR-0012).
//
// LLM-backed Q&A about ONE event, with strictly controlled data access:
// the model never touches the database — it only ever sees the aggregate
// snapshot assembled below (counts and public-safe summaries; no emails, no
// registration data, no judge notes, no tokens).
//
// Deploy:   supabase functions deploy event-assistant
// Secrets:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are injected
// by the platform.)
//
// Until deployed, the in-app assistant panel falls back to deterministic
// data-lookup answers and labels them accordingly.

import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";

Deno.serve(async (req) => {
  try {
    const { event_id, question } = await req.json();
    if (!event_id || !question || String(question).length > 500) {
      return json({ error: "event_id and question (max 500 chars) required" }, 400);
    }

    // 1. Authenticate the CALLER with their own JWT — anon gets nothing.
    const authHeader = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await asCaller.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);

    // 2. Authorize: caller must be event staff/manager — probed with THEIR
    //    permissions (RLS answers; the service role is never used for this).
    const { data: membership } = await asCaller
      .from("event_members").select("role")
      .eq("event_id", event_id).eq("user_id", userData.user.id).maybeSingle();
    const { data: profile } = await asCaller
      .from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
    const staffRoles = ["organizer", "activity_admin", "volunteer", "judge"];
    const isPlatformAdmin = profile?.role === "super_admin" || profile?.role === "platform_owner";
    if (!isPlatformAdmin && !staffRoles.includes(membership?.role ?? "")) {
      return json({ error: "Only event staff can use the assistant" }, 403);
    }

    // 3. Controlled retrieval: a bounded, privacy-safe aggregate snapshot.
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const count = async (table: string, extra?: (q: any) => any) => {
      let q = service.from(table).select("id", { count: "exact", head: true }).eq("event_id", event_id);
      if (extra) q = extra(q);
      const { count: n } = await q;
      return n ?? 0;
    };
    const { data: ev } = await service
      .from("events")
      .select("name,status,capabilities,leaderboard_config,submission_config")
      .eq("id", event_id).single();
    if (!ev) return json({ error: "Event not found" }, 404);

    const snapshot = {
      event: { name: ev.name, status: ev.status },
      registrations: await count("participants"),
      teams: await count("teams"),
      attendance: await count("attendance"),
      scans: await count("scans"),
      transactions: await count("transactions"),
      submissions_submitted: await count("submissions", (q) => q.eq("status", "submitted")),
      feedback_responses: await count("feedback_responses"),
    };
    const { data: board } = await service.rpc("get_leaderboard", { p_event_id: event_id });
    const top = (board ?? []).slice(0, 5).map((r: any) => ({
      rank: r.rank, name: r.name, balance: r.balance, tasks: r.tasks_completed,
    }));

    // 4. Ask the model — the snapshot is its ENTIRE world.
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system:
          "You are the EMP event assistant. Answer ONLY from the JSON snapshot provided. " +
          "If the snapshot cannot answer the question, say so plainly — never invent numbers or names.",
        messages: [{
          role: "user",
          content: `Event data snapshot:\n${JSON.stringify({ ...snapshot, top })}\n\nQuestion: ${question}`,
        }],
      }),
    });
    if (!resp.ok) return json({ error: `LLM error ${resp.status}` }, 502);
    const body = await resp.json();
    const answer = body?.content?.[0]?.text ?? "No answer.";
    return json({ answer });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

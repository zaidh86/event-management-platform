// EMP Game Integration API
// External games call this Edge Function with a per-activity API key.
// They never touch the database or balances directly — every points change
// goes through the same SQL ledger path (game_api_submit → _apply_transaction).
//
// Deploy: supabase functions deploy game-api --no-verify-jwt
//
// Endpoints (base: https://<project>.supabase.co/functions/v1/game-api):
//   GET  /resolve?qr=<token>        → { kind, name, account_id, balance, ... }
//   POST /submit-result             → { qr_token, amount, description?, metadata? }
//   GET  /leaderboard               → standings for the activity's event
// Auth: header `x-api-key: <key>` (issued once when the activity is created).

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return json({ error: "Missing x-api-key header" }, 401);

  const { data: activity, error: actErr } = await supabase
    .from("activities")
    .select("id, event_id, name, kind, is_active, config")
    .eq("api_key_hash", await sha256Hex(apiKey))
    .maybeSingle();

  if (actErr) return json({ error: "Lookup failed" }, 500);
  if (!activity || activity.kind !== "integrated" || !activity.is_active) {
    return json({ error: "Invalid or inactive API key" }, 401);
  }

  const url = new URL(req.url);
  // path after the function name, e.g. /game-api/resolve → "resolve"
  const route = url.pathname.split("/").filter(Boolean).at(-1);

  try {
    if (req.method === "GET" && route === "resolve") {
      const qr = url.searchParams.get("qr");
      if (!qr) return json({ error: "Missing qr parameter" }, 400);
      const { data, error } = await supabase.rpc("resolve_qr", { p_qr_token: qr });
      if (error) return json({ error: error.message }, 404);
      if (data.event_id !== activity.event_id) {
        return json({ error: "QR code belongs to a different event" }, 403);
      }
      return json({ activity: { id: activity.id, name: activity.name, config: activity.config }, ...data });
    }

    if (req.method === "POST" && route === "submit-result") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.qr_token !== "string" || typeof body.amount !== "number" ||
          !Number.isFinite(body.amount)) {
        return json({ error: "Body must be { qr_token: string, amount: number, description?, metadata? }" }, 400);
      }
      const { data, error } = await supabase.rpc("game_api_submit", {
        p_activity_id: activity.id,
        p_qr_token: body.qr_token,
        p_amount: body.amount,
        p_description: typeof body.description === "string" ? body.description : "",
        p_metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      });
      if (error) return json({ error: error.message }, 422);
      return json({ transaction: data });
    }

    if (req.method === "GET" && route === "leaderboard") {
      const { data, error } = await supabase.rpc("get_leaderboard", { p_event_id: activity.event_id });
      if (error) return json({ error: error.message }, 500);
      return json({ leaderboard: data });
    }

    return json({ error: "Unknown endpoint" }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Internal error" }, 500);
  }
});

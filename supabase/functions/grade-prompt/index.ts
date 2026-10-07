// POST { submission_id } with the player's JWT. Grades the caller's own submission if quota allows.
// Idempotent: the browser calls it again every ~6 s while the submission is queued.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { corsHeaders, json, readJson } from "../_shared/cors.ts";
import { load, work } from "../_shared/worker.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth?.user) return json(req, { error: "Sign in first." }, 401);

  const body = await readJson(req);
  const id = String(body?.submission_id ?? "");
  if (!body || !UUID.test(id)) return json(req, { error: "Bad request." }, 400);

  try {
    const l = await load(admin, id);
    if (!l || l.owner_auth_uid !== auth.user.id) return json(req, { error: "Submission not found." }, 404);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const result = await work(admin, l, { ip });
    return json(req, result);
  } catch (e) {
    console.error(JSON.stringify({ sub: id, error: (e as Error).message }));
    return json(req, { status: "queued", detail: "error" }, 200);
  }
});

// Cron backstop (pg_cron, every minute): grades the oldest queued submissions and pending regrades.
// Auth: x-drain-token header must match the Vault secret 'drain_token' (checked in SQL). JWT verification is off.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { load, work } from "../_shared/worker.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const BUDGET_MS = 45_000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const token = req.headers.get("x-drain-token") ?? "";
  if (token.length < 32) return new Response("Forbidden", { status: 403 });
  const { data: ok } = await admin.rpc("svc_check_drain_token", { token });
  if (ok !== true) return new Response("Forbidden", { status: 403 });

  const started = Date.now();
  const { data: ids, error } = await admin.rpc("svc_next_queued", { lim: 20 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const counts: Record<string, number> = {};
  for (const id of (ids ?? []) as string[]) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      const l = await load(admin, id);
      if (!l) continue;
      const r = await work(admin, l);
      counts[r.detail] = (counts[r.detail] ?? 0) + 1;
      // Stop early once quota is exhausted for this minute; the next cron tick continues.
      if (r.detail === "quota") break;
    } catch (e) {
      console.error(JSON.stringify({ sub: id, error: (e as Error).message }));
    }
  }
  return new Response(JSON.stringify({ processed: counts }), { headers: { "Content-Type": "application/json" } });
});

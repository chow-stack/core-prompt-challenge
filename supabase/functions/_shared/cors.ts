// CORS: allow local dev, Vercel deployments, and any extra origins in ALLOWED_ORIGINS (comma-separated).
// Auth is a bearer token, never a cookie, so a reflected allowlisted origin is safe.
const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const patterns = [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /^https:\/\/[a-z0-9-]+\.vercel\.app$/];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const ok = extra.includes(origin) || patterns.some((p) => p.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

/** Read a JSON body, rejecting anything over maxBytes. */
export async function readJson(req: Request, maxBytes = 8192): Promise<Record<string, unknown> | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) return null;
  const text = await req.text();
  if (text.length > maxBytes) return null;
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

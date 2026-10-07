// Grade one submission, respecting quota. Shared by grade-prompt (browser-driven) and drain-queue (cron backstop).
// Flow (PLAN.md 3.1): claim a model slot -> call Gemini -> clamp with finalize -> record.
// On failure try the other model once, then requeue with backoff. Estimate after queue_timeout_s, 3 failed tries,
// the daily ceiling, grader_mode='estimate', or a missing GEMINI_API_KEY.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { callGemini } from "./gemini.ts";
import { cleanFeedback, finalize, localGrade, mockGrade } from "./scoring.ts";

type Loaded = {
  submission: {
    id: string; status: string; prompt: string; game_id: string | null; is_live: boolean; tries: number;
    regrade_requested: boolean; is_estimate: boolean; age_s: number;
  };
  owner_auth_uid: string;
  scenario: { title: string; situation: string; goal: string; notes: string; must: string[] };
  settings: Record<string, unknown>;
};

export type WorkResult = { status: "graded" | "queued" | "grading"; detail: string };

const CALL_TIMEOUT_MS = 12_000;
const IP_LIMIT_PER_HOUR = 30;

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export async function load(sb: SupabaseClient, id: string): Promise<Loaded | null> {
  return await rpc<Loaded | null>(sb, "svc_load", { sub: id });
}

async function recordEstimate(sb: SupabaseClient, l: Loaded, why: string): Promise<WorkResult> {
  // A pending regrade keeps its existing estimate; nothing to do.
  if (l.submission.status === "graded") return { status: "graded", detail: "kept_estimate_" + why };
  const g = localGrade(l.submission.prompt, l.scenario.must);
  await rpc(sb, "svc_record", { sub: l.submission.id, call_id: null, grade: { ...g, graded_by: "estimate", is_estimate: true } });
  console.log(JSON.stringify({ sub: l.submission.id, graded_by: "estimate", why }));
  return { status: "graded", detail: "estimate_" + why };
}

export async function work(sb: SupabaseClient, l: Loaded, opts: { ip?: string } = {}): Promise<WorkResult> {
  const s = l.submission;
  if (s.status === "graded" && !s.regrade_requested) return { status: "graded", detail: "already" };
  const mode = String(l.settings.grader_mode ?? "gemini");
  const timeout = Number(l.settings.queue_timeout_s ?? 90);
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  const isRegrade = s.status === "graded";

  if (mode === "estimate") return recordEstimate(sb, l, "mode");
  if (mode === "gemini" && !key) return recordEstimate(sb, l, "no_key");
  if (!isRegrade && (s.age_s > timeout || s.tries >= 3)) return recordEstimate(sb, l, s.tries >= 3 ? "failed" : "timeout");
  if (mode === "gemini" && opts.ip && !s.is_live && !isRegrade) {
    const ok = await rpc<boolean>(sb, "svc_ip_check", { ip: opts.ip, sub: s.id, max_subs: IP_LIMIT_PER_HOUR });
    if (!ok) return recordEstimate(sb, l, "ip_limit");
  }

  let claim = await rpc<{ model?: string; call_id?: string; reason?: string }>(sb, "svc_claim", { sub: s.id, exclude_model: null });
  if (!claim.model) {
    if (claim.reason === "graded") return { status: "graded", detail: "already" };
    if (claim.reason === "daily" || claim.reason === "solo_cap") return recordEstimate(sb, l, claim.reason);
    return { status: s.status === "grading" ? "grading" : "queued", detail: claim.reason ?? "wait" };
  }

  if (mode === "mock") {
    const g = mockGrade(s.prompt);
    await rpc(sb, "svc_record", { sub: s.id, call_id: claim.call_id, grade: { ...g, graded_by: "mock", http_status: 200, latency_ms: 0 } });
    return { status: "graded", detail: "mock" };
  }

  const extra = (l.settings.gemini_generation_extra ?? {}) as Record<string, unknown>;
  const scenario = { title: l.scenario.title, situation: l.scenario.situation, goal: l.scenario.goal, notes: l.scenario.notes };
  const deadline = Date.now() + 26_000;
  for (let attempt = 0; attempt < 2; attempt++) {
    const model = claim.model!;
    const res = await callGemini(model, key, scenario, s.prompt, Math.min(CALL_TIMEOUT_MS, deadline - Date.now()), extra);
    console.log(JSON.stringify({ sub: s.id, model, ok: res.ok, status: res.status, latency_ms: res.latencyMs, reason: res.ok ? undefined : res.reason }));
    if (res.ok) {
      const f = finalize(res.data, s.prompt);
      const fallback = localGrade(s.prompt, l.scenario.must);
      const grade = {
        ...f,
        strength: cleanFeedback(res.data.strength, fallback.strength),
        fix: cleanFeedback(res.data.fix, fallback.fix),
        graded_by: model,
        is_estimate: false,
        http_status: res.status,
        latency_ms: res.latencyMs,
      };
      await rpc(sb, "svc_record", { sub: s.id, call_id: claim.call_id, grade });
      return { status: "graded", detail: model };
    }
    const last = attempt === 1 || deadline - Date.now() < 3000;
    await rpc(sb, "svc_fail", { sub: s.id, call_id: claim.call_id, http_status: res.status || null, latency_ms: res.latencyMs, give_up: false });
    if (last) break;
    const next = await rpc<{ model?: string; call_id?: string; reason?: string }>(sb, "svc_claim", { sub: s.id, exclude_model: model });
    if (!next.model) break;
    claim = next;
  }
  // Both models failed (or no second slot): back to the queue with backoff.
  await rpc(sb, "svc_fail", { sub: s.id, call_id: null, http_status: null, latency_ms: null, give_up: true });
  return { status: "queued", detail: "retry" };
}

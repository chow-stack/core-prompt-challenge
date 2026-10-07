// Gemini generateContent over plain REST. The key lives only in the GEMINI_API_KEY function secret.
import { GRADE_SCHEMA, graderSystemInstruction, graderUserContent, type GraderScenario } from "./scoring.ts";

export type GeminiResult =
  | { ok: true; data: Record<string, unknown>; status: number; latencyMs: number }
  | { ok: false; reason: string; status: number; latencyMs: number };

const NUMERIC = ["c", "o", "r", "e", "quality", "accuracy", "habits"];

export async function callGemini(
  model: string,
  apiKey: string,
  scenario: GraderScenario,
  prompt: string,
  timeoutMs: number,
  extraGenerationConfig: Record<string, unknown> = {},
): Promise<GeminiResult> {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let status = 0;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: ctl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: graderSystemInstruction() }] },
          contents: [{ role: "user", parts: [{ text: graderUserContent(scenario, prompt) }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 600,
            responseMimeType: "application/json",
            responseJsonSchema: GRADE_SCHEMA,
            ...extraGenerationConfig,
          },
        }),
      },
    );
    status = res.status;
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      // Error bodies from Google never contain our key; keep only a short reason for logs.
      const err = await res.json().catch(() => ({}));
      const msg = String((err as { error?: { status?: string } }).error?.status ?? "http_error");
      return { ok: false, reason: msg, status, latencyMs };
    }
    const body = await res.json();
    const cand = body?.candidates?.[0];
    if (!cand || cand.finishReason !== "STOP") {
      return { ok: false, reason: "finish_" + (cand?.finishReason ?? body?.promptFeedback?.blockReason ?? "none"), status, latencyMs };
    }
    const text = (cand.content?.parts ?? [])
      .filter((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === "string")
      .map((p: { text: string }) => p.text)
      .join("");
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, reason: "bad_json", status, latencyMs };
    }
    if (!data || typeof data !== "object" || NUMERIC.some((k) => typeof data[k] !== "number")) {
      return { ok: false, reason: "bad_shape", status, latencyMs };
    }
    return { ok: true, data, status, latencyMs };
  } catch (e) {
    return { ok: false, reason: (e as Error).name === "AbortError" ? "timeout" : "network", status, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

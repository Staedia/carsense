// Sends the scan summary to an LLM and turns its answer into a report.
// Supports Claude directly, or any OpenAI-compatible endpoint (OpenAI,
// OpenRouter, Ollama, LM Studio...). Falls back to the offline rules.

import { ruleBasedReport } from './rules.js';

export const SYSTEM_PROMPT = `You are an experienced automotive diagnostic assistant inside a car health app.

You receive a JSON summary of an OBD-II scan: vehicle details, check-engine-light state, stored and pending trouble codes, live sensor statistics over a short window (avg/min/max, plus trend for temperatures, std for RPM, and switch counts for O2 sensors), one-off snapshot values, and an optional note from the driver. It may also include:
- vehicle.vin_prefix: the first 11 characters of the VIN (manufacturer, model, engine, model year).
- emissions_self_tests: the car's built-in readiness monitors, how many have completed and which have not. Unfinished tests plus a short distance or few warm-ups since codes were cleared usually means the codes were cleared recently, which can hide a fault (important when buying a used car).
- misfire_counts: the engine computer's own per-cylinder misfire counters (Mode 06). Index 0 is cylinder 1 (on a few makes the order follows firing order). Near zero is normal; one cylinder far above the others points to that cylinder's plug, coil or injector, even with no code yet.
- battery_test: a test the driver ran with the engine off then starting. resting_v (engine off), cranking_min_v (lowest during starting), charging_v (engine running). Measured by the dongle at the OBD port, accurate to about ±0.2 V.
- readings.adapter_voltage_v: battery voltage measured by the dongle, used when the car doesn't report it.
- freeze_frame: the sensor snapshot the engine computer saved when the code named in freeze_frame.code was set (coolant temperature, rpm, speed, load, fuel trims...). Use it to say under what conditions the fault happens (cold engine, idle, highway speed, heavy load).

Your job:
1. Give an overall health status: "Good", "Watch", or "Needs attention".
2. List up to 3 likely causes, ranked, each with a confidence ("high", "medium", "low") and a one-line reason that cites the specific codes or readings.
3. Suggest what to check first, cheapest and easiest first (max 4 items).
4. Say whether it is safe to keep driving: "yes", "with caution", or "no".

Rules:
- Only use the data provided plus well-known knowledge about the vehicle. If something important is missing, say what extra data would help.
- Never state a diagnosis as certain. Use language like "most likely" or "points to".
- If any reading suggests a safety risk (overheating, charging failure, severe misfire), put it in safety_warning.
- Normal reference points for a warm petrol engine at idle: coolant 85-100°C, battery 13.5-14.7 V running, short+long fuel trim within ±10%, steady idle RPM, front O2 switching often, rear O2 fairly steady, commanded_lambda about 1.0, catalyst_temp_c roughly 300-700°C once warm.
- Battery test guide: resting 12.4 V or more is well charged, under 12.2 V is low; cranking minimum 10 V or more is healthy, under 9.6 V means a weak battery; charging 13.5-14.7 V is normal (some modern cars run lower on purpose to save fuel).
- If the engine was not warm or not running, say readings may be unreliable.
- Write in plain English for someone who is not a mechanic.

Respond with ONLY a JSON object, no markdown, in exactly this shape:
{
  "status": "Good" | "Watch" | "Needs attention",
  "headline": "one short sentence",
  "safety_warning": "string or null",
  "likely_causes": [{"cause": "string", "confidence": "high" | "medium" | "low", "reason": "string"}],
  "checks": ["string"],
  "safe_to_drive": "yes" | "with caution" | "no",
  "safe_to_drive_note": "one sentence",
  "missing_data": ["string"],
  "summary": "plain-English explanation, under 120 words"
}`;

export const DEFAULT_SETTINGS = {
  provider: 'claude', // 'claude' | 'openai' | 'offline'
  apiKey: '',
  model: 'claude-sonnet-5-5',
  baseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-4o-mini',
};

export function userMessage(summary) {
  return `Here is the scan summary:\n${JSON.stringify(summary, null, 2)}`;
}

// Models sometimes wrap JSON in ```fences``` or add a sentence; dig it out.
export function parseJsonLoose(text) {
  if (!text) throw new Error('Empty response from the AI');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The AI did not return JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x != null) : []);

export function normalizeReport(obj, meta = {}) {
  return {
    source: 'ai',
    ...meta,
    status: pick(obj.status, ['Good', 'Watch', 'Needs attention'], 'Watch'),
    headline: String(obj.headline || ''),
    safety_warning: obj.safety_warning ? String(obj.safety_warning) : null,
    likely_causes: arr(obj.likely_causes).slice(0, 3).map((c) => ({
      cause: String(c.cause || ''),
      confidence: pick(String(c.confidence || '').toLowerCase(), ['high', 'medium', 'low'], 'low'),
      reason: String(c.reason || ''),
    })),
    checks: arr(obj.checks).map(String).slice(0, 4),
    safe_to_drive: pick(obj.safe_to_drive, ['yes', 'with caution', 'no'], 'with caution'),
    safe_to_drive_note: String(obj.safe_to_drive_note || ''),
    missing_data: arr(obj.missing_data).map(String),
    summary: String(obj.summary || ''),
  };
}

async function httpError(res, who) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || '';
  } catch { /* ignore */ }
  const hint = {
    401: 'API key was rejected. Check it in Settings.',
    403: 'API key does not have access to this model.',
    404: 'Model or endpoint not found. Check the model name / base URL.',
    429: 'Rate limited or out of credit. Try again shortly.',
  }[res.status];
  return new Error(`${who} error ${res.status}: ${hint || detail || res.statusText}`);
}

export async function callClaude(summary, { apiKey, model }, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Needed for calls straight from a browser. Fine for a personal app;
      // for a public app, put a small server in between to hide the key.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage(summary) }],
    }),
  });
  if (!res.ok) throw await httpError(res, 'Claude');
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { report: parseJsonLoose(text), usage: data.usage };
}

export async function callOpenAICompatible(summary, { apiKey, baseUrl, openaiModel }, fetchImpl = fetch) {
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage(summary) },
      ],
    }),
  });
  if (!res.ok) throw await httpError(res, 'AI endpoint');
  const data = await res.json();
  return { report: parseJsonLoose(data.choices?.[0]?.message?.content), usage: data.usage };
}

/** Returns a report. Never throws: on any AI failure it falls back to rules. */
export async function analyze(summary, settings = DEFAULT_SETTINGS, fetchImpl = globalThis.fetch) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const offline = (reason) => ({ ...ruleBasedReport(summary), fallback_reason: reason || null });

  if (s.provider === 'offline') return offline(null);
  if (s.provider === 'claude' && !s.apiKey) return offline('No Claude API key set, so this is the basic offline check.');

  try {
    const { report, usage } = s.provider === 'openai'
      ? await callOpenAICompatible(summary, s, fetchImpl)
      : await callClaude(summary, s, fetchImpl);
    const model = s.provider === 'openai' ? s.openaiModel : s.model;
    return normalizeReport(report, { model, usage });
  } catch (err) {
    const msg = err?.message?.includes('fetch')
      ? "Couldn't reach the AI (no internet?)."
      : err.message;
    return offline(`${msg} Showing the basic offline check instead.`);
  }
}

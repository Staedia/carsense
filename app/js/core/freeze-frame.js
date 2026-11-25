// Freeze frame (Mode 02): when a trouble code sets, the engine computer
// saves a snapshot of the sensors at that moment. It answers "what was the
// car doing when this happened?": cold or warm engine, idling or at speed,
// under load or cruising. Mechanics rely on it; it costs nothing to read.

import { PIDS } from './pids.js';

// Snapshot values worth showing, most useful first.
export const FREEZE_PIDS = [0x05, 0x0c, 0x0d, 0x04, 0x06, 0x07, 0x11, 0x0b, 0x10, 0x0f, 0x42, 0x0e];

/** Plain-English one-liner: "at 64 km/h with a warm engine (88°C), 2,200 rpm, 45% load". */
export function describeFreezeFrame(values = {}) {
  const v = values;
  const parts = [];
  const rpm = v.rpm;
  const speed = v.speed_kmh;
  if (speed != null) {
    if (speed < 3) parts.push(rpm != null && rpm > 300 ? 'while idling' : 'while stationary');
    else if (speed < 60) parts.push(`at ${Math.round(speed)} km/h (town speed)`);
    else if (speed < 90) parts.push(`at ${Math.round(speed)} km/h`);
    else parts.push(`at ${Math.round(speed)} km/h (highway speed)`);
  }
  const ct = v.coolant_temp_c;
  if (ct != null) {
    const state = ct < 50 ? 'a cold engine' : ct < 75 ? 'the engine still warming up' : ct >= 105 ? 'a very hot engine' : 'a warm engine';
    parts.push(`with ${state} (${Math.round(ct)}°C)`);
  }
  const extras = [];
  if (rpm != null) extras.push(`${Math.round(rpm).toLocaleString('en')} rpm`);
  if (v.engine_load_pct != null) {
    const load = Math.round(v.engine_load_pct);
    extras.push(load >= 70 ? `heavy load (${load}%)` : `${load}% load`);
  }
  const text = [parts.join(' '), extras.join(', ')].filter(Boolean).join(', ');
  return text ? `Set ${text}.` : '';
}

/** Rounded values keyed like the summary readings, for the AI and the report. */
export function freezeFrameSummary(ff) {
  if (!ff) return null;
  const out = { code: ff.code };
  for (const [key, val] of Object.entries(ff.values)) {
    const def = Object.values(PIDS).find((d) => d.key === key);
    const f = 10 ** (def?.precision ?? 1);
    out[key] = Math.round(val * f) / f;
  }
  return out;
}

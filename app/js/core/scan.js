// Runs a health check: reads codes, samples live sensors for a window,
// and condenses everything into a compact summary for the AI (a few
// hundred tokens, no matter how long the window is).

import { PIDS, defByKey } from './pids.js';
import { describeDtc } from './dtc.js';

// Live sensors worth polling on a petrol engine, most useful first.
export const LIVE_PIDS = [
  0x0c, 0x05, 0x06, 0x07, 0x04, 0x42, 0x14, 0x15, 0x0f, 0x11, 0x0b, 0x10, 0x0e, 0x0d, 0x5c, 0x3c, 0x44,
];
export const ONCE_PIDS = Object.entries(PIDS)
  .filter(([, d]) => d.once)
  .map(([pid]) => Number(pid));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortError = () => Object.assign(new Error('Scan cancelled'), { name: 'AbortError' });

/**
 * Poll live PIDs until durationSec elapses (or the signal aborts).
 * onSample(key, value, pid) fires for every reading, for live gauges.
 * adapterVoltage: also read the dongle's own voltmeter each cycle (key
 * adapter_voltage_v). Defaults to on when the car doesn't report PID 0x42.
 */
export async function collectLive(elm, {
  pids = LIVE_PIDS, durationSec = 60, signal, onSample, onProgress,
  now = () => Date.now(), minCycleMs = 0, maxCycles = Infinity,
  adapterVoltage = !elm.supports(0x42),
} = {}) {
  const usable = pids.filter((p) => elm.supports(p));
  const series = {};
  const start = now();
  let cycles = 0;
  const elapsed = () => (now() - start) / 1000;

  while (elapsed() < durationSec && cycles < maxCycles) {
    const cycleStart = now();
    for (const pid of usable) {
      if (signal?.aborted) throw abortError();
      const value = await elm.readPid(pid);
      if (value == null) continue;
      const key = PIDS[pid].key;
      (series[key] ||= []).push({ t: elapsed(), v: value });
      onSample?.(key, value, pid);
    }
    if (adapterVoltage) {
      if (signal?.aborted) throw abortError();
      const v = await elm.readAdapterVoltage().catch(() => null);
      if (v != null) {
        (series.adapter_voltage_v ||= []).push({ t: elapsed(), v });
        onSample?.('adapter_voltage_v', v, null);
      }
    }
    cycles++;
    onProgress?.(Math.min(1, elapsed() / durationSec));
    const spent = now() - cycleStart;
    if (minCycleMs && spent < minCycleMs) await sleep(minCycleMs - spent);
  }
  return { series, seconds: elapsed(), cycles };
}

const round = (v, dp) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

function stats(points, precision) {
  const vs = points.map((p) => p.v);
  const n = vs.length;
  const avg = vs.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(vs.reduce((a, b) => a + (b - avg) ** 2, 0) / n);
  return {
    avg: round(avg, precision),
    min: round(Math.min(...vs), precision),
    max: round(Math.max(...vs), precision),
    first: round(vs[0], precision),
    last: round(vs[n - 1], precision),
    std: round(std, Math.max(precision, 1)),
    n,
  };
}

// How many times an O2 sensor crosses 0.45 V. A healthy front sensor
// switches often; a healthy rear sensor (after the catalyst) barely moves.
function switches(points) {
  let count = 0;
  for (let i = 1; i < points.length; i++) {
    if ((points[i - 1].v - 0.45) * (points[i].v - 0.45) < 0) count++;
  }
  return count;
}

export function summarize({
  vehicle, vin, monitor, stored, pending, once, live, misfire, batteryTest, userNote,
}) {
  const readings = {};
  for (const [key, points] of Object.entries(live.series)) {
    if (!points.length) continue;
    const def = defByKey(key);
    const s = stats(points, def.precision);
    const out = { avg: s.avg, min: s.min, max: s.max };
    if (/temp/.test(key)) out.trend = round(s.last - s.first, def.precision);
    if (key === 'rpm') out.std = s.std;
    if (key.startsWith('o2_')) out.switches = switches(points);
    readings[key] = out;
  }

  const r = readings;
  const context = {
    engine_running: r.rpm ? r.rpm.avg > 300 : null,
    idling: r.speed_kmh ? r.speed_kmh.max < 3 : null,
    warmed_up: r.coolant_temp_c ? r.coolant_temp_c.max >= 75 : null,
  };

  const snapshot = {};
  for (const [key, v] of Object.entries(once || {})) {
    if (v == null) continue;
    snapshot[key] = round(v, defByKey(key).precision);
  }

  // The car's built-in emissions self-tests. Unfinished ones plus a short
  // distance since codes were cleared usually means someone cleared them.
  const monitors = monitor?.monitors?.length ? monitor.monitors : null;
  const selfTests = monitors && {
    complete: monitors.filter((m) => m.complete).length,
    incomplete: monitors.filter((m) => !m.complete).map((m) => m.name),
  };

  const out = {
    // VIN without the serial number: enough to identify the model and
    // engine, without sending the exact car's identity to the AI.
    vehicle: vin ? { ...vehicle, vin_prefix: vin.slice(0, 11) } : vehicle,
    check_engine_light_on: monitor ? monitor.milOn : null,
    trouble_codes: {
      stored: (stored || []).map(describeDtc).map(({ code, description }) => ({ code, description })),
      pending: (pending || []).map(describeDtc).map(({ code, description }) => ({ code, description })),
    },
    window_seconds: Math.round(live.seconds),
    context,
    readings,
    snapshot,
    emissions_self_tests: selfTests || null,
  };
  if (misfire) {
    out.misfire_counts = {
      // index 0 = cylinder 1
      last_drive: misfire.recent,
      avg_last_10_drives: misfire.avg10,
    };
  }
  if (batteryTest) {
    out.battery_test = {
      resting_v: batteryTest.resting,
      cranking_min_v: batteryTest.crankMin,
      charging_v: batteryTest.charging,
    };
  }
  out.user_note = userNote?.trim() || null;
  return out;
}

export async function runHealthCheck(elm, {
  vehicle, userNote, durationSec = 60, signal, onSample, onProgress, onStage,
  now, minCycleMs = 0, maxCycles, batteryTest,
} = {}) {
  onStage?.('Reading warning light and trouble codes');
  const monitor = await elm.readMonitorStatus();
  const stored = await elm.readDtcs('03');
  const pending = await elm.readDtcs('07');
  const vin = await elm.readVin().catch(() => null);

  onStage?.('Reading misfire counters');
  const misfire = await elm.readMisfireCounts().catch(() => null);

  const once = {};
  for (const pid of ONCE_PIDS) {
    if (signal?.aborted) throw abortError();
    if (elm.supports(pid)) once[PIDS[pid].key] = await elm.readPid(pid);
  }

  onStage?.('Sampling live sensors');
  const live = await collectLive(elm, {
    durationSec, signal, onSample, onProgress, now, minCycleMs, maxCycles,
  });
  if (!Object.keys(live.series).length) {
    throw new Error('No live data came back from the car. Is the engine running?');
  }
  return summarize({
    vehicle, vin, monitor, stored, pending, once, live, misfire, batteryTest, userNote,
  });
}

// A fake ELM327 dongle plugged into a fake 2019-ish petrol car.
// It implements the same send(cmd) interface as the Bluetooth transport,
// so the whole app (protocol parsing included) runs exactly as it will
// with a real dongle. Pick a scenario to simulate a fault.

import { PIDS, encodeMonitorStatus, encodeSupportedBitmap, hex2 } from './pids.js';
import { encodeDtc } from './dtc.js';

// Small deterministic random generator so runs are repeatable in tests.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_SUPPORTED = [
  0x01, 0x04, 0x05, 0x06, 0x07, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11,
  0x14, 0x15, 0x1f, 0x21, 0x2f, 0x30, 0x31, 0x3c, 0x42, 0x44, 0x46,
];

// Made-up VIN in a valid format (model year code K = 2019).
const SIM_VIN = 'LSJA24000KS000001';

// Signals that drop to zero (or near it) when the engine is off.
const ENGINE_OFF = {
  rpm: 0, engine_load_pct: 0, maf_gps: 0, timing_advance_deg: 0, short_term_fuel_trim_pct: 0,
  intake_map_kpa: 100, throttle_pct: 14.5, o2_b1s1_v: 0.1, o2_b1s2_v: 0.1, speed_kmh: 0, commanded_lambda: 1,
};

// Healthy warm idle. Each signal is f(t seconds, n = noise(amplitude)).
const BASE = {
  rpm: (t, n) => 780 + 20 * Math.sin(t * 0.7) + n(12),
  coolant_temp_c: (t, n) => Math.min(90, 84 + t * 0.2) + n(0.4),
  engine_load_pct: (t, n) => 22 + n(1.5),
  short_term_fuel_trim_pct: (t, n) => 0.5 + n(2.5),
  long_term_fuel_trim_pct: (t, n) => 1.6 + n(0.3),
  intake_map_kpa: (t, n) => 33 + n(1.2),
  speed_kmh: () => 0,
  timing_advance_deg: (t, n) => 10 + n(1.5),
  intake_air_temp_c: (t, n) => 36 + t * 0.02 + n(0.3),
  maf_gps: (t, n) => 2.6 + n(0.15),
  throttle_pct: (t, n) => 14.5 + n(0.2),
  o2_b1s1_v: (t, n) => 0.45 + 0.38 * Math.sin(t * 2.9) + n(0.04),
  o2_b1s2_v: (t, n) => 0.68 + n(0.02),
  fuel_level_pct: () => 54,
  module_voltage_v: (t, n) => 14.2 + n(0.04),
  ambient_temp_c: () => 31,
  distance_since_codes_cleared_km: () => 4821,
  distance_with_mil_km: () => 0,
  warmups_since_codes_cleared: () => 212,
  engine_run_time_s: (t) => 840 + t,
  catalyst_temp_c: (t, n) => 420 + n(4),
  commanded_lambda: () => 1,
};

// Defaults for the extra data each scenario can override.
const BASE_EXTRAS = {
  freezeFrame: null, // { code, values } saved when a code set
  incomplete: [], // readiness monitors not finished yet
  misfire: { recent: [0, 1, 0, 0], avg10: [0, 0, 0, 0] },
  battery: { rest: 12.45, crankMin: 10.3 }, // ignition on, engine off
};

export const SCENARIOS = {
  healthy: {
    label: 'Healthy car',
    description: 'Warm idle, no codes, everything in range.',
    stored: [], pending: [], milOn: false, signals: {},
  },
  driving: {
    label: 'Healthy car, out for a drive',
    description: 'No faults, driving at changing speeds. Try the live view to see fuel economy.',
    stored: [], pending: [], milOn: false,
    signals: {
      speed_kmh: (t) => Math.max(0, 55 + 45 * Math.sin(t / 12)),
      rpm: (t, n) => 850 + 24 * Math.max(0, 55 + 45 * Math.sin(t / 12)) + n(40),
      maf_gps: (t, n) => 3 + 0.18 * Math.max(0, 55 + 45 * Math.sin(t / 12)) + 4 * Math.max(0, Math.cos(t / 12)) + n(0.4),
      engine_load_pct: (t, n) => 24 + 0.35 * Math.max(0, 55 + 45 * Math.sin(t / 12)) + n(2),
      throttle_pct: (t, n) => 15 + 0.2 * Math.max(0, 55 + 45 * Math.sin(t / 12)) + n(0.5),
      intake_map_kpa: (t, n) => 34 + 0.4 * Math.max(0, 55 + 45 * Math.sin(t / 12)) + n(1.5),
      catalyst_temp_c: (t, n) => 520 + n(8),
    },
  },
  lean: {
    label: 'Running lean (P0171)',
    description: 'Positive fuel trims and a lean code, like a vacuum leak or dirty air flow sensor.',
    stored: ['P0171'], pending: [], milOn: true,
    freezeFrame: {
      code: 'P0171',
      values: { coolant_temp_c: 89, rpm: 790, speed_kmh: 0, engine_load_pct: 21, short_term_fuel_trim_pct: 10.2, long_term_fuel_trim_pct: 14.1, throttle_pct: 14.5, intake_map_kpa: 34, maf_gps: 2.3, intake_air_temp_c: 33, module_voltage_v: 14.2, timing_advance_deg: 9 },
    },
    signals: {
      short_term_fuel_trim_pct: (t, n) => 9.5 + n(3),
      long_term_fuel_trim_pct: (t, n) => 12.5 + n(0.4),
      o2_b1s1_v: (t, n) => 0.28 + 0.2 * Math.sin(t * 2.9) + n(0.04),
      distance_with_mil_km: () => 212,
    },
  },
  misfire: {
    label: 'Misfire (P0302)',
    description: 'Shaky idle and a cylinder 2 misfire code, like a worn spark plug or bad coil.',
    stored: ['P0302'], pending: ['P0300'], milOn: true,
    misfire: { recent: [3, 187, 1, 0], avg10: [1, 46, 0, 0] },
    freezeFrame: {
      code: 'P0302',
      values: { coolant_temp_c: 87, rpm: 2210, speed_kmh: 64, engine_load_pct: 47, short_term_fuel_trim_pct: 4.7, long_term_fuel_trim_pct: 2.3, throttle_pct: 22, intake_map_kpa: 58, maf_gps: 14.6, intake_air_temp_c: 31, module_voltage_v: 14.1, timing_advance_deg: 18.5 },
    },
    signals: {
      rpm: (t, n) => 760 + n(55) - (Math.sin(t * 1.9) > 0.85 ? 140 : 0),
      engine_load_pct: (t, n) => 20 + n(3),
      short_term_fuel_trim_pct: (t, n) => 5 + n(4),
      distance_with_mil_km: () => 38,
    },
  },
  overheating: {
    label: 'Overheating',
    description: 'Coolant temperature climbing past safe levels, pending overheat code.',
    stored: [], pending: ['P0217'], milOn: false,
    signals: {
      coolant_temp_c: (t, n) => Math.min(119, 104 + t * 0.35) + n(0.4),
    },
  },
  charging: {
    label: 'Charging problem',
    description: 'Battery voltage too low with the engine running, like a failing alternator or loose belt.',
    stored: [], pending: ['P0562'], milOn: false,
    battery: { rest: 12.15, crankMin: 9.7 },
    signals: {
      module_voltage_v: (t, n) => 12.25 - t * 0.002 + n(0.05),
    },
  },
  battery: {
    label: 'Weak battery',
    description: 'Engine runs fine, but the battery is tired. Run the battery test to see it.',
    stored: [], pending: [], milOn: false,
    battery: { rest: 11.95, crankMin: 8.9 },
    signals: {},
  },
  cleared: {
    label: 'Codes recently cleared',
    description: 'Someone cleared the trouble codes a few km ago, so the self-tests have not finished. Common on used cars for sale.',
    stored: [], pending: [], milOn: false,
    incomplete: ['catalyst', 'evaporative system', 'O2 sensor'],
    signals: {
      distance_since_codes_cleared_km: () => 14,
      warmups_since_codes_cleared: () => 2,
      long_term_fuel_trim_pct: (t, n) => 6.5 + n(0.3),
    },
  },
  catalyst: {
    label: 'Worn catalytic converter (P0420)',
    description: 'Rear O2 sensor copies the front one, a classic sign the catalyst is tired.',
    stored: ['P0420'], pending: [], milOn: true,
    freezeFrame: {
      code: 'P0420',
      values: { coolant_temp_c: 92, rpm: 2480, speed_kmh: 102, engine_load_pct: 38, short_term_fuel_trim_pct: 0.8, long_term_fuel_trim_pct: 2.3, throttle_pct: 19, intake_map_kpa: 52, maf_gps: 16.8, intake_air_temp_c: 29, module_voltage_v: 14.2, timing_advance_deg: 22 },
    },
    signals: {
      o2_b1s2_v: (t, n) => 0.45 + 0.32 * Math.sin(t * 2.9 - 0.4) + n(0.04),
      distance_with_mil_km: () => 1430,
    },
  },
};

export class SimulatedElm {
  /**
   * @param {object} opts
   * @param {string} opts.scenario  key of SCENARIOS
   * @param {number} opts.latencyMs real delay per command (demo realism)
   * @param {boolean} opts.virtualTime advance a fake clock per command instead of using real time
   * @param {number} opts.virtualStepSec fake seconds per command when virtualTime is on
   * @param {boolean} opts.ignitionOn false = car doesn't answer (tests error handling)
   * @param {boolean} opts.ignoreSpacesOff behave like a clone that ignores ATS0
   * @param {number} opts.seed
   * @param {number[]} opts.supported Mode 01 PIDs the fake car answers
   * @param {boolean} opts.engineRunning false = ignition on, engine off
   */
  constructor({
    scenario = 'healthy', latencyMs = 0, virtualTime = false, virtualStepSec = 0.07,
    ignitionOn = true, ignoreSpacesOff = false, seed = 7, supported = DEFAULT_SUPPORTED,
    engineRunning = true,
  } = {}) {
    if (!SCENARIOS[scenario]) throw new Error(`Unknown scenario: ${scenario}`);
    this.scenario = { ...BASE_EXTRAS, ...SCENARIOS[scenario] };
    this.supported = supported;
    this.engineRunning = engineRunning;
    this.crankAt = null;
    this.scenarioKey = scenario;
    this.latencyMs = latencyMs;
    this.virtualTime = virtualTime;
    this.virtualStepSec = virtualStepSec;
    this.ignitionOn = ignitionOn;
    this.ignoreSpacesOff = ignoreSpacesOff;
    this.rand = mulberry32(seed);
    this.vt = 0;
    this.realStart = Date.now();
    this.connected = true;
    this._reset();
  }

  _reset() {
    this.echo = true;
    this.spaces = true;
    this.linefeeds = false;
    this.searched = false;
  }

  /** Current simulated time in ms (pass to the collector as its clock). */
  now() {
    return this.virtualTime ? this.vt * 1000 : Date.now();
  }

  _t() {
    return this.virtualTime ? this.vt : (Date.now() - this.realStart) / 1000;
  }

  /** Demo controls: switch the engine off, or turn the key to start it. */
  setEngine(running) {
    this.engineRunning = running;
    this.crankAt = null;
  }
  crank() {
    this.crankAt = this._t();
  }

  _value(key) {
    const noise = (amp) => (this.rand() * 2 - 1) * amp;
    if (this.crankAt != null && this._t() - this.crankAt >= 1.2) {
      this.engineRunning = true; // it caught
      this.crankAt = null;
    }
    if (key === 'module_voltage_v') {
      const { rest, crankMin } = this.scenario.battery;
      if (this.crankAt != null) {
        const tc = this._t() - this.crankAt;
        // Starter motor pulls the voltage down hard, with ripple.
        return tc < 0.1 ? rest - 0.2 : crankMin + Math.abs(noise(0.25));
      }
      if (!this.engineRunning) return rest + noise(0.02);
    }
    if (!this.engineRunning && key in ENGINE_OFF) return ENGINE_OFF[key];
    const fn = this.scenario.signals[key] || BASE[key];
    return fn(this._t(), noise);
  }

  _fmt(bytes) {
    const parts = bytes.map(hex2);
    return this.spaces || this.ignoreSpacesOff ? parts.join(' ') : parts.join('');
  }

  _dtcResponse(modeByte, codes) {
    return this._message([modeByte, codes.length, ...codes.flatMap(encodeDtc)]);
  }

  // One CAN message, split into ISO-TP frames if it doesn't fit in one.
  _message(payload) {
    if (payload.length <= 7) return [this._fmt(payload)];
    // ISO-TP multi-frame, as an ELM327 prints it with headers off.
    const lines = [payload.length.toString(16).toUpperCase().padStart(3, '0')];
    let idx = 0;
    lines.push(`${idx}: ${this._fmt(payload.slice(0, 6))}`);
    for (let i = 6; i < payload.length; i += 7) {
      idx = (idx + 1) % 16;
      const chunk = payload.slice(i, i + 7);
      while (chunk.length < 7) chunk.push(0);
      lines.push(`${idx.toString(16).toUpperCase()}: ${this._fmt(chunk)}`);
    }
    return lines;
  }

  _respond(cmd) {
    const c = cmd.replace(/\s+/g, '').toUpperCase();
    if (c.startsWith('AT')) return this._at(c.slice(2));

    if (!this.ignitionOn) return [this.searched ? 'NO DATA' : 'SEARCHING...', 'UNABLE TO CONNECT'];
    const out = [];
    if (!this.searched) {
      out.push('SEARCHING...');
      this.searched = true;
    }

    const mode = c.slice(0, 2);
    if (mode === '01' && c.length >= 4) {
      const pid = parseInt(c.slice(2, 4), 16);
      if ([0x00, 0x20, 0x40].includes(pid)) {
        const list = [...this.supported];
        if (pid === 0x00) list.push(0x20);
        if (pid === 0x20) list.push(0x40);
        out.push(this._fmt([0x41, pid, ...encodeSupportedBitmap(pid, list)]));
        return out;
      }
      if (pid === 0x01) {
        const status = {
          milOn: this.scenario.milOn, dtcCount: this.scenario.stored.length, incomplete: this.scenario.incomplete,
        };
        out.push(this._fmt([0x41, 0x01, ...encodeMonitorStatus(status)]));
        return out;
      }
      const def = PIDS[pid];
      if (!def || !this.supported.includes(pid)) return [...out, 'NO DATA'];
      out.push(this._fmt([0x41, pid, ...def.encode(this._value(def.key))]));
      return out;
    }
    if (mode === '03') return [...out, ...this._dtcResponse(0x43, this.scenario.stored)];
    if (mode === '07') return [...out, ...this._dtcResponse(0x47, this.scenario.pending)];
    if (mode === '04') {
      this.scenario = { ...this.scenario, stored: [], pending: [], milOn: false };
      return [...out, '44'];
    }
    if (mode === '02' && c.length === 6) {
      const pid = parseInt(c.slice(2, 4), 16);
      const ff = this.scenario.freezeFrame;
      if (pid === 0x02) return [...out, this._fmt([0x42, 0x02, 0x00, ...(ff ? encodeDtc(ff.code) : [0, 0])])];
      if (!ff) return [...out, 'NO DATA'];
      const saved = Object.entries(PIDS).filter(([, d]) => d.key in ff.values).map(([p]) => Number(p));
      if (pid === 0x00) return [...out, this._fmt([0x42, 0x00, 0x00, ...encodeSupportedBitmap(0x00, [0x02, ...saved])])];
      const def = PIDS[pid];
      if (!def || !(def.key in ff.values)) return [...out, 'NO DATA'];
      return [...out, this._fmt([0x42, pid, 0x00, ...def.encode(ff.values[def.key])])];
    }
    if (c === '06A0') {
      const cyl = this.scenario.misfire.recent.length; // MIDs A1 (all) + A2.. per cylinder
      const mids = Array.from({ length: cyl + 1 }, (_, i) => 0xa1 + i);
      return [...out, this._fmt([0x46, 0xa0, ...encodeSupportedBitmap(0xa0, mids)])];
    }
    if (mode === '06' && c.length === 4) {
      const mid = parseInt(c.slice(2), 16);
      const i = mid - 0xa2;
      const { recent, avg10 } = this.scenario.misfire;
      if (i < 0 || i >= recent.length) return [...out, 'NO DATA'];
      const rec = (tid, v) => [mid, tid, 0x24, v >> 8, v & 0xff, 0, 0, 0xff, 0xff];
      return [...out, ...this._message([0x46, ...rec(0x0b, avg10[i]), ...rec(0x0c, recent[i])])];
    }
    if (c === '0902') {
      return [...out, ...this._message([0x49, 0x02, 0x01, ...[...SIM_VIN].map((ch) => ch.charCodeAt(0))])];
    }
    return [...out, 'NO DATA'];
  }

  _at(rest) {
    if (rest === 'Z') {
      this._reset();
      return ['', 'ELM327 v1.5'];
    }
    if (rest === 'I') return ['ELM327 v1.5'];
    if (rest === 'E0' || rest === 'E1') { this.echo = rest === 'E1'; return ['OK']; }
    if (rest === 'S0' || rest === 'S1') { this.spaces = rest === 'S1'; return ['OK']; }
    if (rest === 'L0' || rest === 'L1') { this.linefeeds = rest === 'L1'; return ['OK']; }
    if (/^(H[01]|AT[012]|SP[0-9A-C]|D|M[01])$/.test(rest)) return ['OK'];
    if (rest === 'DPN') return [this.searched ? 'A6' : '0'];
    if (rest === 'DP') return ['AUTO, ISO 15765-4 (CAN 11/500)'];
    if (rest === 'RV') return [`${this._value('module_voltage_v').toFixed(1)}V`];
    return ['?'];
  }

  async send(cmd, _timeoutMs) {
    if (!this.connected) throw new Error('Simulator disconnected');
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    if (this.virtualTime) this.vt += this.virtualStepSec;
    const eol = this.linefeeds ? '\r\n' : '\r';
    const lines = this._respond(cmd);
    const body = (this.echo ? [cmd, ...lines] : lines).join(eol);
    return `${body}${eol}${eol}`;
  }

  async close() {
    this.connected = false;
  }
}

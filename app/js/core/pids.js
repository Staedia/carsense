// OBD-II Mode 01 PID definitions: how to decode the bytes a car sends back,
// and how to encode a value into bytes (used by the simulator and tests).

const clampByte = (n) => Math.max(0, Math.min(255, Math.round(n)));
const two = (n) => {
  const x = Math.max(0, Math.min(65535, Math.round(n)));
  return [x >> 8, x & 0xff];
};
const pct = {
  decode: ([a]) => (a * 100) / 255,
  encode: (v) => [clampByte((v * 255) / 100)],
};
const temp = {
  decode: ([a]) => a - 40,
  encode: (v) => [clampByte(v + 40)],
};
const trim = {
  decode: ([a]) => ((a - 128) * 100) / 128,
  encode: (v) => [clampByte((v * 128) / 100 + 128)],
};
const o2 = {
  decode: ([a]) => a / 200,
  encode: (v) => [clampByte(v * 200), 0xff],
};

// once: read a single time per health check (slow-changing values).
// precision: decimal places kept in the summary sent to the AI.
export const PIDS = {
  0x04: { key: 'engine_load_pct', label: 'Engine load', unit: '%', precision: 0, ...pct },
  0x05: { key: 'coolant_temp_c', label: 'Coolant', unit: '°C', precision: 0, ...temp },
  0x06: { key: 'short_term_fuel_trim_pct', label: 'Short fuel trim', unit: '%', precision: 1, ...trim },
  0x07: { key: 'long_term_fuel_trim_pct', label: 'Long fuel trim', unit: '%', precision: 1, ...trim },
  0x0b: {
    key: 'intake_map_kpa', label: 'Intake pressure', unit: 'kPa', precision: 0,
    decode: ([a]) => a, encode: (v) => [clampByte(v)],
  },
  0x0c: {
    key: 'rpm', label: 'RPM', unit: 'rpm', precision: 0,
    decode: ([a, b]) => (256 * a + b) / 4, encode: (v) => two(v * 4),
  },
  0x0d: {
    key: 'speed_kmh', label: 'Speed', unit: 'km/h', precision: 0,
    decode: ([a]) => a, encode: (v) => [clampByte(v)],
  },
  0x0e: {
    key: 'timing_advance_deg', label: 'Timing advance', unit: '°', precision: 1,
    decode: ([a]) => a / 2 - 64, encode: (v) => [clampByte((v + 64) * 2)],
  },
  0x0f: { key: 'intake_air_temp_c', label: 'Intake air', unit: '°C', precision: 0, ...temp },
  0x10: {
    key: 'maf_gps', label: 'Air flow', unit: 'g/s', precision: 2,
    decode: ([a, b]) => (256 * a + b) / 100, encode: (v) => two(v * 100),
  },
  0x11: { key: 'throttle_pct', label: 'Throttle', unit: '%', precision: 1, ...pct },
  0x14: { key: 'o2_b1s1_v', label: 'O2 sensor (front)', unit: 'V', precision: 2, ...o2 },
  0x15: { key: 'o2_b1s2_v', label: 'O2 sensor (rear)', unit: 'V', precision: 2, ...o2 },
  0x1f: {
    key: 'engine_run_time_s', label: 'Engine running for', unit: 's', precision: 0, once: true,
    decode: ([a, b]) => 256 * a + b, encode: (v) => two(v),
  },
  0x21: {
    key: 'distance_with_mil_km', label: 'Distance with warning light on', unit: 'km', precision: 0, once: true,
    decode: ([a, b]) => 256 * a + b, encode: (v) => two(v),
  },
  0x2f: { key: 'fuel_level_pct', label: 'Fuel level', unit: '%', precision: 0, once: true, ...pct },
  0x30: {
    key: 'warmups_since_codes_cleared', label: 'Warm-ups since codes cleared', unit: '', precision: 0, once: true,
    decode: ([a]) => a, encode: (v) => [clampByte(v)],
  },
  0x31: {
    key: 'distance_since_codes_cleared_km', label: 'Distance since codes cleared', unit: 'km', precision: 0, once: true,
    decode: ([a, b]) => 256 * a + b, encode: (v) => two(v),
  },
  0x3c: {
    key: 'catalyst_temp_c', label: 'Catalyst temp', unit: '°C', precision: 0,
    decode: ([a, b]) => (256 * a + b) / 10 - 40, encode: (v) => two((v + 40) * 10),
  },
  0x42: {
    key: 'module_voltage_v', label: 'Battery', unit: 'V', precision: 2,
    decode: ([a, b]) => (256 * a + b) / 1000, encode: (v) => two(v * 1000),
  },
  0x44: {
    key: 'commanded_lambda', label: 'Target air-fuel (λ)', unit: '', precision: 2,
    decode: ([a, b]) => ((256 * a + b) * 2) / 65536, encode: (v) => two((v * 65536) / 2),
  },
  0x46: { key: 'ambient_temp_c', label: 'Outside air', unit: '°C', precision: 0, once: true, ...temp },
  0x5c: { key: 'oil_temp_c', label: 'Oil temp', unit: '°C', precision: 0, ...temp },
  0x5e: {
    key: 'fuel_rate_lph', label: 'Fuel rate', unit: 'L/h', precision: 2,
    decode: ([a, b]) => (256 * a + b) / 20, encode: (v) => two(v * 20),
  },
};

// Values that don't come from a Mode 01 PID but are summarised the same way.
export const EXTRA_DEFS = {
  adapter_voltage_v: { label: 'Battery (at dongle)', unit: 'V', precision: 2 },
};

/** Definition (label, unit, precision) for any reading key. */
export function defByKey(key) {
  return EXTRA_DEFS[key] || Object.values(PIDS).find((d) => d.key === key) || null;
}

export const PID_BY_KEY = Object.fromEntries(
  Object.entries(PIDS).map(([pid, def]) => [def.key, { pid: Number(pid), ...def }]),
);

// PID 0x01: warning light (MIL) state, number of stored codes, and the
// readiness of the car's built-in emissions self-tests ("monitors").
// Byte B: continuous monitors (bits 0-2 available, bits 4-6 NOT complete),
// bit 3 = diesel. Bytes C/D: non-continuous monitors, C = available,
// D = NOT complete. Names differ for petrol (spark) and diesel engines.
const CONTINUOUS = ['misfire', 'fuel system', 'components'];
const SPARK = ['catalyst', 'heated catalyst', 'evaporative system', 'secondary air', null, 'O2 sensor', 'O2 sensor heater', 'EGR / VVT'];
const DIESEL = ['NMHC catalyst', 'NOx / SCR', null, 'boost pressure', null, 'exhaust gas sensor', 'particulate filter', 'EGR / VVT'];

export function decodeMonitorStatus([a, b = 0, c = 0, d = 0]) {
  const diesel = Boolean(b & 0x08);
  const monitors = [];
  CONTINUOUS.forEach((name, i) => {
    if (b & (1 << i)) monitors.push({ name, complete: !(b & (0x10 << i)) });
  });
  (diesel ? DIESEL : SPARK).forEach((name, i) => {
    if (name && c & (1 << i)) monitors.push({ name, complete: !(d & (1 << i)) });
  });
  return { milOn: Boolean(a & 0x80), dtcCount: a & 0x7f, diesel, monitors };
}

/** incomplete: monitor names that haven't finished (simulator / tests). */
export function encodeMonitorStatus({ milOn, dtcCount, incomplete = [] }) {
  const has = (n) => incomplete.includes(n);
  let b = 0x07;
  CONTINUOUS.forEach((n, i) => { if (has(n)) b |= 0x10 << i; });
  const c = 0x65; // catalyst, evap, O2 sensor, O2 heater: typical petrol car
  let d = 0;
  SPARK.forEach((n, i) => { if (n && has(n) && c & (1 << i)) d |= 1 << i; });
  return [(milOn ? 0x80 : 0) | (dtcCount & 0x7f), b, c, d];
}

// Mode 06 (on-board test results, CAN cars): the car's own misfire counters.
// MID 0xA2..0xAD = cylinders 1..12. Each 9-byte record is
// MID, TID, unit/scaling ID, value(2), min(2), max(2).
// TID 0x0B = average over the last 10 drives, 0x0C = last/current drive.
export function parseMode06Records(bytes) {
  const out = [];
  if (bytes[0] !== 0x46) return out;
  for (let i = 1; i + 9 <= bytes.length; i += 9) {
    const [mid, tid, uasid, v1, v2, n1, n2, x1, x2] = bytes.slice(i, i + 9);
    out.push({ mid, tid, uasid, value: 256 * v1 + v2, min: 256 * n1 + n2, max: 256 * x1 + x2 });
  }
  return out;
}

// Mode 09 PID 02: the VIN, 17 ASCII characters.
export function decodeVin(responses) {
  let bytes = [];
  for (const r of responses) {
    if (r[0] !== 0x49 || r[1] !== 0x02) continue;
    // CAN: one reassembled message "49 02 01 <17 chars>".
    // Older protocols: five lines "49 02 <n> <4 bytes>".
    bytes = bytes.concat(r.slice(3)); // skip 49 02 and the count/sequence byte
  }
  const text = String.fromCharCode(...bytes.filter((b) => b >= 0x30 && b <= 0x5a));
  const vin = text.slice(-17);
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

// VIN character 10 is the model year; the letters repeat every 30 years,
// so pick the most recent year that isn't in the future.
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';
export function vinModelYear(vin, thisYear = new Date().getFullYear()) {
  const i = YEAR_CODES.indexOf(vin?.[9]);
  if (i < 0) return null;
  let year = 1980 + i;
  while (year + 30 <= thisYear + 1) year += 30;
  return year;
}

// PIDs 0x00 / 0x20 / 0x40 return a 32-bit map of which PIDs the car supports.
export function decodeSupportedBitmap(base, bytes) {
  const out = [];
  for (let i = 0; i < 32; i++) {
    if (bytes[i >> 3] & (0x80 >> (i & 7))) out.push(base + i + 1);
  }
  return out;
}
export function encodeSupportedBitmap(base, supported) {
  const bytes = [0, 0, 0, 0];
  for (const pid of supported) {
    const i = pid - base - 1;
    if (i >= 0 && i < 32) bytes[i >> 3] |= 0x80 >> (i & 7);
  }
  return bytes;
}

export const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

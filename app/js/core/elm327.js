// Talks the ELM327 command language that nearly every cheap OBD-II dongle
// (Veepeak, vLinker, OBDLink, clones) speaks. Works over any "transport"
// that has: send(command, timeoutMs) -> Promise<string>  (text before '>')
// The Bluetooth transport and the simulator both implement that.

import {
  PIDS, decodeMonitorStatus, decodeSupportedBitmap, parseMode06Records, decodeVin, hex2,
} from './pids.js';
import { parseDtcBytes } from './dtc.js';

const ERRORS = [
  'NO DATA', 'UNABLE TO CONNECT', 'CAN ERROR', 'BUS ERROR', 'BUS BUSY',
  'STOPPED', 'ERROR', 'BUFFER FULL', 'FB ERROR', 'DATA ERROR', '?',
];
const NOISE = /^(SEARCHING\.*|BUS INIT:?\s*\.*\s*(OK)?|OK)$/i;

export class ObdError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ObdError';
    this.code = code;
  }
}

const strip = (s) => s.replace(/\s+/g, '').toUpperCase();

// Split raw dongle text into meaningful lines, dropping echo and status noise.
export function cleanLines(raw, sentCommand = '') {
  const echo = strip(sentCommand);
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/>/g, '').trim())
    .filter((l) => l && !NOISE.test(l) && (!echo || strip(l) !== echo));
}

export function findError(lines) {
  for (const line of lines) {
    const up = line.toUpperCase();
    const hit = ERRORS.find((e) => (e === '?' ? up === '?' : up.includes(e)));
    if (hit) return hit;
  }
  return null;
}

const isHex = (s) => /^[0-9A-F]+$/.test(s) && s.length % 2 === 0;
const toBytes = (s) => s.match(/../g).map((h) => parseInt(h, 16));

// Turn response lines into one byte array per responding ECU.
// Handles ISO-TP multi-frame replies ("00A", "0: 43 ...", "1: ...").
export function parseResponses(lines) {
  const multi = lines.some((l) => /^[0-9A-F]\s*:/i.test(l));
  if (multi) {
    let length = null;
    const frames = [];
    for (const line of lines) {
      const m = line.match(/^([0-9A-F])\s*:\s*(.*)$/i);
      if (m) frames.push({ idx: parseInt(m[1], 16), data: strip(m[2]) });
      else if (/^[0-9A-F]{3}$/i.test(strip(line))) length = parseInt(strip(line), 16);
    }
    // Frame indexes wrap 0..F; keep arrival order.
    const hex = frames.map((f) => f.data).join('');
    if (!isHex(hex)) return [];
    const bytes = toBytes(hex);
    return [length ? bytes.slice(0, length) : bytes];
  }
  return lines.map(strip).filter(isHex).map(toBytes);
}

export class Elm327 {
  constructor(transport, { log } = {}) {
    this.transport = transport;
    this.log = log || (() => {});
    this.protocol = null;
    this.isCan = true;
    this.version = '';
    this.supported = new Set();
  }

  async command(cmd, timeoutMs = 5000) {
    const raw = await this.transport.send(cmd, timeoutMs);
    this.log(`> ${cmd}`, raw);
    return cleanLines(raw, cmd);
  }

  async init() {
    const reset = await this.command('ATZ', 6000);
    this.version = reset.find((l) => /ELM|OBD|V\d/i.test(l)) || reset.join(' ');
    for (const at of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATSP0']) {
      await this.command(at, 3000); // some clones reject ATS0/ATAT1; that's fine
    }

    // First real request triggers the protocol search, which can take a while.
    const first = await this.command('0100', 15000);
    const err = findError(first);
    if (err) {
      if (/UNABLE TO CONNECT|NO DATA|BUS|CAN ERROR/.test(err)) {
        throw new ObdError(
          "The dongle is connected but the car didn't answer. Turn the ignition ON (or start the engine) and try again.",
          'NO_CAR',
        );
      }
      throw new ObdError(`Dongle error during setup: ${err}`, 'INIT');
    }

    const dpn = await this.command('ATDPN', 3000);
    const p = strip(dpn[0] || '').replace(/^A/, '');
    this.protocol = p || null;
    this.isCan = ['6', '7', '8', '9', 'A', 'B', 'C'].includes(p) || !p;

    await this._readSupported(first);
    return {
      version: this.version,
      protocol: this.protocol,
      isCan: this.isCan,
      supported: [...this.supported].filter((p) => p % 0x20 !== 0),
    };
  }

  async _readSupported(firstLines) {
    let lines = firstLines;
    for (const base of [0x00, 0x20, 0x40]) {
      if (base !== 0x00) {
        if (!this.supported.has(base)) break;
        lines = await this.command(`01${hex2(base)}`);
        if (findError(lines)) break;
      }
      for (const bytes of parseResponses(lines)) {
        if (bytes[0] === 0x41 && bytes[1] === base && bytes.length >= 6) {
          for (const pid of decodeSupportedBitmap(base, bytes.slice(2, 6))) this.supported.add(pid);
        }
      }
    }
  }

  supports(pid) {
    return this.supported.has(pid);
  }

  async readRaw(pid) {
    const lines = await this.command(`01${hex2(pid)}`);
    if (findError(lines)) return null;
    for (const bytes of parseResponses(lines)) {
      if (bytes[0] === 0x41 && bytes[1] === pid) return bytes.slice(2);
    }
    return null;
  }

  async readPid(pid) {
    const def = PIDS[pid];
    if (!def) throw new Error(`Unknown PID ${hex2(pid)}`);
    const data = await this.readRaw(pid);
    if (!data || data.length === 0) return null;
    const value = def.decode(data);
    return Number.isFinite(value) ? value : null;
  }

  async readMonitorStatus() {
    const data = await this.readRaw(0x01);
    return data ? decodeMonitorStatus(data) : null;
  }

  /**
   * Battery voltage measured by the dongle itself (ATRV). Works on any car,
   * even with the engine off, because the OBD port is wired to the battery.
   * Cheap dongles are only accurate to about ±0.2 V.
   */
  async readAdapterVoltage(timeoutMs = 2000) {
    const lines = await this.command('ATRV', timeoutMs);
    for (const l of lines) {
      const m = l.match(/^(\d{1,2}(?:\.\d+)?)\s*V?$/i);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 3 && v < 20) return v;
      }
    }
    return null;
  }

  /**
   * Per-cylinder misfire counters from Mode 06 (CAN cars only). Many cars
   * count misfires long before they set a P030x code.
   * Returns { cylinders, recent: [...], avg10: [...] } or null.
   */
  async readMisfireCounts() {
    if (!this.isCan) return null;
    const lines = await this.command('06A0', 5000);
    if (findError(lines)) return null;
    const mids = [];
    for (const bytes of parseResponses(lines)) {
      if (bytes[0] === 0x46 && bytes[1] === 0xa0 && bytes.length >= 6) {
        mids.push(...decodeSupportedBitmap(0xa0, bytes.slice(2, 6)).filter((m) => m >= 0xa2 && m <= 0xad));
      }
    }
    if (!mids.length) return null;
    const cylinders = Math.max(...mids) - 0xa1;
    const recent = Array(cylinders).fill(null);
    const avg10 = Array(cylinders).fill(null);
    for (const mid of mids) {
      const resp = await this.command(`06${hex2(mid)}`, 5000);
      if (findError(resp)) continue;
      for (const bytes of parseResponses(resp)) {
        for (const r of parseMode06Records(bytes)) {
          if (r.mid !== mid || r.uasid !== 0x24) continue; // 0x24 = plain counts
          if (r.tid === 0x0c) recent[mid - 0xa2] = r.value;
          if (r.tid === 0x0b) avg10[mid - 0xa2] = r.value;
        }
      }
    }
    if (recent.every((v) => v == null) && avg10.every((v) => v == null)) return null;
    return { cylinders, recent, avg10 };
  }

  /** Vehicle Identification Number (Mode 09), or null if the car won't say. */
  async readVin() {
    if (this.vin !== undefined) return this.vin;
    const lines = await this.command('0902', 5000);
    this.vin = findError(lines) ? null : decodeVin(parseResponses(lines));
    return this.vin;
  }

  // mode: '03' stored codes, '07' pending codes
  async readDtcs(mode = '03') {
    const lines = await this.command(mode, 8000);
    const err = findError(lines);
    if (err === 'NO DATA') return [];
    if (err) return [];
    const expect = parseInt(mode, 16) + 0x40;
    const codes = new Set();
    for (const bytes of parseResponses(lines)) {
      if (bytes[0] === expect) parseDtcBytes(bytes, this.isCan).forEach((c) => codes.add(c));
    }
    return [...codes];
  }
}

// Trip log: distance, time, idling, speed and fuel for one drive, worked out
// from the live readings. Fuel comes from FuelTracker (fuel-rate sensor, or
// estimated from air flow). Everything stays on the phone.

import { FuelTracker } from './fuel.js';

const MAX_GAP_SEC = 10; // a longer gap means polling stopped (app in background etc.)

export class TripRecorder {
  constructor({ fuel = 'petrol', startedAt = Date.now() } = {}) {
    this.startedAt = startedAt;
    this.fuel = new FuelTracker({ fuel });
    this.km = 0;
    this.movingSec = 0;
    this.idleSec = 0;
    this.maxSpeed = 0;
    this.gapSec = 0; // time we missed (screen off, etc.)
    this.lastSpeed = null; // { t, v }
    this.rpm = null;
    this.firstT = null;
    this.lastT = null;
  }

  /** key: reading key, t: time in seconds (any clock, as long as it's consistent). */
  update(key, value, t) {
    this.firstT ??= t;
    this.lastT = Math.max(this.lastT ?? t, t);
    this.fuel.update(key, value, t);
    if (key === 'rpm') this.rpm = value;
    if (key !== 'speed_kmh') return;
    this.maxSpeed = Math.max(this.maxSpeed, value);
    if (this.lastSpeed) {
      const dt = t - this.lastSpeed.t;
      if (dt > MAX_GAP_SEC) {
        this.gapSec += dt;
      } else if (dt > 0) {
        this.km += (((this.lastSpeed.v + value) / 2) * dt) / 3600; // trapezoid
        if (value >= 2) this.movingSec += dt;
        else if (this.rpm == null || this.rpm > 300) this.idleSec += dt;
      }
    }
    this.lastSpeed = { t, v: value };
  }

  summary() {
    const durationSec = this.lastT != null ? this.lastT - this.firstT : 0;
    const f = this.fuel.trip;
    const hasFuel = f.seconds > 0;
    return {
      startedAt: this.startedAt,
      durationSec: Math.round(durationSec),
      distanceKm: round(this.km, 2),
      movingSec: Math.round(this.movingSec),
      idleSec: Math.round(this.idleSec),
      maxSpeedKmh: Math.round(this.maxSpeed),
      avgSpeedKmh: this.movingSec > 0 ? round((this.km / this.movingSec) * 3600, 1) : null,
      litres: hasFuel ? round(f.litres, 3) : null,
      l100km: hasFuel && this.km >= 0.2 ? round((f.litres / this.km) * 100, 2) : null,
      missedSec: Math.round(this.gapSec),
    };
  }
}

const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Cost of a trip, or null when we don't know the fuel or the price. */
export function tripCost(litres, pricePerLitre) {
  return litres != null && pricePerLitre > 0 ? round(litres * pricePerLitre, 2) : null;
}

/** Add up a list of saved trips. */
export function tripTotals(trips) {
  const t = { count: trips.length, distanceKm: 0, durationSec: 0, litres: 0, cost: 0, fuelKm: 0 };
  for (const x of trips) {
    t.distanceKm += x.distanceKm || 0;
    t.durationSec += x.durationSec || 0;
    if (x.litres != null) { t.litres += x.litres; t.fuelKm += x.distanceKm || 0; }
    if (x.cost != null) t.cost += x.cost;
  }
  t.l100km = t.fuelKm >= 0.2 ? round((t.litres / t.fuelKm) * 100, 2) : null;
  return t;
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Trips as CSV, for a spreadsheet or a mechanic. */
export function tripsCsv(trips) {
  const head = ['start', 'duration_min', 'distance_km', 'avg_speed_kmh', 'max_speed_kmh', 'idle_min', 'fuel_litres', 'l_per_100km', 'cost', 'price_per_litre'];
  const rows = trips.map((t) => [
    new Date(t.startedAt).toISOString(),
    round((t.durationSec || 0) / 60, 1),
    t.distanceKm, t.avgSpeedKmh, t.maxSpeedKmh,
    round((t.idleSec || 0) / 60, 1),
    t.litres, t.l100km, t.cost, t.pricePerLitre,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

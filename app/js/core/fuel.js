// Fuel economy, worked out from sensors the car already reports.
//
// If the car reports fuel rate (PID 0x5E) we use it directly. Otherwise we
// estimate it from the air flow sensor: a petrol engine burns about 1 g of
// fuel per 14.7 g of air (scaled by the target air-fuel ratio, lambda, if the
// car reports it), and petrol weighs about 745 g per litre. That's typically
// within 5-10% of the real figure: fine for "how am I doing", not for the
// tax return. Diesels run with varying excess air, so without PID 0x5E we
// don't guess.

const STOICH_AFR = 14.7;
const PETROL_G_PER_L = 745;
const WINDOW_SEC = 5; // smoothing for the "right now" figure
const MAX_GAP_SEC = 5; // ignore gaps longer than this (paused polling etc.)

/** Litres per hour from mass air flow (g/s), for a petrol engine. */
export function litresPerHourFromMaf(mafGps, lambda = 1) {
  const afr = STOICH_AFR * (lambda > 0.5 && lambda < 2 ? lambda : 1);
  return (mafGps / afr / PETROL_G_PER_L) * 3600;
}

export const FUEL_UNITS = {
  l100km: { label: 'L/100 km', fromL100: (x) => x },
  mpg_uk: { label: 'mpg (UK)', fromL100: (x) => 282.481 / x },
  mpg_us: { label: 'mpg (US)', fromL100: (x) => 235.215 / x },
  kml: { label: 'km/L', fromL100: (x) => 100 / x },
};

/**
 * Feed it readings as they arrive; ask it for the current and trip figures.
 *   const f = new FuelTracker({ fuel: 'petrol' });
 *   f.update('maf_gps', 12.3, tSeconds) ... f.current()
 */
export class FuelTracker {
  constructor({ fuel = 'petrol' } = {}) {
    this.canEstimate = fuel !== 'diesel';
    this.reset();
  }

  reset() {
    this.last = {};
    this.lastT = null;
    this.window = []; // { t, litres, km }
    this.trip = { litres: 0, km: 0, seconds: 0 };
  }

  /** Litres per hour right now, or null if we can't tell. */
  _rateLph() {
    if (this.last.fuel_rate_lph != null) return this.last.fuel_rate_lph;
    if (this.canEstimate && this.last.maf_gps != null) {
      return litresPerHourFromMaf(this.last.maf_gps, this.last.commanded_lambda);
    }
    return null;
  }

  /** key: a reading key; t: time in seconds. Integrates on each air-flow or fuel-rate reading. */
  update(key, value, t) {
    this.last[key] = value;
    const driver = this.last.fuel_rate_lph != null ? 'fuel_rate_lph' : 'maf_gps';
    if (key !== driver) return;
    const lph = this._rateLph();
    if (lph == null) return;
    if (this.lastT != null) {
      const dt = t - this.lastT;
      if (dt > 0 && dt <= MAX_GAP_SEC) {
        const litres = (lph * dt) / 3600;
        const km = ((this.last.speed_kmh || 0) * dt) / 3600;
        this.trip.litres += litres;
        this.trip.km += km;
        this.trip.seconds += dt;
        this.window.push({ t, dt, litres, km });
      }
    }
    this.lastT = t;
    while (this.window.length && this.window[0].t < t - WINDOW_SEC) this.window.shift();
  }

  /**
   * { lph, l100km, moving } for the last few seconds. When the car is
   * (nearly) stopped, distance-based economy is meaningless, so moving=false
   * and only lph is useful.
   */
  current() {
    if (!this.window.length) {
      const lph = this._rateLph();
      return lph == null ? null : { lph, l100km: null, moving: false };
    }
    const litres = this.window.reduce((a, w) => a + w.litres, 0);
    const km = this.window.reduce((a, w) => a + w.km, 0);
    const secs = this.window.reduce((a, w) => a + w.dt, 0);
    const lph = secs > 0 ? (litres / secs) * 3600 : this._rateLph();
    const avgSpeed = secs > 0 ? (km / secs) * 3600 : 0;
    const moving = avgSpeed >= 5;
    return { lph, l100km: moving && km > 0 ? (litres / km) * 100 : null, moving };
  }

  /** Average since the live view started: { litres, km, l100km }. */
  tripSummary() {
    const { litres, km } = this.trip;
    return { litres, km, l100km: km >= 0.2 ? (litres / km) * 100 : null };
  }
}

/** "6.8 L/100 km", "41.5 mpg (UK)" etc. */
export function formatEconomy(l100km, unit = 'l100km') {
  const u = FUEL_UNITS[unit] || FUEL_UNITS.l100km;
  if (l100km == null || !(l100km > 0)) return null;
  const v = u.fromL100(l100km);
  return { value: v >= 100 ? Math.round(v) : v.toFixed(1), unit: u.label };
}

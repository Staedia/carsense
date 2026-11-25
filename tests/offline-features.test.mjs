// Offline features that need no AI: trouble-code library, freeze frame, trip log.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { explainDtc, FAMILIES, LIBRARY_SIZE, normalizeCode } from '../app/js/core/dtc-library.js';
import { describeDtc } from '../app/js/core/dtc.js';
import { Elm327 } from '../app/js/core/elm327.js';
import { SimulatedElm } from '../app/js/core/simulator.js';
import { runHealthCheck } from '../app/js/core/scan.js';
import { ruleBasedReport } from '../app/js/core/rules.js';
import { describeFreezeFrame } from '../app/js/core/freeze-frame.js';
import { TripRecorder, tripCost, tripTotals, tripsCsv } from '../app/js/core/trip.js';
import { litresPerHourFromMaf } from '../app/js/core/fuel.js';

const VEHICLE = { make: 'MG', model: 'ZS', year: 2019, fuel: 'petrol' };

async function scan(scenario, mutate) {
  const sim = new SimulatedElm({ scenario, virtualTime: true });
  mutate?.(sim);
  const elm = new Elm327(sim);
  await elm.init();
  const summary = await runHealthCheck(elm, { vehicle: VEHICLE, durationSec: 20, now: () => sim.now() });
  return { sim, elm, summary };
}

test('code library: patterned titles follow the SAE numbering', () => {
  assert.ok(LIBRARY_SIZE > 350, `only ${LIBRARY_SIZE} codes`);
  const expect = {
    P0301: 'Cylinder 1 misfire detected',
    P0312: 'Cylinder 12 misfire detected',
    P0204: 'Injector circuit/open, cylinder 4',
    P0264: 'Injector circuit low, cylinder 2',
    P0272: 'Injector contribution/balance, cylinder 4',
    P0351: 'Ignition coil A primary/secondary circuit',
    P0362: 'Ignition coil L primary/secondary circuit',
    P0133: 'O2 sensor slow response (bank 1, sensor 1)',
    P0141: 'O2 sensor heater circuit (bank 1, sensor 2)',
    P0157: 'O2 sensor circuit low voltage (bank 2, sensor 2)',
    P0032: 'O2 sensor heater control circuit high (bank 1, sensor 1)',
    P0118: 'Engine coolant temperature sensor circuit high',
    P0122: 'Throttle/pedal position sensor A circuit low',
    P0339: 'Crankshaft position sensor A circuit intermittent',
    P0755: 'Shift solenoid B',
    P0524: 'Engine oil pressure too low',
  };
  for (const [code, title] of Object.entries(expect)) assert.equal(explainDtc(code).title, title, code);
  // Codes that break the pattern are not guessed
  assert.equal(explainDtc('P0534').known, false);
  assert.equal(explainDtc('P0239').known, false);
});

test('code library: every family is complete and every code points at one', () => {
  for (const [id, f] of Object.entries(FAMILIES)) {
    if (id === 'makerSpecific') continue;
    assert.ok(f.name && f.meaning && f.checks.length && f.causes.length, id);
    assert.ok(['stop', 'high', 'medium', 'low'].includes(f.severity), id);
    assert.ok(['yes', 'with caution', 'no'].includes(f.drive), id);
  }
  for (const code of ['P0171', 'P0420', 'P0455', 'U0121', 'P2187', 'P0087']) {
    assert.ok(explainDtc(code).family?.meaning, code);
  }
  assert.equal(explainDtc('P0217').family.drive, 'no');
});

test('code library: input handling and unknown codes', () => {
  assert.equal(normalizeCode(' p0420 '), 'P0420');
  assert.equal(normalizeCode('P042'), null);
  assert.equal(normalizeCode('X0420'), null);
  assert.equal(explainDtc('hello'), null);
  assert.equal(explainDtc('P1A23').family.id, 'makerSpecific');
  assert.equal(explainDtc('B1234').family.id, 'makerSpecific');
  const generic = explainDtc('C0035');
  assert.equal(generic.known, false);
  assert.equal(generic.family, null);
  // The older description lookup now uses the library first
  assert.equal(describeDtc('P0357').description, 'Ignition coil G primary/secondary circuit');
});

test('rules use the library for codes without a dedicated rule', async () => {
  const { summary } = await scan('healthy', (sim) => {
    sim.scenario = { ...sim.scenario, stored: ['P0524'], milOn: true };
  });
  const r = ruleBasedReport(summary);
  assert.equal(r.status, 'Needs attention');
  assert.equal(r.safe_to_drive, 'no');
  assert.match(r.safety_warning, /P0524/);
  assert.match(r.likely_causes[0].cause, /oil pressure/i);

  const evap = await scan('healthy', (sim) => {
    sim.scenario = { ...sim.scenario, stored: ['P0455'], milOn: true };
  });
  const r2 = ruleBasedReport(evap.summary);
  assert.equal(r2.status, 'Watch');
  assert.equal(r2.safe_to_drive, 'yes');
  assert.ok(r2.checks.some((c) => /fuel cap/i.test(c)));
});

test('freeze frame: read through the simulator and described', async () => {
  const { elm } = await scan('misfire');
  const ff = await elm.readFreezeFrame();
  assert.equal(ff.code, 'P0302');
  assert.equal(ff.values.rpm, 2210);
  assert.equal(ff.values.speed_kmh, 64);
  assert.equal(describeFreezeFrame(ff.values), 'Set at 64 km/h with a warm engine (87°C), 2,210 rpm, 47% load.');
  assert.equal(describeFreezeFrame({ speed_kmh: 0, rpm: 800, coolant_temp_c: 30 }), 'Set while idling with a cold engine (30°C), 800 rpm.');
  assert.equal(describeFreezeFrame({}), '');
  const healthy = await scan('healthy');
  assert.equal(await healthy.elm.readFreezeFrame(), null);
});

test('freeze frame: in the summary and the rules', async () => {
  const { summary } = await scan('catalyst');
  assert.equal(summary.freeze_frame.code, 'P0420');
  assert.equal(summary.freeze_frame.speed_kmh, 102);
  const r = ruleBasedReport(summary);
  assert.match(r.likely_causes.find((c) => /Catalytic/.test(c.cause)).reason, /P0420 was set at 102 km\/h/);
  const healthy = await scan('healthy');
  assert.equal(healthy.summary.freeze_frame, undefined);
  assert.ok(JSON.stringify(summary).length < 3200);
});

test('trip recorder: distance, time, idle and fuel', () => {
  const trip = new TripRecorder({ startedAt: 0 });
  // 60 s idle, then 120 s at 60 km/h, sampled every second
  let t = 0;
  for (; t <= 60; t++) { trip.update('rpm', 800, t); trip.update('speed_kmh', 0, t); trip.update('maf_gps', 2.6, t); }
  for (; t <= 180; t++) { trip.update('rpm', 2000, t); trip.update('speed_kmh', 60, t); trip.update('maf_gps', 10, t); }
  const s = trip.summary();
  assert.equal(s.durationSec, 180);
  assert.ok(Math.abs(s.distanceKm - 2.0) < 0.02, `distance ${s.distanceKm}`); // 2 min at 60 km/h (+ ramp)
  assert.equal(s.idleSec, 60);
  assert.equal(s.maxSpeedKmh, 60);
  assert.ok(Math.abs(s.avgSpeedKmh - 60) < 0.5, `avg ${s.avgSpeedKmh}`);
  const expectedLitres = (litresPerHourFromMaf(2.6) * 60 + litresPerHourFromMaf(10) * 120) / 3600;
  assert.ok(Math.abs(s.litres - expectedLitres) < 0.003, `${s.litres} vs ${expectedLitres}`);
  assert.ok(s.l100km > 5 && s.l100km < 8);
});

test('trip recorder: a long gap (app paused) is not counted as distance', () => {
  const trip = new TripRecorder();
  trip.update('speed_kmh', 100, 0);
  trip.update('speed_kmh', 100, 1);
  trip.update('speed_kmh', 100, 301); // 5 minutes with no data
  trip.update('speed_kmh', 100, 302);
  const s = trip.summary();
  assert.ok(s.distanceKm < 0.1, `${s.distanceKm}`);
  assert.equal(s.missedSec, 300);
  assert.equal(s.litres, null); // no air flow data, so no fuel figure
});

test('trip cost, totals and CSV', () => {
  assert.equal(tripCost(2.5, 1.95), 4.88);
  assert.equal(tripCost(null, 1.95), null);
  assert.equal(tripCost(2.5, null), null);
  const trips = [
    { startedAt: Date.UTC(2026, 10, 25, 8), durationSec: 1200, distanceKm: 15, idleSec: 120, maxSpeedKmh: 80, avgSpeedKmh: 45, litres: 1.2, l100km: 8, cost: 2.34, pricePerLitre: 1.95 },
    { startedAt: Date.UTC(2026, 10, 25, 17), durationSec: 600, distanceKm: 5, idleSec: 0, maxSpeedKmh: 60, avgSpeedKmh: 30, litres: null, l100km: null, cost: null, pricePerLitre: null },
  ];
  const tot = tripTotals(trips);
  assert.equal(tot.distanceKm, 20);
  assert.equal(tot.l100km, 8); // only trips with fuel data count towards economy
  assert.equal(tot.cost, 2.34);
  const csv = tripsCsv(trips).trim().split('\n');
  assert.equal(csv.length, 3);
  assert.match(csv[0], /^start,duration_min,distance_km/);
  assert.equal(csv[1], '2026-11-25T08:00:00.000Z,20,15,45,80,2,1.2,8,2.34,1.95');
  assert.equal(csv[2], '2026-11-25T17:00:00.000Z,10,5,30,60,0,,,,');
});

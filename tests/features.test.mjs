// Driver-facing extras: readiness monitors, misfire counters, VIN,
// dongle voltage, fuel economy and the battery test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PIDS, decodeMonitorStatus, encodeMonitorStatus, parseMode06Records, decodeVin, vinModelYear,
} from '../app/js/core/pids.js';
import { Elm327, cleanLines, parseResponses } from '../app/js/core/elm327.js';
import { SimulatedElm, DEFAULT_SUPPORTED } from '../app/js/core/simulator.js';
import { runHealthCheck } from '../app/js/core/scan.js';
import { ruleBasedReport, misfireOutlier } from '../app/js/core/rules.js';
import { FuelTracker, litresPerHourFromMaf, formatEconomy } from '../app/js/core/fuel.js';
import { runBatteryTest, assessBattery } from '../app/js/core/battery.js';

const VEHICLE = { make: 'MG', model: 'ZS', year: 2019, fuel: 'petrol' };

async function connect(scenario, opts = {}) {
  const sim = new SimulatedElm({ scenario, virtualTime: true, ...opts });
  const elm = new Elm327(sim);
  await elm.init();
  return { sim, elm };
}
async function scan(scenario, opts = {}, checkOpts = {}) {
  const { sim, elm } = await connect(scenario, opts);
  const summary = await runHealthCheck(elm, { vehicle: VEHICLE, durationSec: 30, now: () => sim.now(), ...checkOpts });
  return { sim, elm, summary };
}

test('new PIDs decode and round trip', () => {
  assert.equal(PIDS[0x1f].decode([0x03, 0x48]), 840);
  assert.equal(PIDS[0x30].decode([0x0c]), 12);
  assert.equal(PIDS[0x3c].decode([0x11, 0x94]), 410); // 4500/10 - 40
  assert.equal(PIDS[0x44].decode([0x80, 0x00]), 1);
  assert.equal(PIDS[0x5e].decode([0x00, 0x32]), 2.5);
  for (const [pid, v] of [[0x3c, 512.3], [0x44, 0.97], [0x5e, 6.35], [0x1f, 1200]]) {
    assert.ok(Math.abs(PIDS[pid].decode(PIDS[pid].encode(v)) - v) < 0.1, `PID ${pid}`);
  }
});

test('readiness monitors decode (petrol and diesel)', () => {
  const st = decodeMonitorStatus(encodeMonitorStatus({ milOn: true, dtcCount: 2, incomplete: ['catalyst', 'evaporative system'] }));
  assert.equal(st.milOn, true);
  assert.equal(st.dtcCount, 2);
  assert.equal(st.diesel, false);
  assert.deepEqual(st.monitors.filter((m) => !m.complete).map((m) => m.name), ['catalyst', 'evaporative system']);
  assert.equal(st.monitors.length, 7);
  // Diesel: byte B bit 3 set; C = 0x40 particulate filter available; D = 0x40 not complete
  const d = decodeMonitorStatus([0x00, 0x0f, 0x40, 0x40]);
  assert.equal(d.diesel, true);
  assert.deepEqual(d.monitors.find((m) => m.name === 'particulate filter'), { name: 'particulate filter', complete: false });
  // Old cars that only send one byte still work
  assert.deepEqual(decodeMonitorStatus([0x81]).monitors, []);
});

test('Mode 06 records parse from a multi-frame reply', () => {
  const lines = cleanLines('013\r0: 46 A2 0B 24 00 2E\r1: 00 00 FF FF A2 0C 24\r2: 00 BB 00 00 FF FF 00\r\r');
  const [bytes] = parseResponses(lines);
  const recs = parseMode06Records(bytes);
  assert.equal(recs.length, 2);
  assert.deepEqual(recs.map((r) => [r.mid, r.tid, r.uasid, r.value]), [[0xa2, 0x0b, 0x24, 46], [0xa2, 0x0c, 0x24, 187]]);
});

test('misfire counters through the simulator', async () => {
  const { elm } = await connect('misfire');
  assert.deepEqual(await elm.readMisfireCounts(), { cylinders: 4, recent: [3, 187, 1, 0], avg10: [1, 46, 0, 0] });
  const healthy = await connect('healthy');
  assert.equal(misfireOutlier({ last_drive: (await healthy.elm.readMisfireCounts()).recent }), null);
});

test('misfireOutlier picks a single bad cylinder, ignores noise', () => {
  assert.equal(misfireOutlier({ last_drive: [3, 187, 1, 0] }).cylinder, 2);
  assert.equal(misfireOutlier({ last_drive: [2, 5, 3, 1] }), null);
  assert.equal(misfireOutlier({ last_drive: [30, 35, 28, 40] }).allHigh, true);
  assert.equal(misfireOutlier({ last_drive: [null, null, null, null], avg_last_10_drives: [0, 0, 60, 1] }).cylinder, 3);
  assert.equal(misfireOutlier(null), null);
});

test('early misfire without a code becomes a Watch finding', async () => {
  const { summary } = await scan('healthy');
  summary.misfire_counts = { last_drive: [0, 0, 64, 1], avg_last_10_drives: [0, 0, 12, 0] };
  const r = ruleBasedReport(summary);
  assert.equal(r.status, 'Watch');
  assert.match(r.likely_causes[0].cause, /Early signs of a misfire on cylinder 3/);
});

test('VIN: CAN multi-frame and older line-by-line formats', async () => {
  const { elm } = await connect('healthy');
  const vin = await elm.readVin();
  assert.equal(vin, 'LSJA24000KS000001');
  assert.equal(vinModelYear(vin, 2026), 2019);
  // ISO 9141 / KWP style: five lines with a sequence byte, first padded with zeros
  const old = ['490201000000 31', '4902024731594B', '49020335463254', '49020431323334', '49020535363738']
    .map((l) => l.replace(/\s/g, '')).map((h) => h.match(/../g).map((x) => parseInt(x, 16)));
  assert.equal(decodeVin(old), '1G1YK5F2T12345678');
  assert.equal(decodeVin([[0x49, 0x02, 0x01, 0x41]]), null);
  assert.equal(vinModelYear('xxxxxxxxxYxxxxxxx', 2026), 2000);
  assert.equal(vinModelYear('xxxxxxxxxTxxxxxxx', 2026), 2026);
});

test('summary carries VIN prefix only, self-tests and misfire counts', async () => {
  const { summary } = await scan('misfire');
  assert.equal(summary.vehicle.vin_prefix, 'LSJA24000KS');
  assert.ok(!JSON.stringify(summary).includes('LSJA24000KS000001'), 'full VIN must not be sent to the AI');
  assert.deepEqual(summary.emissions_self_tests, { complete: 7, incomplete: [] });
  assert.deepEqual(summary.misfire_counts.last_drive, [3, 187, 1, 0]);
  assert.equal(summary.snapshot.warmups_since_codes_cleared, 212);
  const r = ruleBasedReport(summary);
  assert.match(r.likely_causes[0].reason, /187 misfires on cylinder 2/);
  assert.ok(JSON.stringify(summary).length < 3000);
});

test('recently cleared codes are flagged', async () => {
  const { summary } = await scan('cleared');
  assert.deepEqual(summary.emissions_self_tests.incomplete, ['catalyst', 'evaporative system', 'O2 sensor']);
  const r = ruleBasedReport(summary);
  assert.equal(r.status, 'Watch');
  assert.match(r.likely_causes[0].cause, /cleared recently/);
  assert.match(r.likely_causes[0].reason, /14 km and 2 warm-ups/);
});

test('unfinished self-tests on an old clear are only a note', async () => {
  const { sim, elm } = await connect('healthy');
  sim.scenario = { ...sim.scenario, incomplete: ['evaporative system'] };
  const summary = await runHealthCheck(elm, { vehicle: VEHICLE, durationSec: 20, now: () => sim.now() });
  const r = ruleBasedReport(summary);
  assert.equal(r.status, 'Good');
  assert.ok(r.missing_data.some((m) => m.includes('evaporative system')));
});

test('no PID 0x42: battery comes from the dongle (ATRV) and rules still work', async () => {
  const supported = DEFAULT_SUPPORTED.filter((p) => p !== 0x42);
  const { elm, summary } = await scan('charging', { supported });
  assert.equal(elm.supports(0x42), false);
  assert.equal(summary.readings.module_voltage_v, undefined);
  assert.ok(summary.readings.adapter_voltage_v.avg < 12.5);
  const r = ruleBasedReport(summary);
  assert.match(r.likely_causes[0].cause, /charging/);
  assert.equal(r.missing_data.some((m) => m.includes('Battery voltage')), false);
});

test('ATRV parsing copes with real dongle replies', async () => {
  const fake = (reply) => new Elm327({ send: async () => reply });
  assert.equal(await fake('ATRV\r12.6V\r\r>').readAdapterVoltage(), 12.6);
  assert.equal(await fake('14.1 V\r\r').readAdapterVoltage(), 14.1);
  assert.equal(await fake('?\r\r').readAdapterVoltage(), null);
});

test('fuel maths', () => {
  // Idle: 2.6 g/s of air is about 0.85 L/h of petrol
  assert.ok(Math.abs(litresPerHourFromMaf(2.6) - 0.855) < 0.01);
  // Lambda 2.0+ is treated as invalid and ignored
  assert.equal(litresPerHourFromMaf(10, 5), litresPerHourFromMaf(10, 1));
  assert.deepEqual(formatEconomy(6.5, 'l100km'), { value: '6.5', unit: 'L/100 km' });
  assert.equal(formatEconomy(6.5, 'mpg_uk').value, '43.5');
  assert.equal(formatEconomy(6.5, 'mpg_us').value, '36.2');
  assert.equal(formatEconomy(null), null);
});

test('FuelTracker: steady cruise and idling', () => {
  const f = new FuelTracker({ fuel: 'petrol' });
  // 100 km/h with 20 g/s air flow for 60 s, sampled every 0.5 s
  for (let i = 0; i <= 120; i++) {
    f.update('speed_kmh', 100, i * 0.5);
    f.update('maf_gps', 20, i * 0.5);
  }
  const now = f.current();
  const expected = litresPerHourFromMaf(20); // L/h at 100 km/h == L/100 km
  assert.equal(now.moving, true);
  assert.ok(Math.abs(now.l100km - expected) < 0.01, `${now.l100km} vs ${expected}`);
  const trip = f.tripSummary();
  assert.ok(Math.abs(trip.km - 100 / 60) < 0.01);
  assert.ok(Math.abs(trip.l100km - expected) < 0.01);

  // Stopped: no L/100 km, but still a litres-per-hour figure
  const idle = new FuelTracker();
  for (let i = 0; i < 20; i++) { idle.update('speed_kmh', 0, i); idle.update('maf_gps', 2.6, i); }
  assert.equal(idle.current().moving, false);
  assert.equal(idle.current().l100km, null);
  assert.ok(idle.current().lph > 0.8);

  // Diesel without a fuel-rate PID: we don't guess
  const diesel = new FuelTracker({ fuel: 'diesel' });
  diesel.update('maf_gps', 20, 0);
  assert.equal(diesel.current(), null);
  // ...but a reported fuel rate is used directly
  diesel.update('fuel_rate_lph', 5, 1);
  diesel.update('fuel_rate_lph', 5, 2);
  assert.equal(diesel.current().lph, 5);
});

test('battery test: healthy, weak battery, not charging', async () => {
  const results = {};
  for (const scenario of ['healthy', 'battery', 'charging']) {
    const { sim, elm } = await connect(scenario);
    let prompted = 0;
    const r = await runBatteryTest(elm, {
      now: () => sim.now(),
      waitForEngineOff: async () => { prompted++; sim.setEngine(false); },
      onReadyToCrank: () => sim.crank(),
    });
    assert.equal(prompted, 1, 'asks the driver to switch off once');
    assert.equal(r.started, true);
    results[scenario] = { r, a: assessBattery(r) };
  }
  assert.equal(results.healthy.a.status, 'Good');
  assert.ok(results.healthy.r.crankMin >= 10 && results.healthy.r.charging >= 13.5);
  assert.equal(results.battery.a.status, 'Needs attention');
  assert.equal(results.battery.a.items.find((i) => i.key === 'crank').level, 'bad');
  assert.equal(results.charging.a.items.find((i) => i.key === 'charging').level, 'bad');
  assert.match(results.charging.a.headline, /charging/);
});

test('battery test: engine never started is not reported as "not charging"', async () => {
  const { sim, elm } = await connect('healthy', { engineRunning: false });
  const r = await runBatteryTest(elm, { now: () => sim.now(), crankTimeoutSec: 5 });
  assert.equal(r.started, false);
  assert.equal(r.crankMin, null);
  assert.equal(r.charging, null);
  assert.equal(r.justSwitchedOff, false);
  const a = assessBattery(r);
  assert.equal(a.items.find((i) => i.key === 'resting').level, 'good');
});

test('battery test result feeds the health check and rules', async () => {
  const { summary } = await scan('healthy', {}, { batteryTest: { resting: 11.9, crankMin: 9.1, charging: 14.1 } });
  assert.deepEqual(summary.battery_test, { resting_v: 11.9, cranking_min_v: 9.1, charging_v: 14.1 });
  const r = ruleBasedReport(summary);
  assert.equal(r.status, 'Needs attention');
  assert.equal(r.likely_causes[0].cause, 'Weak battery');
});

test('driving scenario: summary reflects a moving car', async () => {
  const { summary } = await scan('driving');
  assert.equal(summary.context.idling, false);
  assert.ok(summary.readings.speed_kmh.max > 60);
  assert.equal(ruleBasedReport(summary).status, 'Good');
});

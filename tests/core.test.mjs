import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PIDS, decodeSupportedBitmap, encodeSupportedBitmap } from '../app/js/core/pids.js';
import { decodeDtc, encodeDtc, parseDtcBytes, describeDtc } from '../app/js/core/dtc.js';
import { Elm327, cleanLines, parseResponses, ObdError } from '../app/js/core/elm327.js';
import { SimulatedElm, SCENARIOS } from '../app/js/core/simulator.js';
import { runHealthCheck } from '../app/js/core/scan.js';
import { ruleBasedReport } from '../app/js/core/rules.js';
import { analyze, parseJsonLoose } from '../app/js/core/analyze.js';

const VEHICLE = { make: 'MG', model: 'ZS', year: 2019, fuel: 'petrol' };

async function scan(scenario, opts = {}) {
  const sim = new SimulatedElm({ scenario, virtualTime: true, ...opts });
  const elm = new Elm327(sim);
  const info = await elm.init();
  const summary = await runHealthCheck(elm, { vehicle: VEHICLE, durationSec: 60, now: () => sim.now() });
  return { sim, elm, info, summary };
}

test('PID encode/decode round trips', () => {
  const cases = { 0x0c: 812.5, 0x05: 89, 0x06: 9.4, 0x07: -12.5, 0x42: 14.21, 0x10: 2.61, 0x14: 0.62, 0x0e: 10.5 };
  for (const [pid, v] of Object.entries(cases)) {
    const def = PIDS[pid];
    const back = def.decode(def.encode(v));
    assert.ok(Math.abs(back - v) < 1, `PID ${pid}: ${v} -> ${back}`);
  }
  assert.equal(PIDS[0x0c].decode([0x1a, 0xf8]), 1726);
  assert.equal(PIDS[0x05].decode([0x7b]), 83);
});

test('supported-PID bitmap', () => {
  // Classic example: 0100 -> BE 1F A8 13
  const pids = decodeSupportedBitmap(0x00, [0xbe, 0x1f, 0xa8, 0x13]);
  assert.deepEqual(pids, [1, 3, 4, 5, 6, 7, 12, 13, 14, 15, 16, 17, 19, 21, 28, 31, 32]);
  assert.deepEqual(decodeSupportedBitmap(0x20, encodeSupportedBitmap(0x20, [0x21, 0x2f, 0x40])), [0x21, 0x2f, 0x40]);
});

test('DTC decoding', () => {
  assert.equal(decodeDtc(0x01, 0x71), 'P0171');
  assert.equal(decodeDtc(0x03, 0x02), 'P0302');
  assert.equal(decodeDtc(0x41, 0x23), 'C0123');
  assert.equal(decodeDtc(0xc1, 0x00), 'U0100');
  assert.equal(decodeDtc(0x9a, 0xbc), 'B1ABC');
  for (const c of ['P0420', 'P2135', 'U0100', 'B1ABC']) assert.equal(decodeDtc(...encodeDtc(c)), c);
  assert.deepEqual(parseDtcBytes([0x43, 0x02, 0x01, 0x71, 0x03, 0x02], true), ['P0171', 'P0302']);
  assert.deepEqual(parseDtcBytes([0x43, 0x01, 0x71, 0x03, 0x02, 0x00, 0x00], false), ['P0171', 'P0302']);
  assert.deepEqual(parseDtcBytes([0x43, 0x00], true), []);
  assert.equal(describeDtc('P0171').known, true);
  assert.match(describeDtc('P1A23').description, /Manufacturer-specific/);
});

test('response cleaning and multi-frame parsing', () => {
  const lines = cleanLines('0100\rSEARCHING...\r41 00 BE 3F A8 13\r\r>', '0100');
  assert.deepEqual(lines, ['41 00 BE 3F A8 13']);
  const multi = cleanLines('00A\r0: 43 04 01 71 03 02\r1: 04 20 05 62 00 00 00\r\r');
  const [bytes] = parseResponses(multi);
  assert.equal(bytes.length, 10);
  assert.deepEqual(parseDtcBytes(bytes, true), ['P0171', 'P0302', 'P0420', 'P0562']);
  // Two ECUs answering, spaces off
  assert.equal(parseResponses(['410C0C30', '410C0C34']).length, 2);
});

test('init against simulator', async () => {
  const sim = new SimulatedElm({ virtualTime: true });
  const elm = new Elm327(sim);
  const info = await elm.init();
  assert.equal(info.protocol, '6');
  assert.equal(info.isCan, true);
  assert.ok(elm.supports(0x0c) && elm.supports(0x42) && !elm.supports(0x5c));
  const rpm = await elm.readPid(0x0c);
  assert.ok(rpm > 700 && rpm < 860, `rpm ${rpm}`);
  assert.equal(await elm.readPid(0x5c), null);
});

test('works with clones that ignore ATS0', async () => {
  const sim = new SimulatedElm({ virtualTime: true, ignoreSpacesOff: true });
  const elm = new Elm327(sim);
  await elm.init();
  const t = await elm.readPid(0x05);
  assert.ok(t > 80 && t < 95);
});

test('ignition off gives a friendly error', async () => {
  const elm = new Elm327(new SimulatedElm({ ignitionOn: false }));
  await assert.rejects(elm.init(), (e) => e instanceof ObdError && e.code === 'NO_CAR');
});

test('multi-frame DTC read through the simulator', async () => {
  const sim = new SimulatedElm({ virtualTime: true });
  sim.scenario = { ...sim.scenario, stored: ['P0171', 'P0302', 'P0420', 'P0562'] };
  const elm = new Elm327(sim);
  await elm.init();
  assert.deepEqual(await elm.readDtcs('03'), ['P0171', 'P0302', 'P0420', 'P0562']);
});

test('healthy car: summary shape and Good status', async () => {
  const { summary } = await scan('healthy');
  assert.ok(summary.window_seconds >= 60 && summary.window_seconds <= 62);
  assert.equal(summary.check_engine_light_on, false);
  assert.deepEqual(summary.trouble_codes.stored, []);
  assert.ok(summary.readings.rpm.avg > 700);
  assert.ok(summary.readings.o2_b1s1_v.switches > summary.readings.o2_b1s2_v.switches);
  assert.equal(summary.context.warmed_up, true);
  assert.equal(summary.snapshot.fuel_level_pct, 54);
  const report = ruleBasedReport(summary);
  assert.equal(report.status, 'Good', JSON.stringify(report));
  assert.equal(report.safe_to_drive, 'yes');
  // Compact enough to be cheap: well under 1,000 tokens (~4 chars/token)
  assert.ok(JSON.stringify(summary).length < 3000, `summary is ${JSON.stringify(summary).length} chars`);
});

const expectations = {
  lean: (r) => r.likely_causes[0].cause.includes('lean') && r.status === 'Needs attention',
  misfire: (r) => r.likely_causes.some((c) => c.cause.includes('cylinder 2')) && r.safe_to_drive === 'with caution',
  overheating: (r) => r.safe_to_drive === 'no' && r.safety_warning && r.status === 'Needs attention',
  charging: (r) => r.likely_causes[0].cause.includes('charging') && r.safe_to_drive === 'with caution',
  catalyst: (r) => r.likely_causes.some((c) => c.cause.includes('Catalytic')) && r.status === 'Watch',
};

for (const [scenario, check] of Object.entries(expectations)) {
  test(`scenario ${scenario}: rules flag it`, async () => {
    const { summary } = await scan(scenario);
    const report = ruleBasedReport(summary);
    assert.ok(check(report), `${scenario}: ${JSON.stringify(report, null, 1)}`);
  });
}

test('every scenario has a label', () => {
  for (const s of Object.values(SCENARIOS)) assert.ok(s.label && s.description);
});

test('parseJsonLoose handles fences and chatter', () => {
  assert.deepEqual(parseJsonLoose('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('{"a":{"b":2}}'), { a: { b: 2 } });
  assert.throws(() => parseJsonLoose('no json here'));
});

test('analyze: Claude happy path with mocked fetch', async () => {
  const { summary } = await scan('lean');
  let sent;
  const fakeFetch = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return {
      ok: true, status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '```json\n{"status":"Needs attention","headline":"Lean condition","safety_warning":null,"likely_causes":[{"cause":"Vacuum leak","confidence":"Medium","reason":"LTFT +12.5%"}],"checks":["Smoke test intake"],"safe_to_drive":"with caution","safe_to_drive_note":"OK short term","missing_data":[],"summary":"Lean."}\n```' }],
        usage: { input_tokens: 900, output_tokens: 200 },
      }),
    };
  };
  const report = await analyze(summary, { provider: 'claude', apiKey: 'sk-test', model: 'claude-sonnet-5-5' }, fakeFetch);
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.init.headers['x-api-key'], 'sk-test');
  assert.equal(sent.body.model, 'claude-sonnet-5-5');
  assert.match(sent.body.messages[0].content, /P0171/);
  assert.equal(report.source, 'ai');
  assert.equal(report.likely_causes[0].confidence, 'medium');
  assert.equal(report.usage.input_tokens, 900);
});

test('analyze: bad key falls back to offline rules', async () => {
  const { summary } = await scan('overheating');
  const fakeFetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) });
  const report = await analyze(summary, { provider: 'claude', apiKey: 'bad' }, fakeFetch);
  assert.equal(report.source, 'rules');
  assert.match(report.fallback_reason, /rejected/);
  assert.equal(report.safe_to_drive, 'no');
});

test('analyze: no key means offline, no network call', async () => {
  const { summary } = await scan('healthy');
  const report = await analyze(summary, { provider: 'claude', apiKey: '' }, () => { throw new Error('should not call'); });
  assert.equal(report.source, 'rules');
});

test('analyze: OpenAI-compatible endpoint (e.g. Ollama)', async () => {
  const { summary } = await scan('healthy');
  let url;
  const fakeFetch = async (u) => {
    url = u;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"status":"Good","headline":"All good","likely_causes":[],"checks":[],"safe_to_drive":"yes","summary":"Fine."}' } }] }) };
  };
  const report = await analyze(summary, { provider: 'openai', baseUrl: 'http://localhost:11434/v1/', openaiModel: 'qwen2.5:7b' }, fakeFetch);
  assert.equal(url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(report.status, 'Good');
  assert.equal(report.model, 'qwen2.5:7b');
});

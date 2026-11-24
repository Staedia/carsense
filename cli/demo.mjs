#!/usr/bin/env node
// Run a full health check against the simulated car from the terminal.
//
//   node cli/demo.mjs                       healthy car, offline rules
//   node cli/demo.mjs --scenario lean       pick a fault
//   node cli/demo.mjs --list                show scenarios
//   ANTHROPIC_API_KEY=sk-... node cli/demo.mjs --scenario misfire
//   node cli/demo.mjs --provider openai --base-url http://localhost:11434/v1 --model qwen2.5:7b
//   --note "hesitates when accelerating"    add a symptom
//   --battery                               run the battery test first (engine off, then start)
//   --json                                  print the summary sent to the AI

import { SimulatedElm, SCENARIOS } from '../app/js/core/simulator.js';
import { Elm327 } from '../app/js/core/elm327.js';
import { runHealthCheck } from '../app/js/core/scan.js';
import { analyze } from '../app/js/core/analyze.js';
import { runBatteryTest, assessBattery } from '../app/js/core/battery.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (args.includes('--list')) {
  for (const [k, s] of Object.entries(SCENARIOS)) console.log(`${k.padEnd(12)} ${s.label} - ${s.description}`);
  process.exit(0);
}

const scenario = opt('scenario', 'healthy');
const provider = opt('provider', process.env.ANTHROPIC_API_KEY ? 'claude' : 'offline');
const settings = {
  provider,
  apiKey: provider === 'openai' ? (process.env.OPENAI_API_KEY || '') : (process.env.ANTHROPIC_API_KEY || ''),
  model: opt('model', 'claude-sonnet-5-5'),
  openaiModel: opt('model', 'gpt-4o-mini'),
  baseUrl: opt('base-url', 'https://api.openai.com/v1'),
};

const sim = new SimulatedElm({ scenario, virtualTime: true });
const elm = new Elm327(sim);
const info = await elm.init();
console.log(`Connected: ${info.version}, protocol ${info.protocol}, ${info.supported.length} PIDs supported`);
console.log(`Scenario: ${SCENARIOS[scenario].label}\n`);

let batteryTest;
if (args.includes('--battery')) {
  batteryTest = await runBatteryTest(elm, {
    now: () => sim.now(),
    waitForEngineOff: async () => { console.log('Switching the engine off…'); sim.setEngine(false); },
    onReadyToCrank: (v) => { console.log(`Resting voltage ${v.toFixed(2)} V. Starting the engine…`); sim.crank(); },
  });
  const a = assessBattery(batteryTest);
  console.log(`\nBattery test: ${a.status}. ${a.headline}`);
  for (const i of a.items) console.log(`  ${i.label.padEnd(26)} ${i.value == null ? '–' : `${i.value.toFixed(2)} V`}  ${i.note}`);
  for (const t of a.advice) console.log(`  → ${t}`);
  console.log('');
}

const summary = await runHealthCheck(elm, {
  batteryTest,
  vehicle: { make: 'MG', model: 'ZS', year: 2019, fuel: 'petrol' },
  userNote: opt('note', ''),
  durationSec: Number(opt('seconds', 60)),
  now: () => sim.now(),
});

if (args.includes('--json')) console.log(JSON.stringify(summary, null, 2), '\n');
console.log(`Summary: ${JSON.stringify(summary).length} characters (~${Math.round(JSON.stringify(summary).length / 4)} tokens)\n`);

const r = await analyze(summary, settings);
const icon = { Good: '🟢', Watch: '🟡', 'Needs attention': '🔴' }[r.status];
console.log(`${icon} ${r.status.toUpperCase()}  (${r.source === 'ai' ? `AI: ${r.model}` : 'basic offline check'})`);
if (r.fallback_reason) console.log(`   note: ${r.fallback_reason}`);
console.log(`\n${r.headline}`);
if (r.safety_warning) console.log(`\n⚠️  ${r.safety_warning}`);
if (r.likely_causes.length) {
  console.log('\nLikely causes:');
  r.likely_causes.forEach((c, i) => console.log(`  ${i + 1}. ${c.cause} [${c.confidence}]\n     ${c.reason}`));
}
if (r.checks.length) {
  console.log('\nCheck first:');
  r.checks.forEach((c) => console.log(`  - ${c}`));
}
console.log(`\nSafe to drive: ${r.safe_to_drive}. ${r.safe_to_drive_note}`);
if (r.missing_data.length) console.log(`\nMissing data: ${r.missing_data.join(' ')}`);
if (r.summary) console.log(`\n${r.summary}`);
if (r.usage) console.log(`\nTokens: ${JSON.stringify(r.usage)}`);

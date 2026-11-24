// UI wiring. All the car logic lives in ./core; this file just connects
// buttons to it and draws the results.

import { Elm327, ObdError } from './core/elm327.js';
import { BleTransport, bluetoothAvailable } from './core/transport-ble.js';
import { SimulatedElm, SCENARIOS } from './core/simulator.js';
import { PIDS, vinModelYear } from './core/pids.js';
import { collectLive, runHealthCheck } from './core/scan.js';
import { FuelTracker, formatEconomy } from './core/fuel.js';
import { runBatteryTest, assessBattery } from './core/battery.js';
import { analyze, DEFAULT_SETTINGS } from './core/analyze.js';
import { misfireOutlier } from './core/rules.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- settings (saved in this browser only) ----------
const STORE_KEY = 'carsense.settings.v1';
const defaults = {
  ...DEFAULT_SETTINGS,
  openaiKey: '',
  fuelUnit: 'l100km',
  duration: 60,
  vehicle: { make: 'MG', model: 'ZS', year: 2019, fuel: 'petrol' },
};
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...defaults, ...saved, vehicle: { ...defaults.vehicle, ...(saved.vehicle || {}) } };
  } catch {
    return structuredClone(defaults);
  }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* private mode etc. */ }
}
let settings = loadSettings();

// ---------- state ----------
let elm = null;
let transport = null;
let mode = null; // 'ble' | 'demo'
let liveAbort = null;
let livePromise = null;
let checkAbort = null;
let batteryAbort = null;
let batteryResult = null; // last battery test this session, added to the health check
let vin = null;

// ---------- gauges ----------
// Each gauge shows one reading key (or a derived value). `pids` are what it
// needs polled; a gauge whose PIDs the car doesn't support is hidden.
const signed = (v) => (v > 0 ? '+' : '') + v.toFixed(1);
const trimLevel = (v) => (Math.abs(v) > 20 ? 'bad' : Math.abs(v) > 10 ? 'warn' : '');
const batteryLevel = (v) => (v < 12.0 || v > 15 ? 'bad' : v < 12.4 ? 'warn' : '');

const G = (pid, extra = {}) => ({
  id: PIDS[pid].key, keys: [PIDS[pid].key], pids: [pid], label: PIDS[pid].label, unit: PIDS[pid].unit,
  fmt: (v) => Math.round(v), ...extra,
});

// Everyday view: what a driver cares about.
const SIMPLE_GAUGES = [
  G(0x0d, { label: 'Speed' }),
  G(0x0c),
  G(0x05, { level: (v) => (v >= 110 ? 'bad' : v >= 105 ? 'warn' : ''), sub: () => 'normal 85-100' }),
  {
    // Always available: if the car doesn't report 0x42, the dongle's own voltmeter is used.
    id: 'battery', keys: ['module_voltage_v', 'adapter_voltage_v'], pids: [], poll: [0x42], label: 'Battery', unit: 'V',
    fmt: (v) => v.toFixed(1),
    // Engine off, about 12.4-12.7 V is healthy; running, 13.5-14.7 V means it's charging.
    level: (v) => (engineOn() ? (v < 13.0 || v > 15 ? 'bad' : v < 13.4 ? 'warn' : '') : batteryLevel(v)),
    sub: () => (engineOn() == null ? '' : engineOn() ? 'charging' : 'engine off'),
  },
  { id: 'fuel_economy', keys: [], pids: [], label: 'Fuel use', unit: '', derived: true },
  G(0x2f, { label: 'Fuel tank' }),
  G(0x04),
  G(0x5c, { level: (v) => (v >= 140 ? 'bad' : v >= 130 ? 'warn' : '') }),
];

// Extra sensors for the curious (and for mechanics).
const DETAIL_GAUGES = [
  G(0x06, { fmt: signed, level: trimLevel, sub: () => 'normal ±10' }),
  G(0x07, { fmt: signed, level: trimLevel, sub: () => 'normal ±10' }),
  G(0x14, { fmt: (v) => v.toFixed(2), sub: () => 'should flicker' }),
  G(0x15, { fmt: (v) => v.toFixed(2), sub: () => 'should be steady' }),
  G(0x44, { label: 'Target mix (λ)', fmt: (v) => v.toFixed(2), sub: () => '1.00 = normal' }),
  G(0x10, { fmt: (v) => v.toFixed(1) }),
  G(0x0b),
  G(0x11),
  G(0x0e, { fmt: (v) => v.toFixed(1) }),
  G(0x0f),
  G(0x3c),
  G(0x46),
];

// Extra PIDs fuel economy needs: air flow, speed, target mix, fuel rate.
const FUEL_PIDS = [0x10, 0x0d, 0x44, 0x5e];

let fuel = new FuelTracker();
let lastValues = {};
const engineOn = () => (lastValues.rpm == null ? null : lastValues.rpm > 300);

function visibleGauges() {
  const list = $('liveAll').checked ? [...SIMPLE_GAUGES, ...DETAIL_GAUGES] : SIMPLE_GAUGES;
  return list.filter(gaugeAvailable);
}
function gaugeAvailable(g) {
  if (!elm) return true;
  if (g.id === 'fuel_economy') return elm.supports(0x5e) || (elm.supports(0x10) && settings.vehicle.fuel !== 'diesel');
  return g.pids.every((p) => elm.supports(p));
}
function livePids() {
  const pids = new Set(visibleGauges().flatMap((g) => [...g.pids, ...(g.poll || [])]));
  if (visibleGauges().some((g) => g.id === 'fuel_economy')) FUEL_PIDS.forEach((p) => pids.add(p));
  pids.add(0x0c); // RPM tells us if the engine is running (battery gauge)
  return [...pids];
}

function buildGauges() {
  const shown = visibleGauges();
  $('gauges').innerHTML = shown.map((g) => `
    <div class="gauge" id="g-${g.id}">
      <div class="g-label">${esc(g.label)}</div>
      <div class="g-value">–<span class="g-unit">${esc(g.unit)}</span></div>
      <div class="g-sub"></div>
    </div>`).join('');
  const missing = [...SIMPLE_GAUGES, ...($('liveAll').checked ? DETAIL_GAUGES : [])]
    .filter((g) => !gaugeAvailable(g)).map((g) => g.label.toLowerCase());
  const notes = [];
  if (missing.length) notes.push(`Your car doesn't report: ${missing.join(', ')}.`);
  if (shown.some((g) => g.id === 'fuel_economy') && !elm?.supports(0x5e)) {
    notes.push('Fuel use is estimated from the air flow sensor, so treat it as a guide (within about 10%).');
  }
  $('liveNote').textContent = notes.join(' ');
  $('liveNote').hidden = !notes.length;
  for (const [key, v] of Object.entries(lastValues)) updateGauge(key, v, null, false);
  renderFuelGauge();
}

function setGauge(id, valueHtml, sub, lvl) {
  const el = $(`g-${id}`);
  if (!el) return;
  el.querySelector('.g-value').innerHTML = valueHtml;
  el.querySelector('.g-sub').textContent = sub || '';
  el.classList.remove('warn', 'bad');
  if (lvl) el.classList.add(lvl);
}

function updateGauge(key, value, _pid, track = true) {
  if (track) {
    lastValues[key] = value;
    fuel.update(key, value, performance.now() / 1000);
  }
  for (const g of [...SIMPLE_GAUGES, ...DETAIL_GAUGES]) {
    if (!g.keys.includes(key)) continue;
    // Battery: prefer the car's own reading over the dongle's.
    if (g.id === 'battery' && key === 'adapter_voltage_v' && lastValues.module_voltage_v != null) continue;
    setGauge(g.id, `${esc(g.fmt(value))}<span class="g-unit">${esc(g.unit)}</span>`, g.sub?.(value), g.level?.(value));
  }
  if (track && (key === 'maf_gps' || key === 'fuel_rate_lph')) renderFuelGauge();
}

function renderFuelGauge() {
  const now = fuel.current();
  if (!now) return;
  const trip = fuel.tripSummary();
  const tripTxt = formatEconomy(trip.l100km, settings.fuelUnit);
  const sub = tripTxt ? `trip avg ${tripTxt.value} ${tripTxt.unit}` : now.moving ? '' : 'idling';
  const eco = now.moving ? formatEconomy(now.l100km, settings.fuelUnit) : null;
  const html = eco
    ? `${esc(eco.value)}<span class="g-unit">${esc(eco.unit)}</span>`
    : `${esc(now.lph.toFixed(1))}<span class="g-unit">L/h</span>`;
  setGauge('fuel_economy', html, sub, '');
}

// ---------- status helpers ----------
function setStatus(text, state = '') {
  $('statusText').textContent = text;
  $('statusDot').className = `dot ${state}`;
}
function showError(msg) {
  const box = $('errorBox');
  box.textContent = msg || '';
  box.hidden = !msg;
}
function setConnectedUI(connected) {
  $('connectButtons').hidden = connected;
  $('showAllWrap').hidden = connected || mode === 'demo';
  $('connectHint').hidden = connected;
  $('disconnectBtn').hidden = !connected;
  $('liveCard').hidden = !connected;
  $('batteryCard').hidden = !connected;
  $('checkCard').hidden = !connected;
  $('demoRow').hidden = !(connected && mode === 'demo');
}

function renderVehicle() {
  const v = settings.vehicle;
  let line = `${v.year} ${v.make} ${v.model} · ${v.fuel}`;
  if (vin) {
    line += ` · VIN ${vin}`;
    const y = vinModelYear(vin);
    if (y && v.year && y !== Number(v.year)) line += ` (VIN suggests model year ${y}; check Settings)`;
  }
  $('vehicleLine').textContent = line;
}

// ---------- connecting ----------
async function startSession(newTransport, label) {
  transport = newTransport;
  elm = new Elm327(transport);
  setStatus(`${label}: setting up…`, 'busy');
  const info = await elm.init();
  const proto = info.isCan ? 'CAN' : `protocol ${info.protocol}`;
  setStatus(`${label} · ${proto} · ${info.supported.length} sensors`, 'on');
  lastValues = {};
  fuel = new FuelTracker({ fuel: settings.vehicle.fuel });
  batteryResult = null;
  $('battResult').innerHTML = '';
  setConnectedUI(true);
  buildGauges();
  vin = await elm.readVin().catch(() => null);
  renderVehicle();
}

async function connectDongle() {
  showError('');
  if (!bluetoothAvailable()) {
    showError("This browser can't use Bluetooth. Use Chrome on Android or on a laptop. On iPhone, open this page in the free Bluefy browser.");
    return;
  }
  if (!window.isSecureContext) {
    showError('Bluetooth only works on https:// pages or localhost. See the README for hosting it on GitHub Pages.');
    return;
  }
  try {
    mode = 'ble';
    const ble = new BleTransport({ onDisconnect: handleDisconnect });
    setStatus('Choose your dongle…', 'busy');
    const name = await ble.connect({ showAll: $('showAll').checked });
    await startSession(ble, name);
  } catch (e) {
    mode = null;
    await transport?.close?.();
    transport = null;
    elm = null;
    setStatus('Not connected');
    if (e.name === 'NotFoundError') return; // user closed the picker
    showError(e instanceof ObdError ? e.message : `Couldn't connect: ${e.message}`);
  }
}

async function startDemo(scenarioKey = $('scenario').value || 'healthy') {
  showError('');
  mode = 'demo';
  await stopLive();
  await transport?.close?.();
  try {
    await startSession(new SimulatedElm({ scenario: scenarioKey, latencyMs: 40, seed: Date.now() & 0xffff }), 'Demo car');
  } catch (e) {
    showError(e.message);
  }
}

function handleDisconnect() {
  liveAbort?.abort();
  checkAbort?.abort();
  batteryAbort?.abort();
  vin = null;
  renderVehicle();
  elm = null;
  transport = null;
  mode = null;
  setStatus('Dongle disconnected');
  setConnectedUI(false);
}

async function disconnect() {
  await stopLive();
  checkAbort?.abort();
  await transport?.close?.();
  handleDisconnect();
  setStatus('Not connected');
}

// ---------- live view ----------
async function stopLive() {
  if (!liveAbort) return;
  liveAbort.abort();
  try { await livePromise; } catch { /* aborted */ }
  liveAbort = null;
  livePromise = null;
  $('liveBtn').textContent = 'Start live view';
}

async function toggleLive() {
  if (liveAbort) return stopLive();
  liveAbort = new AbortController();
  $('liveBtn').textContent = 'Stop live view';
  fuel.reset();
  livePromise = collectLive(elm, {
    pids: livePids(), durationSec: Infinity, signal: liveAbort.signal, onSample: updateGauge, minCycleMs: 400,
  }).catch((e) => {
    if (e.name !== 'AbortError') showError(e.message);
  });
  await livePromise;
  liveAbort = null;
  $('liveBtn').textContent = 'Start live view';
}

// ---------- health check ----------
async function runCheck() {
  showError('');
  await stopLive();
  checkAbort = new AbortController();
  const durationSec = Number($('duration').value);
  settings.duration = durationSec;
  saveSettings();

  setBusy(true);
  $('progressWrap').hidden = false;
  $('progressBar').style.width = '0%';
  $('reportCard').hidden = true;

  try {
    const summary = await runHealthCheck(elm, {
      vehicle: settings.vehicle,
      userNote: $('note').value,
      durationSec,
      batteryTest: batteryResult,
      signal: checkAbort.signal,
      onSample: updateGauge,
      onStage: (s) => { $('stageText').textContent = s; },
      onProgress: (p) => { $('progressBar').style.width = `${Math.round(p * 100)}%`; },
    });
    $('rawJson').textContent = JSON.stringify(summary, null, 2);
    $('rawWrap').hidden = false;

    const useAi = settings.provider !== 'offline';
    $('stageText').textContent = useAi ? 'Asking the AI…' : 'Analysing…';
    $('progressBar').style.width = '100%';
    const report = await analyze(summary, {
      ...settings,
      apiKey: settings.provider === 'openai' ? settings.openaiKey : settings.apiKey,
    });
    renderReport(report, summary);
  } catch (e) {
    if (e.name !== 'AbortError') showError(e.message);
  } finally {
    checkAbort = null;
    setBusy(false);
    $('progressWrap').hidden = true;
  }
}

function setBusy(busy) {
  for (const id of ['checkBtn', 'liveBtn', 'battBtn']) $(id).disabled = busy;
}

// ---------- battery test ----------
function batteryPrompt(text, { button = null } = {}) {
  $('battPrompt').hidden = !text;
  $('battPromptText').textContent = text || '';
  $('battContinue').hidden = !button;
  if (!button) return Promise.resolve();
  $('battContinue').textContent = button;
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })); };
    const cleanup = () => {
      $('battContinue').removeEventListener('click', done);
      batteryAbort?.signal.removeEventListener('abort', abort);
    };
    $('battContinue').addEventListener('click', done);
    batteryAbort?.signal.addEventListener('abort', abort);
  });
}

async function runBattery() {
  showError('');
  await stopLive();
  batteryAbort = new AbortController();
  setBusy(true);
  $('battResult').innerHTML = '';
  $('battStageRow').hidden = false;
  $('battVolt').hidden = false;
  $('battVoltValue').textContent = '–';
  const demo = mode === 'demo';
  try {
    const result = await runBatteryTest(elm, {
      signal: batteryAbort.signal,
      pauseMs: 1500,
      onStage: (t) => { $('battStage').textContent = t; },
      onVoltage: (v) => {
        $('battVoltValue').textContent = v.toFixed(2);
        updateGauge('adapter_voltage_v', v);
      },
      waitForEngineOff: async () => {
        await batteryPrompt(demo
          ? 'The demo car is running. Tap Continue to switch it off.'
          : 'Switch the engine off and leave the dongle plugged in. Then tap Continue.', { button: 'Engine is off' });
        if (demo) transport.setEngine(false);
        batteryPrompt(null);
      },
      onReadyToCrank: () => {
        batteryPrompt(demo ? 'Starting the demo car…' : 'Now start the engine.');
        if (demo) setTimeout(() => transport?.crank?.(), 1500);
      },
    });
    batteryResult = result;
    renderBatteryResult(assessBattery(result));
  } catch (e) {
    if (e.name !== 'AbortError') showError(e.message);
  } finally {
    batteryAbort = null;
    batteryPrompt(null);
    $('battStageRow').hidden = true;
    $('battVolt').hidden = true;
    setBusy(false);
  }
}

function resultList(items) {
  return `<ul class="result-list">${items.map((i) => `
    <li>
      <span class="lvl ${esc(i.level)}"></span>
      <span class="r-label">${esc(i.label)}</span>
      <span class="r-value">${i.value == null ? '–' : esc(i.value)}</span>
      <span class="r-note">${esc(i.note)}</span>
    </li>`).join('')}</ul>`;
}

function renderBatteryResult(a) {
  const icon = { Good: '●', Watch: '▲', 'Needs attention': '■' }[a.status];
  $('battResult').innerHTML = `
    <div class="report-head flush">
      <span class="badge ${esc(a.status.split(' ')[0])}">${icon} ${esc(a.status)}</span>
      <div class="headline">${esc(a.headline)}</div>
    </div>
    ${resultList(a.items.map((i) => ({ ...i, value: i.value == null ? null : `${i.value.toFixed(2)} V` })))}
    ${a.advice.length ? `<ol class="checks">${a.advice.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
    <p class="note">Dongle readings are approximate (about ±0.2 V). This result will be included in your next health check.</p>`;
}

function renderReport(r, summary) {
  const badgeIcon = { Good: '●', Watch: '▲', 'Needs attention': '■' }[r.status];
  const codes = [
    ...summary.trouble_codes.stored.map((c) => `<span class="code" title="${esc(c.description)}">${esc(c.code)}</span>`),
    ...summary.trouble_codes.pending.map((c) => `<span class="code pending" title="Pending: ${esc(c.description)}">${esc(c.code)} · pending</span>`),
  ].join('');
  const drive = { yes: 'Yes', 'with caution': 'With caution', no: 'No' }[r.safe_to_drive];
  const source = r.source === 'ai'
    ? `AI analysis · ${esc(r.model)}${r.usage ? ` · ${(r.usage.input_tokens ?? r.usage.prompt_tokens ?? 0) + (r.usage.output_tokens ?? r.usage.completion_tokens ?? 0)} tokens` : ''}`
    : 'Basic offline check';

  $('reportCard').innerHTML = `
    <div class="card report">
      <div class="report-head">
        <span class="badge ${esc(r.status.split(' ')[0])}">${badgeIcon} ${esc(r.status)}</span>
        <div class="headline">${esc(r.headline)}</div>
        <div class="source">${source} · ${new Date().toLocaleString()}</div>
        ${r.safety_warning ? `<div class="safety">⚠ ${esc(r.safety_warning)}</div>` : ''}
      </div>
      <div class="report-body">
        ${codes ? `<h3>Trouble codes</h3><div class="codes">${codes}</div>` : ''}
        ${r.likely_causes.length ? `<h3>Likely causes</h3>${r.likely_causes.map((c) => `
          <div class="cause">
            <div class="c-top"><span>${esc(c.cause)}</span><span class="conf ${esc(c.confidence)}">${esc(c.confidence)}</span></div>
            <p>${esc(c.reason)}</p>
          </div>`).join('')}` : ''}
        ${r.checks.length ? `<h3>Check first</h3><ol class="checks">${r.checks.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>` : ''}
        <h3>Safe to drive?</h3>
        <div class="drive"><strong>${esc(drive)}</strong><span>${esc(r.safe_to_drive_note)}</span></div>
        ${r.summary ? `<h3>In plain English</h3><p>${esc(r.summary)}</p>` : ''}
        ${extraChecks(summary)}
        ${r.missing_data.length ? `<p class="note">${r.missing_data.map(esc).join(' ')}</p>` : ''}
        ${r.fallback_reason ? `<p class="note">${esc(r.fallback_reason)}</p>` : ''}
      </div>
    </div>`;
  $('reportCard').hidden = false;
  $('reportCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Facts straight from the car, shown whatever the AI says.
function extraChecks(summary) {
  const parts = [];
  const st = summary.emissions_self_tests;
  if (st) {
    const total = st.complete + st.incomplete.length;
    const dist = summary.snapshot?.distance_since_codes_cleared_km;
    parts.push(`<h3>Car's self-tests</h3>${resultList([{
      level: st.incomplete.length ? 'watch' : 'good',
      label: 'Emissions self-tests',
      value: `${st.complete} of ${total} done`,
      note: (st.incomplete.length
        ? `Not finished yet: ${st.incomplete.join(', ')}. They complete during normal driving.`
        : 'All finished. The car has checked its own emissions systems.')
        + (dist != null ? ` ${dist.toLocaleString()} km since codes were last cleared.` : ''),
    }])}`);
  }
  const mc = summary.misfire_counts;
  if (mc) {
    const counts = mc.last_drive?.some((v) => v != null) ? mc.last_drive : mc.avg_last_10_drives;
    const out = misfireOutlier(mc);
    parts.push(`<h3>Misfire counter <span class="muted">(${counts === mc.last_drive ? 'last drive' : '10-drive average'})</span></h3>
      <div class="cyls">${counts.map((v, i) => `<div class="cyl${out?.cylinder === i + 1 ? ' hot' : ''}">Cyl ${i + 1}<strong>${v ?? '–'}</strong></div>`).join('')}</div>
      <p class="note">${out ? 'One cylinder stands out. See the likely causes above.' : 'A few misfires now and then are normal.'}</p>`);
  }
  return parts.join('');
}

// ---------- settings dialog ----------
function openSettings() {
  $('provider').value = settings.provider;
  $('apiKey').value = settings.apiKey;
  $('model').value = settings.model;
  $('baseUrl').value = settings.baseUrl;
  $('openaiKey').value = settings.openaiKey;
  $('openaiModel').value = settings.openaiModel;
  $('vMake').value = settings.vehicle.make;
  $('vModel').value = settings.vehicle.model;
  $('vYear').value = settings.vehicle.year;
  $('vFuel').value = settings.vehicle.fuel;
  $('fuelUnit').value = settings.fuelUnit;
  syncProviderFields();
  $('settings').showModal();
}
function syncProviderFields() {
  document.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== $('provider').value; });
}
function applySettings() {
  settings = {
    ...settings,
    provider: $('provider').value,
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || DEFAULT_SETTINGS.model,
    baseUrl: $('baseUrl').value.trim() || DEFAULT_SETTINGS.baseUrl,
    openaiKey: $('openaiKey').value.trim(),
    openaiModel: $('openaiModel').value.trim() || DEFAULT_SETTINGS.openaiModel,
    fuelUnit: $('fuelUnit').value,
    vehicle: {
      make: $('vMake').value.trim() || 'Unknown',
      model: $('vModel').value.trim() || 'Unknown',
      year: Number($('vYear').value) || null,
      fuel: $('vFuel').value,
    },
  };
  saveSettings();
  renderVehicle();
  if (elm) {
    fuel.canEstimate = settings.vehicle.fuel !== 'diesel';
    buildGauges();
  }
}

// ---------- boot ----------
function init() {
  $('scenario').innerHTML = Object.entries(SCENARIOS)
    .map(([k, s]) => `<option value="${k}">${esc(s.label)}</option>`).join('');
  const syncScenarioDesc = () => { $('scenarioDesc').textContent = SCENARIOS[$('scenario').value].description; };
  syncScenarioDesc();

  $('duration').value = String(settings.duration);
  if (![...$('duration').options].some((o) => o.value === String(settings.duration))) $('duration').value = '60';
  renderVehicle();
  setConnectedUI(false);

  $('connectBtn').addEventListener('click', connectDongle);
  $('demoBtn').addEventListener('click', () => startDemo());
  $('scenario').addEventListener('change', () => { syncScenarioDesc(); startDemo($('scenario').value); });
  $('disconnectBtn').addEventListener('click', disconnect);
  $('liveBtn').addEventListener('click', toggleLive);
  $('liveAll').addEventListener('change', async () => {
    const wasLive = Boolean(liveAbort);
    await stopLive();
    buildGauges();
    if (wasLive) toggleLive();
  });
  $('battBtn').addEventListener('click', runBattery);
  $('battCancel').addEventListener('click', () => batteryAbort?.abort());
  $('checkBtn').addEventListener('click', runCheck);
  $('cancelBtn').addEventListener('click', () => checkAbort?.abort());
  $('settingsBtn').addEventListener('click', openSettings);
  $('provider').addEventListener('change', syncProviderFields);
  $('settings').addEventListener('close', () => {
    if ($('settings').returnValue === 'save') applySettings();
  });

  if (!settings.apiKey && settings.provider === 'claude') {
    $('connectHint').textContent += ' Tip: add an AI key in Settings for a full diagnosis; without one you get a basic offline check.';
  }
}

init();

// Battery test: three readings that together say a lot about a 12 V battery
// and the charging system, using only the dongle's own voltmeter (ATRV):
//   1. resting voltage, engine off  (how charged is it?)
//   2. lowest voltage while cranking (can it still deliver a big current?)
//   3. voltage once the engine runs  (is the alternator charging it?)
// ATRV is read from the OBD port, which is wired straight to the battery, so
// this works even when the car's computers aren't answering.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const abortError = () => Object.assign(new Error('Battery test cancelled'), { name: 'AbortError' });

/**
 * @param {Elm327} elm
 * @param {object} o
 * @param {() => Promise} o.waitForEngineOff  UI asks the driver to switch off; resolves when they tap Continue
 * @param {() => void} o.onReadyToCrank       UI tells the driver to start the engine now
 * @param {(stage: string) => void} o.onStage
 * @param {(v: number) => void} o.onVoltage   every reading, for a live display
 */
export async function runBatteryTest(elm, {
  waitForEngineOff = async () => {}, onReadyToCrank = () => {}, onStage = () => {}, onVoltage = () => {},
  signal, now = () => Date.now(), crankTimeoutSec = 30, pauseMs = 0,
} = {}) {
  const t = () => now() / 1000;
  const check = () => { if (signal?.aborted) throw abortError(); };
  const engineRunning = async () => {
    if (!elm.supports(0x0c)) return false;
    const rpm = await elm.readPid(0x0c).catch(() => null);
    return rpm != null && rpm > 300;
  };

  let justSwitchedOff = false;
  onStage('Checking the engine is off');
  for (let tries = 0; await engineRunning(); tries++) {
    check();
    if (tries >= 3) throw new Error('The engine still seems to be running. Switch it off and try the battery test again.');
    justSwitchedOff = true;
    await waitForEngineOff();
  }

  onStage('Measuring resting voltage');
  if (pauseMs) await sleep(pauseMs);
  const rest = [];
  for (let i = 0; i < 6; i++) {
    check();
    const v = await elm.readAdapterVoltage().catch(() => null);
    if (v != null) { rest.push(v); onVoltage(v); }
  }
  if (!rest.length) throw new Error("The dongle didn't report a voltage. Try unplugging it and plugging it back in.");
  const resting = median(rest);

  onStage('Start the engine now');
  onReadyToCrank(resting);
  const start = t();
  const crankThreshold = resting - 0.8;
  let crankMin = null;
  let crankedAt = null;
  let highSince = null;
  let failures = 0;
  const after = [];

  while (t() - start < crankTimeoutSec) {
    check();
    let v = null;
    try {
      v = await elm.readAdapterVoltage(1000);
      failures = 0;
    } catch {
      // Some dongles brown out for a moment while cranking. Keep trying.
      if (++failures > 20) break;
      await sleep(100);
      continue;
    }
    if (v == null) continue;
    onVoltage(v);
    if (crankedAt == null) {
      if (v < crankThreshold) { crankedAt = t(); crankMin = v; onStage('Cranking…'); }
      continue;
    }
    crankMin = Math.min(crankMin, v);
    if (v >= 13.0) {
      highSince ??= t();
      after.push(v);
      if (t() - highSince >= 3) break; // running and charging steadily
    } else {
      highSince = null;
      if (t() - crankedAt > 2.5) after.push(v); // running but not charging much
      if (after.length > 60) break;
    }
  }

  let charging = after.length ? median(after.slice(-15)) : null;
  // Low voltage after cranking could mean "not charging"... or that the
  // engine never caught. Ask the engine computer which it is.
  let didNotStart = false;
  if (crankedAt != null && (charging == null || charging < 13.0) && elm.supports(0x0c) && !(await engineRunning())) {
    didNotStart = true;
    charging = null;
  }
  return {
    resting: round2(resting),
    crankMin: crankMin == null ? null : round2(crankMin),
    charging: charging == null ? null : round2(charging),
    started: crankedAt != null && !didNotStart,
    cranked: crankedAt != null,
    justSwitchedOff,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

// Rough guide for a 12 V lead-acid / AGM battery, measured at the OBD port.
// Cheap dongles read within about ±0.2 V, so these are bands, not verdicts.
export function assessBattery({ resting, crankMin, charging, started, cranked, justSwitchedOff } = {}) {
  const items = [];
  const advice = [];

  if (resting != null) {
    const level = resting >= 12.4 ? 'good' : resting >= 12.2 ? 'watch' : 'bad';
    items.push({
      key: 'resting', label: 'Resting (engine off)', value: resting, level,
      note: {
        good: 'Well charged.',
        watch: 'Partly discharged. Short trips or a long time parked can do this.',
        bad: 'Low. The car may struggle to start, especially when cold.',
      }[level] + (justSwitchedOff ? ' Measured just after the engine stopped, so it reads a little high.' : ''),
    });
  }
  if (crankMin != null) {
    const level = crankMin >= 10.0 ? 'good' : crankMin >= 9.6 ? 'watch' : 'bad';
    items.push({
      key: 'crank', label: 'Lowest while starting', value: crankMin, level,
      note: {
        good: 'The battery handled the starter motor easily.',
        watch: 'A bit weak under load. Worth testing again on a cold morning.',
        bad: 'The battery struggled to power the starter. It is likely near the end of its life.',
      }[level],
    });
  } else if (resting != null) {
    items.push({
      key: 'crank', label: 'Lowest while starting', value: null, level: 'unknown',
      note: started === false ? "We didn't see the engine start, so this wasn't measured." : 'Not measured.',
    });
  }
  if (cranked && !started) {
    advice.push("The engine cranked but didn't seem to start. If it struggles to start often, have the battery and starter checked.");
  }
  if (charging != null) {
    const level = charging > 14.8 ? 'bad' : charging >= 13.5 ? 'good' : charging >= 13.0 ? 'watch' : 'bad';
    items.push({
      key: 'charging', label: 'Charging (engine running)', value: charging, level,
      note: charging > 14.8
        ? 'Too high. The voltage regulator may be faulty, which can damage the battery.'
        : {
          good: 'The alternator is charging the battery normally.',
          watch: 'On the low side. Many modern cars lower the charging voltage on purpose to save fuel, so recheck with the headlights and heater fan on.',
          bad: 'The battery is not being charged. The alternator or its belt may be failing.',
        }[level],
    });
  }

  const has = (k, l) => items.some((i) => i.key === k && i.level === l);
  if (has('crank', 'bad') || has('resting', 'bad')) {
    advice.push('Have the battery load-tested. Many parts shops do it free. Car batteries usually last 4-6 years.');
  }
  if (has('charging', 'bad')) advice.push('Have the alternator and its drive belt checked soon, before the battery goes flat.');
  if (has('resting', 'watch') && !has('crank', 'bad')) advice.push('A longer drive (30+ minutes) or a smart charger overnight should top it up.');

  const levels = items.map((i) => i.level);
  const status = levels.includes('bad') ? 'Needs attention' : levels.includes('watch') ? 'Watch' : 'Good';
  const headline = {
    Good: 'Battery and charging look healthy.',
    Watch: 'Battery is OK, but keep an eye on it.',
    'Needs attention': has('charging', 'bad') ? 'The charging system needs checking.' : 'The battery looks weak.',
  }[status];
  return { status, headline, items, advice };
}

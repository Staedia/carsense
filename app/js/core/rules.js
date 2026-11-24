// Offline "basic check": simple, transparent rules that run with no AI and
// no internet. Used when no API key is set, or as a fallback if the AI call
// fails. Produces the same report shape as the AI.

import { assessBattery } from './battery.js';

// Which cylinder (if any) the car's own misfire counter singles out.
export function misfireOutlier(mc) {
  if (!mc) return null;
  const counts = (mc.last_drive?.some((v) => v != null) ? mc.last_drive : mc.avg_last_10_drives) || [];
  const known = counts.map((v, i) => ({ cyl: i + 1, v })).filter((x) => x.v != null);
  if (known.length < 2) return null;
  const top = known.reduce((a, b) => (b.v > a.v ? b : a));
  const others = known.filter((x) => x !== top).map((x) => x.v).sort((a, b) => a - b);
  const typical = others[Math.floor(others.length / 2)];
  if (top.v >= 20 && top.v >= 3 * (typical + 2)) {
    return { cylinder: top.cyl, count: top.v, othersMax: Math.max(...others), allHigh: false };
  }
  if (known.every((x) => x.v >= 20)) return { cylinder: null, count: top.v, othersMax: top.v, allHigh: true };
  return null;
}

const codesIn = (summary) => [
  ...summary.trouble_codes.stored.map((c) => c.code),
  ...summary.trouble_codes.pending.map((c) => c.code),
];

export function ruleBasedReport(summary) {
  const r = summary.readings || {};
  const ctx = summary.context || {};
  const codes = codesIn(summary);
  const findings = []; // { severity: 3 critical | 2 attention | 1 watch, cause, confidence, reason, checks, codes }
  let safety = null;
  let drive = 'yes';
  let driveNote = 'No signs of a problem that should stop you driving.';

  const ct = r.coolant_temp_c;
  if (ct && ct.max >= 110) {
    safety = `Coolant reached ${ct.max}°C. That is overheating. Pull over, switch off, and let the engine cool before opening anything.`;
    drive = 'no';
    driveNote = 'Driving an overheating engine can warp the cylinder head. Get it checked or towed.';
    findings.push({
      severity: 3, confidence: 'high', codes: ['P0217', 'P0116', 'P0128'],
      cause: 'Engine overheating',
      reason: `Coolant max ${ct.max}°C (normal is about 85-100°C)${ct.trend > 0 ? `, still rising (+${ct.trend}°C)` : ''}.`,
      checks: ['Check the coolant level once the engine is cold', 'Check the radiator fan turns on when hot', 'Look for coolant leaks or a wet hose under the car'],
    });
  } else if (ct && ct.max >= 105) {
    findings.push({
      severity: 1, confidence: 'medium', codes: ['P0217'],
      cause: 'Engine running warm',
      reason: `Coolant max ${ct.max}°C is on the high side.`,
      checks: ['Check the coolant level when cold', 'Check the radiator fan works'],
    });
  }

  const v = r.module_voltage_v || r.adapter_voltage_v;
  if (v && ctx.engine_running) {
    if (v.avg < 13.0) {
      findings.push({
        severity: 2, confidence: 'medium', codes: ['P0562'],
        cause: 'Battery not charging properly',
        reason: `Voltage averaged ${v.avg} V with the engine running; a healthy charging system shows about 13.5-14.7 V.`,
        checks: ['Check the alternator belt for wear or looseness', 'Have the battery and alternator load-tested (many parts shops do it free)'],
      });
      if (drive === 'yes') {
        drive = 'with caution';
        driveNote = 'The car may run until the battery drains, then stall. Avoid long trips until checked.';
      }
    } else if (v.avg > 15.0) {
      findings.push({
        severity: 2, confidence: 'medium', codes: ['P0563'],
        cause: 'Charging voltage too high',
        reason: `Voltage averaged ${v.avg} V, above the usual 14.7 V limit.`,
        checks: ['Have the alternator voltage regulator tested'],
      });
    }
  }

  const st = r.short_term_fuel_trim_pct;
  const lt = r.long_term_fuel_trim_pct;
  if (st && lt) {
    const total = Math.round((st.avg + lt.avg) * 10) / 10;
    if (total >= 10) {
      findings.push({
        severity: 2, confidence: 'medium', codes: ['P0171', 'P0174'],
        cause: 'Engine running lean (too much air or too little fuel)',
        reason: `Fuel trims add up to +${total}% (the computer is adding fuel to compensate). Under ±10% is normal.`,
        checks: ['Listen for a hissing vacuum leak around the intake with the engine idling', 'Clean the air flow (MAF) sensor with MAF cleaner', 'Check the air filter and intake hose clamps', 'Have fuel pressure tested if the above are fine'],
      });
    } else if (total <= -10) {
      findings.push({
        severity: 2, confidence: 'medium', codes: ['P0172', 'P0175'],
        cause: 'Engine running rich (too much fuel)',
        reason: `Fuel trims add up to ${total}% (the computer is removing fuel). Under ±10% is normal.`,
        checks: ['Check the air filter is not clogged', 'Have the front O2 sensor and injectors checked'],
      });
    }
  }

  const rpm = r.rpm;
  const misfireCode = codes.some((c) => /^P030\d$/.test(c));
  const counter = misfireOutlier(summary.misfire_counts);
  const counterText = counter && (counter.cylinder
    ? `the car's misfire counter logged ${counter.count} misfires on cylinder ${counter.cylinder} (others ${counter.othersMax} or fewer)`
    : `the car's misfire counter shows misfires on every cylinder (up to ${counter.count})`);
  if ((rpm && ctx.engine_running && ctx.idling && rpm.std > 35) || misfireCode) {
    const codeCyl = codes.find((c) => /^P030[1-9]$/.test(c))?.slice(-1);
    const cyl = codeCyl || counter?.cylinder;
    findings.push({
      severity: 2, confidence: misfireCode || counter ? 'high' : 'low', codes: ['P0300', 'P0301', 'P0302', 'P0303', 'P0304'],
      cause: cyl ? `Misfire on cylinder ${cyl}` : 'Rough idle / possible misfire',
      reason: [
        misfireCode ? `Misfire code ${codes.filter((c) => /^P030/.test(c)).join(', ')}` : null,
        counterText,
        rpm ? `idle RPM wobbles by about ±${Math.round(rpm.std * 2)}` : null,
      ].filter(Boolean).join('; ').replace(/^./, (c) => c.toUpperCase()) + '.',
      checks: cyl
        ? [`Swap the cylinder ${cyl} ignition coil with a neighbour and see if the misfire moves`, 'Inspect or replace the spark plugs', 'Check the injector connector on that cylinder']
        : ['Inspect the spark plugs and ignition coils', 'Check for vacuum leaks'],
    });
    if (drive === 'yes') {
      drive = 'with caution';
      driveNote = 'Short gentle trips are usually OK, but a flashing check-engine light means stop: raw fuel can damage the catalytic converter.';
    }
  } else if (counter) {
    // No code and a smooth idle, but the car is quietly counting misfires.
    findings.push({
      severity: 1, confidence: 'medium', codes: [],
      cause: counter.cylinder ? `Early signs of a misfire on cylinder ${counter.cylinder}` : 'Small misfires on several cylinders',
      reason: `No trouble code yet, but ${counterText}.`,
      checks: counter.cylinder
        ? [`Inspect the spark plug and ignition coil on cylinder ${counter.cylinder}`, 'Run the check again after your next drive to see if the count keeps rising']
        : ['Check for vacuum leaks and the condition of the spark plugs', 'Use good-quality fuel from a busy station'],
    });
  }

  // Unfinished self-tests soon after codes were cleared: problems may be hidden.
  const snap = summary.snapshot || {};
  const selfTests = summary.emissions_self_tests;
  const dist = snap.distance_since_codes_cleared_km;
  const warmups = snap.warmups_since_codes_cleared;
  const recentlyCleared = (dist != null && dist < 160) || (warmups != null && warmups < 10);
  const pendingTests = selfTests?.incomplete?.length ? selfTests.incomplete : null;
  if (pendingTests && recentlyCleared) {
    findings.push({
      severity: 1, confidence: 'medium', codes: [],
      cause: 'Trouble codes were cleared recently',
      reason: `Only ${[dist != null ? `${dist} km` : null, warmups != null ? `${warmups} warm-ups` : null].filter(Boolean).join(' and ')} since codes were cleared, and ${pendingTests.length} self-test${pendingTests.length > 1 ? 's have' : ' has'} not finished (${pendingTests.join(', ')}). An old fault may come back once they do.`,
      checks: ['If you are buying this car, ask why the codes were cleared', 'Drive normally for a few days, including some steady faster roads, then run the check again'],
    });
  }

  // Battery test results, if the driver ran one this session.
  const bt = summary.battery_test;
  if (bt) {
    const a = assessBattery({ resting: bt.resting_v, crankMin: bt.cranking_min_v, charging: bt.charging_v });
    const bad = a.items.filter((i) => i.level === 'bad' || i.level === 'watch');
    const alreadyCharging = findings.some((f) => f.codes.includes('P0562'));
    const batteryItems = bad.filter((i) => i.key !== 'charging' || !alreadyCharging);
    if (batteryItems.length) {
      const worst = batteryItems.some((i) => i.level === 'bad') ? 2 : 1;
      const chargingOnly = batteryItems.every((i) => i.key === 'charging');
      findings.push({
        severity: worst, confidence: 'medium', codes: [],
        cause: chargingOnly ? 'Battery not being charged properly' : 'Weak battery',
        reason: `Battery test: ${batteryItems.map((i) => `${i.label.toLowerCase()} ${i.value.toFixed(2)} V`).join(', ')}. ${batteryItems[0].note}`,
        checks: a.advice.length ? a.advice : ['Recheck the battery after a longer drive'],
      });
    }
  }

  const s1 = r.o2_b1s1_v;
  const s2 = r.o2_b1s2_v;
  if (s1 && s2 && s1.switches >= 4 && s2.switches >= 0.6 * s1.switches) {
    findings.push({
      severity: 1, confidence: codes.includes('P0420') ? 'high' : 'low', codes: ['P0420'],
      cause: 'Catalytic converter may be worn',
      reason: `The rear O2 sensor switched ${s2.switches} times vs ${s1.switches} for the front. A healthy catalyst keeps the rear one steady.`,
      checks: ['Rule out exhaust leaks before the rear O2 sensor', 'Fix any misfire or fuel trim problem first, they damage catalysts'],
    });
  }

  // Any code not explained by a rule above becomes its own finding.
  const explained = new Set(findings.flatMap((f) => f.codes));
  for (const c of [...summary.trouble_codes.stored, ...summary.trouble_codes.pending]) {
    if (explained.has(c.code)) continue;
    explained.add(c.code);
    const pendingOnly = !summary.trouble_codes.stored.some((s) => s.code === c.code);
    findings.push({
      severity: 1, confidence: 'medium', codes: [c.code],
      cause: `${c.code}: ${c.description}`,
      reason: pendingOnly ? 'Pending code: the car has seen this once but not confirmed it yet.' : 'Stored trouble code.',
      checks: [`Look up ${c.code} for your exact model; the AI analysis can explain it in detail`],
    });
  }

  findings.sort((a, b) => b.severity - a.severity);
  const top = findings.slice(0, 3);
  const maxSev = top[0]?.severity || 0;
  let status = maxSev >= 2 ? 'Needs attention' : maxSev === 1 ? 'Watch' : 'Good';
  if (status === 'Good' && summary.check_engine_light_on) status = 'Watch';

  const missing = [];
  if (ctx.warmed_up === false) missing.push('The engine was not fully warm. Rerun after a 10-15 minute drive for reliable fuel trim readings.');
  if (ctx.engine_running === false) missing.push('The engine seemed off. Start it and rerun to get live sensor data.');
  if (!r.module_voltage_v && !r.adapter_voltage_v) missing.push('Battery voltage was not available.');
  if (pendingTests && !recentlyCleared) {
    missing.push(`${pendingTests.length} of the car's emissions self-tests have not finished yet (${pendingTests.join(', ')}). They complete during normal driving.`);
  }

  const headline = {
    Good: 'No problems found. Your engine looks healthy.',
    Watch: `Mostly fine, but keep an eye on: ${top.map((f) => f.cause.toLowerCase()).join('; ') || 'the check engine light'}.`,
    'Needs attention': `${top[0]?.cause || 'A problem'} needs attention.`,
  }[status];

  return {
    source: 'rules',
    status,
    headline,
    safety_warning: safety,
    likely_causes: top.map(({ cause, confidence, reason }) => ({ cause, confidence, reason })),
    checks: [...new Set(top.flatMap((f) => f.checks))].slice(0, 4),
    safe_to_drive: drive,
    safe_to_drive_note: driveNote,
    missing_data: missing,
    summary: status === 'Good'
      ? 'Coolant, battery, fuel trims and idle are all in normal ranges and there are no trouble codes.'
      : `${top.map((f) => f.reason).join(' ')} This is a basic rule-based check; the AI analysis gives a fuller diagnosis.`,
  };
}

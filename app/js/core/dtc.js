// Diagnostic Trouble Codes (DTCs): decoding the two-byte format and a
// lookup table of common generic (SAE) powertrain codes.

const LETTERS = ['P', 'C', 'B', 'U'];

export function decodeDtc(b1, b2) {
  const letter = LETTERS[b1 >> 6];
  const d1 = (b1 >> 4) & 0x3;
  const rest = (b1 & 0x0f).toString(16) + b2.toString(16).padStart(2, '0');
  return `${letter}${d1}${rest}`.toUpperCase();
}

export function encodeDtc(code) {
  const letter = LETTERS.indexOf(code[0].toUpperCase());
  const d1 = parseInt(code[1], 16);
  const d2 = parseInt(code[2], 16);
  const b2 = parseInt(code.slice(3, 5), 16);
  return [(letter << 6) | (d1 << 4) | d2, b2];
}

// Turn the data bytes of a Mode 03/07/0A response into codes.
// `bytes` starts with the response mode byte (0x43, 0x47 or 0x4A).
// On CAN cars the byte after the mode is the number of codes; on older
// protocols codes follow directly, padded with 00 00.
export function parseDtcBytes(bytes, isCan) {
  let data = bytes.slice(1);
  if (isCan) {
    const count = data[0];
    data = data.slice(1, 1 + count * 2);
  }
  const codes = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    if (data[i] === 0 && data[i + 1] === 0) continue;
    codes.push(decodeDtc(data[i], data[i + 1]));
  }
  return codes;
}

const KNOWN = {
  P0010: 'Camshaft position actuator circuit (bank 1)',
  P0011: 'Camshaft timing over-advanced or system performance (bank 1)',
  P0016: 'Crankshaft/camshaft position correlation (bank 1, sensor A)',
  P0030: 'O2 sensor heater control circuit (bank 1, sensor 1)',
  P0101: 'Mass air flow (MAF) circuit range/performance',
  P0102: 'Mass air flow (MAF) circuit low',
  P0103: 'Mass air flow (MAF) circuit high',
  P0106: 'Manifold pressure (MAP) circuit range/performance',
  P0107: 'Manifold pressure (MAP) circuit low',
  P0108: 'Manifold pressure (MAP) circuit high',
  P0112: 'Intake air temperature sensor circuit low',
  P0113: 'Intake air temperature sensor circuit high',
  P0115: 'Engine coolant temperature sensor circuit',
  P0116: 'Engine coolant temperature sensor range/performance',
  P0117: 'Engine coolant temperature sensor circuit low',
  P0118: 'Engine coolant temperature sensor circuit high',
  P0120: 'Throttle position sensor A circuit',
  P0121: 'Throttle position sensor A range/performance',
  P0122: 'Throttle position sensor A circuit low',
  P0123: 'Throttle position sensor A circuit high',
  P0125: 'Insufficient coolant temperature for closed-loop fuel control',
  P0128: 'Coolant thermostat: temperature below regulating temperature',
  P0130: 'O2 sensor circuit (bank 1, sensor 1)',
  P0131: 'O2 sensor circuit low voltage (bank 1, sensor 1)',
  P0132: 'O2 sensor circuit high voltage (bank 1, sensor 1)',
  P0133: 'O2 sensor slow response (bank 1, sensor 1)',
  P0134: 'O2 sensor no activity detected (bank 1, sensor 1)',
  P0135: 'O2 sensor heater circuit (bank 1, sensor 1)',
  P0136: 'O2 sensor circuit (bank 1, sensor 2)',
  P0137: 'O2 sensor circuit low voltage (bank 1, sensor 2)',
  P0138: 'O2 sensor circuit high voltage (bank 1, sensor 2)',
  P0141: 'O2 sensor heater circuit (bank 1, sensor 2)',
  P0171: 'System too lean (bank 1)',
  P0172: 'System too rich (bank 1)',
  P0174: 'System too lean (bank 2)',
  P0175: 'System too rich (bank 2)',
  P0201: 'Injector circuit, cylinder 1',
  P0202: 'Injector circuit, cylinder 2',
  P0203: 'Injector circuit, cylinder 3',
  P0204: 'Injector circuit, cylinder 4',
  P0217: 'Engine overtemperature condition',
  P0219: 'Engine overspeed condition',
  P0300: 'Random/multiple cylinder misfire detected',
  P0301: 'Cylinder 1 misfire detected',
  P0302: 'Cylinder 2 misfire detected',
  P0303: 'Cylinder 3 misfire detected',
  P0304: 'Cylinder 4 misfire detected',
  P0325: 'Knock sensor 1 circuit (bank 1)',
  P0327: 'Knock sensor 1 circuit low (bank 1)',
  P0335: 'Crankshaft position sensor A circuit',
  P0340: 'Camshaft position sensor A circuit (bank 1)',
  P0351: 'Ignition coil A primary/secondary circuit',
  P0352: 'Ignition coil B primary/secondary circuit',
  P0353: 'Ignition coil C primary/secondary circuit',
  P0354: 'Ignition coil D primary/secondary circuit',
  P0401: 'EGR flow insufficient',
  P0420: 'Catalyst system efficiency below threshold (bank 1)',
  P0440: 'Evaporative emission (EVAP) system',
  P0441: 'EVAP system incorrect purge flow',
  P0442: 'EVAP system small leak detected',
  P0443: 'EVAP purge control valve circuit',
  P0455: 'EVAP system large leak detected',
  P0456: 'EVAP system very small leak detected',
  P0461: 'Fuel level sensor A circuit range/performance',
  P0500: 'Vehicle speed sensor A',
  P0505: 'Idle air control system',
  P0506: 'Idle control system RPM lower than expected',
  P0507: 'Idle control system RPM higher than expected',
  P0562: 'System voltage low',
  P0563: 'System voltage high',
  P0601: 'Internal control module memory checksum error',
  P0606: 'Control module processor',
  P0650: 'Malfunction indicator lamp (MIL) control circuit',
  P0700: 'Transmission control system (MIL request)',
  P0705: 'Transmission range sensor circuit',
  P0715: 'Input/turbine speed sensor A circuit',
  P2096: 'Post-catalyst fuel trim system too lean (bank 1)',
  P2097: 'Post-catalyst fuel trim system too rich (bank 1)',
  P2135: 'Throttle/pedal position sensor A/B voltage correlation',
};

const FAMILY = {
  P0: 'Generic powertrain code',
  P1: 'Manufacturer-specific powertrain code',
  P2: 'Generic powertrain code',
  P3: 'Powertrain code',
  C0: 'Chassis code', C1: 'Manufacturer-specific chassis code',
  B0: 'Body code', B1: 'Manufacturer-specific body code',
  U0: 'Network/communication code', U1: 'Manufacturer-specific network code',
};

export function describeDtc(code) {
  if (KNOWN[code]) return { code, description: KNOWN[code], known: true };
  const family = FAMILY[code.slice(0, 2)] || 'Trouble code';
  return { code, description: `${family} (not in local table)`, known: false };
}

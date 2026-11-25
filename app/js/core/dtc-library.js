// Offline trouble-code library: titles for ~370 generic (SAE J2012) codes,
// plus plain-English explanations grouped by fault type ("families").
// No AI, no internet: every driver gets a useful explanation for free.
//
// Titles are generated from the standard numbering patterns (e.g. P0301-
// P0312 = misfire on cylinder 1-12) plus a table of one-off codes. Codes
// starting P1/P3/B1/C1/U1 are manufacturer-specific and need the maker's
// own list; we say so instead of guessing.

// ---------- families: what it means, how serious, what to do ----------
// severity: 'stop'  stop driving / risk of serious damage or danger
//           'high'  get it fixed soon, it can cause damage
//           'medium' fix when you can; may affect economy or emissions
//           'low'   minor, fix at the next service
// drive: 'yes' | 'with caution' | 'no'
export const FAMILIES = {
  misfire: {
    name: 'Engine misfire', severity: 'high', drive: 'with caution',
    meaning: "One or more cylinders isn't burning its fuel properly. You may feel shaking, especially at idle, or a lack of power.",
    causes: ['Worn spark plug', 'Faulty ignition coil', 'Blocked or leaking fuel injector', 'Vacuum leak'],
    checks: ['Inspect the spark plugs', 'Swap the ignition coil with another cylinder and see if the misfire moves', 'Check the injector connector'],
    note: 'If the check-engine light is flashing, stop driving: unburnt fuel can overheat and ruin the catalytic converter.',
  },
  misfireRandom: {
    name: 'Engine misfire (several cylinders)', severity: 'high', drive: 'with caution',
    meaning: 'Misfires are happening on more than one cylinder, so the cause is usually something they all share.',
    causes: ['Vacuum leak', 'Worn spark plugs', 'Low fuel pressure', 'Dirty air flow sensor'],
    checks: ['Check for vacuum leaks (hissing at idle)', 'Inspect the spark plugs', 'Have fuel pressure tested'],
    note: 'If the check-engine light is flashing, stop driving: unburnt fuel can ruin the catalytic converter.',
  },
  injector: {
    name: 'Fuel injector fault', severity: 'high', drive: 'with caution',
    meaning: "The engine computer sees an electrical problem with a fuel injector, so that cylinder may not get the right amount of fuel.",
    causes: ['Damaged injector wiring or connector', 'Failed injector', 'Engine computer driver fault (rare)'],
    checks: ['Check the injector connector is clipped on and not corroded', 'Have the injector resistance tested'],
  },
  coil: {
    name: 'Ignition coil fault', severity: 'high', drive: 'with caution',
    meaning: 'An ignition coil, which makes the spark for one cylinder, has an electrical fault. It usually causes a misfire.',
    causes: ['Failed ignition coil', 'Damaged coil connector or wiring', 'Worn spark plug overloading the coil'],
    checks: ['Swap the coil with another cylinder and see if the fault moves', 'Inspect the connector and spark plug'],
  },
  o2Front: {
    name: 'Front oxygen (O2) sensor fault', severity: 'medium', drive: 'yes',
    meaning: 'The sensor before the catalytic converter, which the engine uses to set the fuel mix, is reading wrong or not responding.',
    causes: ['Ageing O2 sensor (they wear out around 100,000-160,000 km)', 'Exhaust leak near the sensor', 'Damaged wiring', 'Engine running lean or rich for another reason'],
    checks: ['Look for exhaust leaks before the sensor', 'Check the sensor wiring', 'Replace the sensor if it is old'],
    note: 'Left too long, fuel economy drops and the catalytic converter can be damaged.',
  },
  o2Rear: {
    name: 'Rear oxygen (O2) sensor fault', severity: 'low', drive: 'yes',
    meaning: 'The sensor after the catalytic converter is reading wrong. It mainly monitors the converter, so the engine itself runs fine.',
    causes: ['Ageing O2 sensor', 'Exhaust leak', 'Damaged wiring'],
    checks: ['Check for exhaust leaks', 'Check the sensor wiring', 'Replace the sensor'],
  },
  o2Heater: {
    name: 'Oxygen sensor heater fault', severity: 'medium', drive: 'yes',
    meaning: "The built-in heater that gets the O2 sensor working quickly from cold has failed, so fuel control is poorer until the engine is warm.",
    causes: ['Failed O2 sensor (the heater is built in)', 'Blown fuse for the heater circuit', 'Damaged wiring'],
    checks: ['Check the O2 sensor heater fuse', 'Inspect the wiring', 'Replace the sensor'],
  },
  lean: {
    name: 'Engine running lean', severity: 'medium', drive: 'yes',
    meaning: 'The engine is getting too much air or too little fuel, and the computer has hit its limit trying to correct it.',
    causes: ['Vacuum leak (split hose, intake gasket)', 'Dirty air flow (MAF) sensor', 'Weak fuel pump or blocked fuel filter', 'Exhaust leak before the O2 sensor'],
    checks: ['Listen for hissing around the intake at idle', 'Clean the MAF sensor with MAF cleaner', 'Check intake hoses and clamps', 'Have fuel pressure tested'],
    note: 'Driving lean for a long time can cause misfires and overheat the engine.',
  },
  rich: {
    name: 'Engine running rich', severity: 'medium', drive: 'yes',
    meaning: 'The engine is getting too much fuel, and the computer has hit its limit trying to correct it. Fuel economy will suffer.',
    causes: ['Leaking fuel injector', 'Faulty front O2 sensor', 'Very dirty air filter', 'Faulty fuel pressure regulator'],
    checks: ['Check the air filter', 'Have the injectors and fuel pressure checked'],
    note: 'Running rich for a long time can damage the catalytic converter.',
  },
  catalyst: {
    name: 'Catalytic converter efficiency low', severity: 'medium', drive: 'yes',
    meaning: "The catalytic converter isn't cleaning the exhaust as well as it should. The car drives normally, but emissions are higher.",
    causes: ['Worn catalytic converter', 'Faulty rear O2 sensor giving a false reading', 'Exhaust leak', 'Past misfires or oil burning damaged it'],
    checks: ['Fix any misfire or fuel mix problem first', 'Check for exhaust leaks', 'Test the rear O2 sensor before replacing the converter'],
    note: 'Converters are expensive. Rule out the cheap causes first.',
  },
  vvt: {
    name: 'Variable valve timing fault', severity: 'medium', drive: 'with caution',
    meaning: "The system that adjusts the camshaft timing isn't working as commanded. You may notice rough idle or less power.",
    causes: ['Low or old engine oil (it powers the system)', 'Sticking oil control solenoid', 'Stretched timing chain', 'Faulty cam phaser'],
    checks: ['Check the oil level and when it was last changed', 'Have the oil control solenoid tested', 'If the code returns, have the timing chain checked'],
    note: 'A stretched timing chain can break and wreck the engine. Don\'t ignore this if it keeps coming back.',
  },
  crankCam: {
    name: 'Crank or camshaft sensor fault', severity: 'high', drive: 'with caution',
    meaning: 'The sensors that tell the computer where the engine is in its cycle are faulty or disagree. The engine may stall or fail to start.',
    causes: ['Failed crank or cam sensor', 'Damaged wiring or connector', 'Timing chain or belt has stretched or jumped'],
    checks: ['Inspect the sensor connector and wiring', 'Have the sensor tested', 'If paired with timing codes, have the timing checked'],
  },
  knock: {
    name: 'Knock sensor fault', severity: 'medium', drive: 'yes',
    meaning: "The sensor that listens for harmful engine knock isn't working, so the computer plays safe and reduces power.",
    causes: ['Damaged wiring or connector', 'Failed knock sensor', 'Sensor not tightened properly'],
    checks: ['Inspect the wiring', 'Have the sensor tested'],
  },
  airSensor: {
    name: 'Air flow / intake pressure sensor fault', severity: 'medium', drive: 'with caution',
    meaning: "A sensor that measures the air going into the engine is reading wrong, so the fuel mix can't be set properly.",
    causes: ['Dirty or failed air flow (MAF) sensor', 'Air leak after the sensor', 'Split vacuum hose to the MAP sensor', 'Damaged wiring'],
    checks: ['Clean the MAF sensor with MAF cleaner', 'Check the intake ducting for cracks', 'Inspect the wiring'],
  },
  tempSensor: {
    name: 'Temperature sensor fault', severity: 'low', drive: 'yes',
    meaning: 'A temperature sensor is reading out of range or its circuit has a fault.',
    causes: ['Failed sensor', 'Damaged wiring or connector'],
    checks: ['Inspect the connector', 'Have the sensor tested'],
  },
  coolantSensor: {
    name: 'Coolant temperature sensor fault', severity: 'medium', drive: 'with caution',
    meaning: "The engine computer can't trust its coolant temperature reading, which affects fuel mix, the cooling fan and the temperature gauge.",
    causes: ['Failed coolant temperature sensor', 'Damaged wiring', 'Low coolant leaving the sensor in air'],
    checks: ['Check the coolant level when cold', 'Inspect the sensor connector', 'Replace the sensor (usually cheap)'],
    note: 'Watch the temperature gauge: if the fan relies on this sensor, the engine could overheat.',
  },
  thermostat: {
    name: 'Engine not warming up properly', severity: 'medium', drive: 'yes',
    meaning: "The engine takes too long to reach its normal temperature. Usually the thermostat is stuck open.",
    causes: ['Thermostat stuck open', 'Faulty coolant temperature sensor', 'Low coolant'],
    checks: ['Check the coolant level when cold', 'Replace the thermostat'],
    note: 'Fuel economy and cabin heating suffer, and engine wear increases, but it is not urgent.',
  },
  throttle: {
    name: 'Throttle or pedal sensor fault', severity: 'high', drive: 'with caution',
    meaning: 'The electronic throttle or accelerator pedal sensor has a fault. The car may go into "limp mode" with very little power.',
    causes: ['Dirty throttle body', 'Failed throttle position or pedal sensor', 'Damaged wiring or connector'],
    checks: ['Clean the throttle body', 'Inspect the throttle and pedal connectors', 'Have the sensors tested'],
  },
  overheat: {
    name: 'Engine overheating', severity: 'stop', drive: 'no',
    meaning: 'The engine has got dangerously hot.',
    causes: ['Low coolant (leak)', 'Cooling fan not working', 'Stuck thermostat', 'Failed water pump'],
    checks: ['Stop and let the engine cool. Never open a hot radiator cap', 'Check the coolant level when cold', 'Check the cooling fan runs when hot'],
    note: 'Driving an overheating engine can warp the cylinder head: a very expensive repair.',
  },
  evapSmall: {
    name: 'Fuel vapour leak (small)', severity: 'low', drive: 'yes',
    meaning: 'The system that stops petrol fumes escaping from the tank has a small leak. It doesn\'t affect how the car drives.',
    causes: ['Fuel cap not tight or seal worn', 'Cracked vapour hose', 'Leaking purge or vent valve'],
    checks: ['Check the fuel cap clicks shut and the seal is intact', 'Have a smoke test done to find the leak'],
  },
  evapLarge: {
    name: 'Fuel vapour leak (large) or loose cap', severity: 'low', drive: 'yes',
    meaning: 'A big leak in the fuel vapour system. Most often the fuel cap was left loose after refuelling.',
    causes: ['Fuel cap loose, missing or wrong type', 'Disconnected or split vapour hose', 'Stuck vent valve'],
    checks: ['Tighten the fuel cap until it clicks; the light can take a few days to go out', 'Check vapour hoses near the tank'],
  },
  evapValve: {
    name: 'Fuel vapour valve fault', severity: 'low', drive: 'yes',
    meaning: 'A valve or sensor in the fuel vapour system has a fault. You may notice the car is hard to start right after refuelling.',
    causes: ['Faulty purge valve', 'Faulty vent valve', 'Damaged wiring'],
    checks: ['Have the purge and vent valves tested', 'Inspect the wiring'],
  },
  egr: {
    name: 'Exhaust gas recirculation (EGR) fault', severity: 'medium', drive: 'yes',
    meaning: "The EGR system, which feeds some exhaust back into the engine to cut emissions, isn't flowing correctly.",
    causes: ['Carbon build-up in the EGR valve or passages', 'Failed EGR valve', 'Damaged wiring'],
    checks: ['Have the EGR valve cleaned or replaced', 'Check the EGR passages for carbon'],
  },
  secondaryAir: {
    name: 'Secondary air system fault', severity: 'low', drive: 'yes',
    meaning: 'The pump that blows extra air into the exhaust to warm the catalytic converter quickly from cold is not working.',
    causes: ['Failed air pump', 'Stuck check valve', 'Blown fuse or relay'],
    checks: ['Check the air pump fuse and relay', 'Have the pump and valve tested'],
  },
  fuelLevel: {
    name: 'Fuel level sensor fault', severity: 'low', drive: 'yes',
    meaning: 'The fuel gauge sender in the tank is giving a bad reading, so the fuel gauge may be wrong.',
    causes: ['Worn fuel level sender', 'Damaged wiring'],
    checks: ["Don't rely on the fuel gauge: track your kilometres since filling up", 'Have the sender replaced'],
  },
  fan: {
    name: 'Cooling fan fault', severity: 'high', drive: 'with caution',
    meaning: "The radiator cooling fan circuit has a fault, so the engine may overheat in traffic or on hot days.",
    causes: ['Failed fan motor', 'Blown fuse or failed relay', 'Damaged wiring'],
    checks: ['Check the fan fuse and relay', 'See if the fan runs when the engine is hot'],
    note: 'Keep an eye on the temperature gauge, especially in slow traffic.',
  },
  speedSensor: {
    name: 'Vehicle speed sensor fault', severity: 'medium', drive: 'with caution',
    meaning: "The engine computer isn't getting a good speed signal. The speedometer, cruise control or gear changes may act up.",
    causes: ['Failed speed sensor', 'Damaged wiring', 'ABS wheel speed sensor fault (on many cars)'],
    checks: ['Check whether the speedometer works', 'Inspect the sensor wiring', 'Check for ABS warning lights'],
  },
  idle: {
    name: 'Idle speed fault', severity: 'low', drive: 'yes',
    meaning: "The engine's idle speed is higher or lower than the computer wants.",
    causes: ['Dirty throttle body', 'Vacuum leak', 'Faulty idle control valve (older cars)'],
    checks: ['Clean the throttle body', 'Check for vacuum leaks'],
  },
  oilPressure: {
    name: 'Engine oil pressure fault', severity: 'stop', drive: 'no',
    meaning: 'The engine oil pressure is too low, or its sensor has failed. Without oil pressure the engine can be destroyed in minutes.',
    causes: ['Low oil level', 'Worn oil pump or engine bearings', 'Failed oil pressure sensor'],
    checks: ['Stop and check the oil level now', 'Do not drive until the oil pressure is confirmed OK'],
  },
  oilPressureSensor: {
    name: 'Oil pressure sensor circuit fault', severity: 'medium', drive: 'with caution',
    meaning: 'The oil pressure sensor or its wiring has an electrical fault, so the oil warning may not be reliable.',
    causes: ['Failed oil pressure sensor', 'Damaged wiring'],
    checks: ['Check the oil level', 'Have the sensor replaced'],
  },
  voltage: {
    name: 'System voltage fault', severity: 'high', drive: 'with caution',
    meaning: 'The electrical system voltage is out of range: usually the battery is not being charged properly.',
    causes: ['Failing alternator', 'Worn or loose alternator belt', 'Weak battery', 'Corroded battery terminals'],
    checks: ['Run the battery test in the app', 'Check the battery terminals are clean and tight', 'Have the alternator tested'],
    note: 'If the battery is not charging, the car may stall once the battery runs down.',
  },
  charging: {
    name: 'Alternator (charging) circuit fault', severity: 'high', drive: 'with caution',
    meaning: 'The engine computer sees a fault in the alternator control circuit, so the battery may not charge.',
    causes: ['Failing alternator', 'Damaged wiring', 'Loose belt'],
    checks: ['Run the battery test in the app', 'Have the alternator tested'],
  },
  module: {
    name: 'Engine computer internal fault', severity: 'high', drive: 'with caution',
    meaning: 'The engine control module has reported an internal problem with its memory or processor.',
    causes: ['Low or unstable battery voltage', 'Software problem', 'Failed control module'],
    checks: ['Make sure the battery is healthy first', 'Ask a garage about a software update', 'Clear the code and see if it returns'],
  },
  sensorRef: {
    name: 'Sensor supply voltage fault', severity: 'high', drive: 'with caution',
    meaning: 'The 5 V supply that several sensors share has a fault, so several readings may be wrong at once.',
    causes: ['Shorted sensor pulling the supply down', 'Damaged wiring'],
    checks: ['Look for other sensor codes at the same time', 'Have the wiring checked'],
  },
  mil: {
    name: 'Warning light circuit fault', severity: 'low', drive: 'yes',
    meaning: "The circuit for the check-engine light itself has a fault, so you might not see future warnings.",
    causes: ['Failed bulb or LED', 'Wiring or instrument cluster fault'],
    checks: ['Check the light comes on briefly when you switch the ignition on'],
  },
  transmission: {
    name: 'Automatic transmission fault', severity: 'high', drive: 'with caution',
    meaning: 'The gearbox computer has found a problem. Gear changes may be harsh, or the gearbox may stay in one gear ("limp mode").',
    causes: ['Low or old transmission fluid', 'Faulty shift solenoid', 'Faulty speed sensor', 'Internal wear'],
    checks: ['Check the transmission fluid if your car has a dipstick', 'Have a transmission specialist read the gearbox codes'],
  },
  fuelPressure: {
    name: 'Fuel pressure fault', severity: 'high', drive: 'with caution',
    meaning: "The fuel pressure is out of range or its sensor has a fault. The engine may hesitate, lose power or stall.",
    causes: ['Weak fuel pump', 'Blocked fuel filter', 'Failed fuel pressure sensor or regulator', 'Wiring fault'],
    checks: ['Have fuel pressure tested', 'Replace the fuel filter if it is due'],
  },
  fuelPump: {
    name: 'Fuel pump circuit fault', severity: 'high', drive: 'with caution',
    meaning: 'The fuel pump control circuit has a fault. The engine could cut out or fail to start.',
    causes: ['Failed fuel pump relay or fuse', 'Damaged wiring', 'Failing fuel pump'],
    checks: ['Check the fuel pump fuse and relay', 'Have the pump and wiring tested'],
  },
  turbo: {
    name: 'Turbo boost fault', severity: 'medium', drive: 'with caution',
    meaning: 'The turbo boost pressure is too low, too high or the boost sensor is faulty. Expect reduced power.',
    causes: ['Split or loose intercooler hose', 'Faulty wastegate or boost control valve', 'Failed boost sensor', 'Worn turbo'],
    checks: ['Check the intercooler hoses for splits and loose clamps', 'Have the boost control system tested'],
  },
  dpf: {
    name: 'Diesel particulate filter fault', severity: 'high', drive: 'with caution',
    meaning: 'The diesel soot filter is getting blocked or not cleaning itself.',
    causes: ['Mostly short trips, so the filter never gets hot enough to clean itself', 'Faulty pressure sensor', 'Injector or EGR problem making extra soot'],
    checks: ['Drive 20+ minutes at a steady motorway speed to help it clean itself', 'Have a forced regeneration done at a garage'],
    note: 'A fully blocked filter can need replacing, which is expensive. Act early.',
  },
  glowPlug: {
    name: 'Glow plug fault (diesel)', severity: 'medium', drive: 'yes',
    meaning: 'A glow plug, which helps a diesel start from cold, or its control circuit has failed.',
    causes: ['Failed glow plug', 'Failed glow plug relay or module', 'Damaged wiring'],
    checks: ['Have the glow plugs tested', 'Expect harder starting on cold mornings until fixed'],
  },
  network: {
    name: 'Communication fault between computers', severity: 'medium', drive: 'with caution',
    meaning: "Two of the car's computers stopped talking to each other for a while. Features controlled by that module may not work.",
    causes: ['Low battery voltage (very common)', 'Loose or corroded connector', 'Damaged network wiring', 'Failed module'],
    checks: ['Run the battery test in the app: low voltage causes many of these', 'Clear the code and see if it returns', 'Have the wiring to the named module checked'],
  },
  makerSpecific: {
    name: 'Manufacturer-specific code', severity: null, drive: null,
    meaning: "This code is defined by your car's manufacturer, not the generic standard, so its exact meaning depends on the make.",
    causes: [],
    checks: ['Look the code up for your exact make and model, or ask a garage with a dealer-level scanner'],
  },
};

// ---------- code titles ----------
const T = {}; // code -> [title, family]
const add = (code, title, family) => { T[code] = [title, family]; };
const p = (n) => `P${String(n).padStart(4, '0')}`;
const cylName = (n) => `cylinder ${n}`;

// Sensor circuits that follow the standard five-code pattern:
// +0 circuit, +1 range/performance, +2 low, +3 high, +4 intermittent.
const FIVE = ['circuit', 'circuit range/performance', 'circuit low', 'circuit high', 'circuit intermittent'];
function five(base, name, family, count = 5) {
  FIVE.slice(0, count).forEach((s, i) => add(p(base + i), `${name} ${s}`, family));
}

five(100, 'Mass air flow (MAF) sensor', 'airSensor');
five(105, 'Manifold pressure (MAP) sensor', 'airSensor');
five(110, 'Intake air temperature sensor', 'tempSensor');
five(115, 'Engine coolant temperature sensor', 'coolantSensor');
five(120, 'Throttle/pedal position sensor A', 'throttle');
five(220, 'Throttle/pedal position sensor B', 'throttle');
five(225, 'Throttle/pedal position sensor C', 'throttle');
five(190, 'Fuel rail pressure sensor', 'fuelPressure');
five(335, 'Crankshaft position sensor A', 'crankCam');
five(340, 'Camshaft position sensor A (bank 1)', 'crankCam');
five(345, 'Camshaft position sensor A (bank 2)', 'crankCam');
five(365, 'Camshaft position sensor B (bank 1)', 'crankCam');
five(390, 'Camshaft position sensor B (bank 2)', 'crankCam');
five(450, 'EVAP pressure sensor', 'evapValve');
five(460, 'Fuel level sensor A', 'fuelLevel');
five(520, 'Engine oil pressure sensor/switch', 'oilPressureSensor');
five(530, 'A/C refrigerant pressure sensor A', 'tempSensor', 4); // P0534 is refrigerant charge loss
five(710, 'Transmission fluid temperature sensor A', 'transmission');
five(235, 'Turbocharger boost sensor A', 'turbo', 4); // P0239 is boost sensor B

add('P0125', 'Insufficient coolant temperature for closed-loop fuel control', 'thermostat');
add('P0126', 'Insufficient coolant temperature for stable operation', 'thermostat');
add('P0128', 'Coolant thermostat: temperature below regulating temperature', 'thermostat');

// Oxygen sensors: six codes per sensor position.
const O2 = [
  [130, 'bank 1, sensor 1', 'o2Front'], [136, 'bank 1, sensor 2', 'o2Rear'], [142, 'bank 1, sensor 3', 'o2Rear'],
  [150, 'bank 2, sensor 1', 'o2Front'], [156, 'bank 2, sensor 2', 'o2Rear'], [162, 'bank 2, sensor 3', 'o2Rear'],
];
for (const [base, where, family] of O2) {
  const kinds = ['circuit', 'circuit low voltage', 'circuit high voltage', 'slow response', 'no activity detected'];
  kinds.forEach((k, i) => add(p(base + i), `O2 sensor ${k} (${where})`, family));
  add(p(base + 5), `O2 sensor heater circuit (${where})`, 'o2Heater');
}
// O2 heater control circuits P0030-P0064: circuit, low, high.
for (const [base, where] of [[30, 'bank 1, sensor 1'], [36, 'bank 1, sensor 2'], [42, 'bank 1, sensor 3'], [50, 'bank 2, sensor 1'], [56, 'bank 2, sensor 2'], [62, 'bank 2, sensor 3']]) {
  ['control circuit', 'control circuit low', 'control circuit high'].forEach((k, i) => add(p(base + i), `O2 sensor heater ${k} (${where})`, 'o2Heater'));
}

// Variable valve timing P0010-P0025.
const VVT = [
  ['P0010', 'Camshaft A position actuator circuit (bank 1)'], ['P0011', 'Camshaft A timing over-advanced or system performance (bank 1)'],
  ['P0012', 'Camshaft A timing over-retarded (bank 1)'], ['P0013', 'Camshaft B position actuator circuit (bank 1)'],
  ['P0014', 'Camshaft B timing over-advanced or system performance (bank 1)'], ['P0015', 'Camshaft B timing over-retarded (bank 1)'],
  ['P0020', 'Camshaft A position actuator circuit (bank 2)'], ['P0021', 'Camshaft A timing over-advanced or system performance (bank 2)'],
  ['P0022', 'Camshaft A timing over-retarded (bank 2)'], ['P0023', 'Camshaft B position actuator circuit (bank 2)'],
  ['P0024', 'Camshaft B timing over-advanced or system performance (bank 2)'], ['P0025', 'Camshaft B timing over-retarded (bank 2)'],
];
VVT.forEach(([c, t]) => add(c, t, 'vvt'));
add('P0016', 'Crankshaft/camshaft position correlation (bank 1, sensor A)', 'crankCam');
add('P0017', 'Crankshaft/camshaft position correlation (bank 1, sensor B)', 'crankCam');
add('P0018', 'Crankshaft/camshaft position correlation (bank 2, sensor A)', 'crankCam');
add('P0019', 'Crankshaft/camshaft position correlation (bank 2, sensor B)', 'crankCam');

// Fuel mix.
add('P0170', 'Fuel trim malfunction (bank 1)', 'lean');
add('P0171', 'System too lean (bank 1)', 'lean');
add('P0172', 'System too rich (bank 1)', 'rich');
add('P0173', 'Fuel trim malfunction (bank 2)', 'lean');
add('P0174', 'System too lean (bank 2)', 'lean');
add('P0175', 'System too rich (bank 2)', 'rich');
add('P2187', 'System too lean at idle (bank 1)', 'lean');
add('P2188', 'System too rich at idle (bank 1)', 'rich');
add('P2189', 'System too lean at idle (bank 2)', 'lean');
add('P2190', 'System too rich at idle (bank 2)', 'rich');
add('P2096', 'Post-catalyst fuel trim system too lean (bank 1)', 'lean');
add('P2097', 'Post-catalyst fuel trim system too rich (bank 1)', 'rich');
add('P2098', 'Post-catalyst fuel trim system too lean (bank 2)', 'lean');
add('P2099', 'Post-catalyst fuel trim system too rich (bank 2)', 'rich');
add('P2195', 'O2 sensor signal stuck lean (bank 1, sensor 1)', 'o2Front');
add('P2196', 'O2 sensor signal stuck rich (bank 1, sensor 1)', 'o2Front');
add('P2197', 'O2 sensor signal stuck lean (bank 2, sensor 1)', 'o2Front');
add('P2198', 'O2 sensor signal stuck rich (bank 2, sensor 1)', 'o2Front');
add('P2270', 'O2 sensor signal stuck lean (bank 1, sensor 2)', 'o2Rear');
add('P2271', 'O2 sensor signal stuck rich (bank 1, sensor 2)', 'o2Rear');
add('P2272', 'O2 sensor signal stuck lean (bank 2, sensor 2)', 'o2Rear');
add('P2273', 'O2 sensor signal stuck rich (bank 2, sensor 2)', 'o2Rear');

// Fuel system.
add('P0087', 'Fuel rail/system pressure too low', 'fuelPressure');
add('P0088', 'Fuel rail/system pressure too high', 'fuelPressure');
add('P0089', 'Fuel pressure regulator performance', 'fuelPressure');
add('P0230', 'Fuel pump primary circuit', 'fuelPump');
add('P0627', 'Fuel pump A control circuit/open', 'fuelPump');

// Injectors P0201-P0212, and per-cylinder low/high/balance P0261-P0296.
for (let n = 1; n <= 12; n++) {
  add(p(200 + n), `Injector circuit/open, ${cylName(n)}`, 'injector');
  const b = 261 + 3 * (n - 1);
  add(p(b), `Injector circuit low, ${cylName(n)}`, 'injector');
  add(p(b + 1), `Injector circuit high, ${cylName(n)}`, 'injector');
  add(p(b + 2), `Injector contribution/balance, ${cylName(n)}`, 'injector');
}

// Misfires and ignition coils.
add('P0300', 'Random/multiple cylinder misfire detected', 'misfireRandom');
for (let n = 1; n <= 12; n++) add(p(300 + n), `Cylinder ${n} misfire detected`, 'misfire');
'ABCDEFGHIJKL'.split('').forEach((l, i) => add(p(351 + i), `Ignition coil ${l} primary/secondary circuit`, 'coil'));

// Knock sensors.
add('P0325', 'Knock sensor 1 circuit (bank 1)', 'knock');
add('P0326', 'Knock sensor 1 circuit range/performance (bank 1)', 'knock');
add('P0327', 'Knock sensor 1 circuit low (bank 1)', 'knock');
add('P0328', 'Knock sensor 1 circuit high (bank 1)', 'knock');
add('P0330', 'Knock sensor 2 circuit (bank 2)', 'knock');
add('P0331', 'Knock sensor 2 circuit range/performance (bank 2)', 'knock');
add('P0332', 'Knock sensor 2 circuit low (bank 2)', 'knock');
add('P0333', 'Knock sensor 2 circuit high (bank 2)', 'knock');

// Overheating.
add('P0217', 'Engine coolant over-temperature condition', 'overheat');
add('P0218', 'Transmission fluid over-temperature condition', 'transmission');

// Turbo.
add('P0234', 'Turbocharger/supercharger overboost condition', 'turbo');
add('P0299', 'Turbocharger/supercharger underboost condition', 'turbo');
add('P2263', 'Turbocharger/supercharger boost system performance', 'turbo');

// Diesel.
add('P0380', 'Glow plug/heater circuit A', 'glowPlug');
add('P0670', 'Glow plug module control circuit', 'glowPlug');
add('P2002', 'Diesel particulate filter efficiency below threshold (bank 1)', 'dpf');
add('P2463', 'Diesel particulate filter: soot accumulation', 'dpf');

// EGR and secondary air.
add('P0400', 'Exhaust gas recirculation (EGR) flow', 'egr');
add('P0401', 'EGR flow insufficient detected', 'egr');
add('P0402', 'EGR flow excessive detected', 'egr');
add('P0403', 'EGR control circuit', 'egr');
add('P0404', 'EGR control circuit range/performance', 'egr');
add('P0405', 'EGR sensor A circuit low', 'egr');
add('P0406', 'EGR sensor A circuit high', 'egr');
add('P0410', 'Secondary air injection system', 'secondaryAir');
add('P0411', 'Secondary air injection system incorrect flow detected', 'secondaryAir');

// Catalysts.
add('P0420', 'Catalyst system efficiency below threshold (bank 1)', 'catalyst');
add('P0421', 'Warm-up catalyst efficiency below threshold (bank 1)', 'catalyst');
add('P0430', 'Catalyst system efficiency below threshold (bank 2)', 'catalyst');
add('P0431', 'Warm-up catalyst efficiency below threshold (bank 2)', 'catalyst');

// EVAP (fuel vapour) system.
add('P0440', 'Evaporative emission (EVAP) system malfunction', 'evapSmall');
add('P0441', 'EVAP system incorrect purge flow', 'evapValve');
add('P0442', 'EVAP system small leak detected', 'evapSmall');
add('P0443', 'EVAP purge control valve circuit', 'evapValve');
add('P0444', 'EVAP purge control valve circuit open', 'evapValve');
add('P0445', 'EVAP purge control valve circuit shorted', 'evapValve');
add('P0446', 'EVAP vent control circuit', 'evapValve');
add('P0447', 'EVAP vent control circuit open', 'evapValve');
add('P0448', 'EVAP vent control circuit shorted', 'evapValve');
add('P0449', 'EVAP vent valve/solenoid circuit', 'evapValve');
add('P0455', 'EVAP system large leak detected', 'evapLarge');
add('P0456', 'EVAP system very small leak detected', 'evapSmall');
add('P0457', 'EVAP system leak detected (fuel cap loose/off)', 'evapLarge');
add('P0496', 'EVAP system high purge flow', 'evapValve');

// Cooling fans.
add('P0480', 'Cooling fan 1 control circuit', 'fan');
add('P0481', 'Cooling fan 2 control circuit', 'fan');
add('P0482', 'Cooling fan 3 control circuit', 'fan');

// Speed and idle.
add('P0500', 'Vehicle speed sensor A', 'speedSensor');
add('P0501', 'Vehicle speed sensor A range/performance', 'speedSensor');
add('P0502', 'Vehicle speed sensor A circuit low', 'speedSensor');
add('P0503', 'Vehicle speed sensor A intermittent/erratic/high', 'speedSensor');
add('P0505', 'Idle air control system', 'idle');
add('P0506', 'Idle control system RPM lower than expected', 'idle');
add('P0507', 'Idle control system RPM higher than expected', 'idle');
add('P0524', 'Engine oil pressure too low', 'oilPressure');

// Electrical.
add('P0560', 'System voltage', 'voltage');
add('P0561', 'System voltage unstable', 'voltage');
add('P0562', 'System voltage low', 'voltage');
add('P0563', 'System voltage high', 'voltage');
add('P0620', 'Generator (alternator) control circuit', 'charging');
add('P0621', 'Generator lamp control circuit', 'charging');
add('P0622', 'Generator field control circuit', 'charging');
add('P0641', 'Sensor reference voltage A circuit/open', 'sensorRef');
add('P0651', 'Sensor reference voltage B circuit/open', 'sensorRef');
add('P0650', 'Malfunction indicator lamp (MIL) control circuit', 'mil');

// Engine computer.
add('P0600', 'Serial communication link', 'module');
add('P0601', 'Internal control module memory checksum error', 'module');
add('P0602', 'Control module programming error', 'module');
add('P0603', 'Internal control module keep-alive memory (KAM) error', 'module');
add('P0604', 'Internal control module RAM error', 'module');
add('P0605', 'Internal control module ROM error', 'module');
add('P0606', 'Control module processor', 'module');
add('P0607', 'Control module performance', 'module');

// Throttle actuator (drive-by-wire).
add('P2101', 'Throttle actuator control motor circuit range/performance', 'throttle');
add('P2111', 'Throttle actuator control system stuck open', 'throttle');
add('P2112', 'Throttle actuator control system stuck closed', 'throttle');
add('P2119', 'Throttle actuator control throttle body range/performance', 'throttle');
add('P2135', 'Throttle/pedal position sensor A/B voltage correlation', 'throttle');
add('P2138', 'Throttle/pedal position sensor D/E voltage correlation', 'throttle');

// Automatic transmission (generic codes).
add('P0700', 'Transmission control system (warning light request)', 'transmission');
add('P0705', 'Transmission range sensor circuit', 'transmission');
add('P0715', 'Input/turbine speed sensor A circuit', 'transmission');
add('P0720', 'Output speed sensor circuit', 'transmission');
add('P0725', 'Engine speed input circuit', 'transmission');
add('P0730', 'Incorrect gear ratio', 'transmission');
for (let g = 1; g <= 5; g++) add(p(730 + g), `Gear ${g} incorrect ratio`, 'transmission');
add('P0740', 'Torque converter clutch circuit', 'transmission');
add('P0741', 'Torque converter clutch circuit performance or stuck off', 'transmission');
'ABCD'.split('').forEach((l, i) => add(p(750 + 5 * i), `Shift solenoid ${l}`, 'transmission'));

// Network (U) codes: lost communication with a named module.
const U = {
  U0001: 'High speed CAN communication bus', U0073: 'Control module communication bus A off',
  U0100: 'Lost communication with engine computer (ECM/PCM A)', U0101: 'Lost communication with transmission computer (TCM)',
  U0121: 'Lost communication with ABS module', U0140: 'Lost communication with body control module (BCM)',
  U0151: 'Lost communication with airbag module', U0155: 'Lost communication with instrument cluster',
  U0164: 'Lost communication with climate control (HVAC) module', U0401: 'Invalid data received from engine computer (ECM/PCM A)',
};
for (const [c, t] of Object.entries(U)) add(c, t, 'network');

// ---------- lookup ----------
const SEVERITY_LABEL = { stop: 'Stop driving', high: 'Fix soon', medium: 'Fix when you can', low: 'Minor' };

const KIND = {
  P: 'engine / gearbox', C: 'chassis (brakes, steering, suspension)', B: 'body (airbags, lights, comfort)', U: 'network (communication between computers)',
};

export function normalizeCode(input) {
  const c = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[PCBU][0-3][0-9A-F]{3}$/.test(c) ? c : null;
}

/**
 * Everything we know about a code, offline.
 * { code, title, known, family: {...} | null, severityLabel, kind }
 */
export function explainDtc(input) {
  const code = normalizeCode(input);
  if (!code) return null;
  const kind = KIND[code[0]];
  const [title, familyId] = T[code] || [];
  if (title) {
    const family = { id: familyId, ...FAMILIES[familyId] };
    return { code, title, known: true, kind, family, severityLabel: SEVERITY_LABEL[family.severity] || null };
  }
  const makerSpecific = code[1] === '1' || (code[0] === 'P' && code[1] === '3' && code[2] >= '4');
  if (makerSpecific) {
    return {
      code, title: `Manufacturer-specific ${kind} code`, known: false, kind,
      family: { id: 'makerSpecific', ...FAMILIES.makerSpecific }, severityLabel: null,
    };
  }
  return { code, title: `Generic ${kind} code (not in the offline library)`, known: false, kind, family: null, severityLabel: null };
}

/** How many codes the offline library has titles for. */
export const LIBRARY_SIZE = Object.keys(T).length;

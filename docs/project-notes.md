# CarSense project notes

A running record of what's been built, why, and what's next. Paste this into a new working session to pick up where we left off.

_Last updated: 25 Nov 2026_

## The project

- **What:** a car health check that runs on a phone. OBD-II Bluetooth (BLE) dongle → web app (Web Bluetooth) → plain-English report. An AI (Claude or any OpenAI-compatible model) writes the diagnosis when an API key is set; everything else works offline for free.
- **Pitch:** "Existing OBD apps show the data; this explains it."
- **Status:** personal portfolio project, not for sale. Priorities: ease of use, accuracy, a good portfolio story.
- **Live site:** https://staedia.github.io/carsense/ (GitHub Pages, deploys from `main`, root folder; root `index.html` forwards to `app/`)
- **Repo:** https://github.com/Staedia/carsense
- **Owner's car:** 2019 MG ZS, 1.5 L petrol, CAN bus (the default vehicle in Settings)
- **Owner's computer:** Windows laptop (PowerShell). Keep everything Windows-friendly.

## Hardware

- **Dongle:** Vgate iCar Pro 2S (BLE 5.2, ELM327 v2.3, auto wake/sleep). Ordered; arriving around 29 Nov – 3 Dec 2026.
- **Not yet tested on a real car.** Everything so far is verified with the built-in simulator and automated tests.
- **Known risk:** the 2S's Bluetooth service ID isn't published. If it won't connect, read its service/characteristic UUIDs with the nRF Connect app and add them to `KNOWN_SERVICES` in `app/js/core/transport-ble.js`.
- **Phones:** Android uses Chrome. iPhone needs the Bluefy browser (Safari has no Web Bluetooth).

## How it's built

- Plain JavaScript modules. No framework, no npm dependencies, no build step, so it can be hosted as static files.
- `app/js/core/` runs in both the browser and Node, so it's all testable:

| File | Job |
|---|---|
| `transport-ble.js` | Web Bluetooth link to the dongle; one command at a time; joins split packets |
| `elm327.js` | Dongle setup, protocol detection, response parsing, multi-frame messages; reads PIDs, codes, voltage, misfire counters, VIN, freeze frame |
| `pids.js` | Sensor decoding (Mode 01), readiness monitors, Mode 06 records, VIN decoding |
| `dtc.js` | Trouble code decoding |
| `dtc-library.js` | Offline code library: ~370 code titles + plain-English explanations by fault type |
| `freeze-frame.js` | Mode 02 snapshot and its plain-English description |
| `scan.js` | Health check: codes + live sampling → compact summary (~300-400 tokens) |
| `rules.js` | Offline rule-based report (same format as the AI report) |
| `analyze.js` | AI prompt and API calls; never throws, falls back to rules |
| `fuel.js` | Fuel economy from fuel rate or air flow |
| `battery.js` | Battery test and its assessment |
| `trip.js` | Trip recorder, totals, cost, CSV |
| `simulator.js` | Fake dongle + car with fault scenarios (same interface as Bluetooth) |

- `app/js/main.js`: the user interface. Settings and saved trips live in the browser's local storage.
- `cli/demo.mjs`: terminal demo. `cli/serve.mjs`: local server at http://localhost:8080.

## Commands

```
npm test                                         run all tests (48)
npm run serve                                    run the app locally
node cli/demo.mjs --list                         list demo scenarios
node cli/demo.mjs --scenario misfire             health check in the terminal
node cli/demo.mjs --scenario battery --battery   with the battery test first
node cli/demo.mjs --scenario lean --json         also print the summary sent to the AI
```

## Decisions

- Report format shared by the AI and the offline rules: status (Good / Watch / Needs attention), headline, safety warning, up to 3 likely causes, up to 4 checks, safe to drive (yes / with caution / no), missing data, summary.
- AI rules: cite the data, never claim certainty, safety first, plain English. Default model `claude-sonnet-5-5`.
- The app only reads data. Clearing codes (Mode 04) is not offered yet.
- Only the first 11 characters of the VIN (no serial number) are sent to the AI.
- Fuel economy without a fuel-rate sensor is an estimate from air flow (petrol only, about ±10%). Diesels need the car to report fuel rate.
- Cache-busting for GitHub Pages was tried and declined: waiting a few minutes after an update (or refreshing) is fine.
- **Repo history:** the repo was recreated on 24 Nov 2026 with a single clean "Initial commit". All commits are authored as Staedia, with no AI-assistant credits in commits, branches or pull requests. Work branches use neutral names (e.g. `feature/...`).
- Changes go on a branch and reach the live site only when merged into `main` through a pull request.

## Feature history

### Original version
- Connect to ELM327 BLE dongles; read warning light, stored and pending codes
- Health check: samples sensors for 10–90 s and builds a compact summary
- AI report (Claude or OpenAI-compatible, including local Ollama) with offline fallback
- Live gauges; demo mode with 6 simulated faults; terminal demo; tests

### 24 Nov 2026: driver-friendly live data and car self-checks
- Live view: everyday gauges (speed, RPM, coolant, battery, fuel use, tank, load, oil temp) plus a "Show all sensors" switch for technical readings with plain-English hints. Unsupported sensors are hidden and listed.
- Fuel economy live and as a trip average; units setting (L/100 km, mpg UK/US, km/L)
- Battery test: resting voltage, dip while starting, charging voltage, via the dongle's own voltmeter (ATRV). Result feeds the health check.
- Battery gauge falls back to the dongle's voltmeter when the car doesn't report it
- Readiness monitors ("car's self-tests"); flags codes cleared recently (used-car check)
- Mode 06 per-cylinder misfire counters (catches misfires before a code sets)
- VIN read and model-year check
- New demo scenarios: out for a drive, weak battery, codes recently cleared (9 in total)

### 25 Nov 2026: offline features (no AI needed)
- **Code library:** ~370 generic codes with explanations grouped into ~40 fault types: meaning, seriousness (Stop driving / Fix soon / Fix when you can / Minor), common causes, what to check, safe to drive. The offline report uses it for any code without a dedicated rule (e.g. P0524 low oil pressure → "No, stop driving").
- **Code lookup** card that works without a dongle or internet
- **Freeze frame (Mode 02):** the snapshot saved when a code set, e.g. "Set at 64 km/h with a warm engine (87°C), 2,210 rpm, 47% load". Shown in the report, used by the rules and sent to the AI.
- **Trip log:** Start/End trip in the live data card; distance, time, fuel, cost while driving; history with totals, delete, CSV export. Keeps the screen awake during a trip. Fuel price and currency in Settings; mpg units also switch distances to miles.

## To check on the real car (iCar Pro 2S on the MG ZS)

1. It connects (if not: get UUIDs with nRF Connect).
2. Live view with "Show all sensors": note what the car doesn't report (oil temp? fuel rate?).
3. Battery test before the first drive of the day. Does the dongle read voltage fast enough to catch the dip while starting? Does its auto-sleep interfere with the engine-off step?
4. Health check after a 10-minute drive: do the self-tests and misfire counter sections appear?
5. A short trip: does the distance roughly match the odometer?
6. Screenshot anything odd, including the "Data sent to the AI" panel.

## Ideas not built yet

- Health history and trends: save each check, chart fuel trims / battery / misfires over weeks
- Used-car check report: one tap, printable/shareable
- Guided tests: thermostat (warm-up time), vacuum leak (trims at idle vs 2,500 rpm), O2 sensor response
- Alerts while driving (overheating, not charging, new code)
- Dashboard / HUD mode; warm-up indicator; driving style score
- Service reminders from logged kilometres
- Clear codes (Mode 04) with a warning
- 0–100 km/h timer (approximate); multiple vehicles
- Native app (Capacitor / React Native / Flutter) for background monitoring and auto-connect

## Known limits

- Generic OBD-II only: engine and emissions. No ABS, airbag, body or MG-specific modules.
- A web app can't run in the background, so trips and monitoring need the screen on.

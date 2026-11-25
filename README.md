# CarSense

An AI car health check you run from your phone. Plug a cheap Bluetooth OBD-II dongle into your car, tap **Run health check**, and get a plain-English report: overall status, likely causes ranked by confidence, what to check first, and whether it's safe to drive.

```
OBD-II port ──► BLE dongle ──Bluetooth──► phone web app ──► LLM (Claude / any OpenAI-compatible) ──► report
                                              │
                                              └── offline rule-based check (no AI / no internet)
```

It's a web app (no app store, no install). It uses **Web Bluetooth** to talk straight to the dongle, so there's no server in the middle.

## What it does

- Connects to ELM327-compatible BLE dongles (Veepeak OBDCheck BLE, vLinker, OBDLink CX and most clones)
- Reads stored and pending trouble codes, plus the check-engine-light state
- **Offline code library**: plain-English explanations for ~370 generic codes (what it means, how serious, common causes, what to check, safe to drive?), with a lookup box that works without a dongle or internet
- **Freeze frame**: the snapshot the car saved when a code set (speed, engine temperature, rpm, load), described in plain English
- **Trip log**: distance, time, idling, fuel used, economy and cost for each drive, saved on the phone and exportable as CSV
- Shows live gauges in plain English: speed, RPM, coolant, battery, **fuel economy**, fuel tank, engine load and oil temp. A "Show all sensors" switch adds fuel trims, O2 sensors, air flow, catalyst temperature and the rest
- **Fuel economy** live and as a trip average (L/100 km, mpg UK/US or km/L), from the car's fuel-rate sensor or estimated from air flow
- **Battery test**: resting voltage, the dip while starting, and the charging voltage, read by the dongle itself, so it works even on cars that don't report battery voltage
- **Car's self-tests** (readiness monitors): shows which emissions self-tests have finished, and flags codes that were cleared recently (handy when buying a used car)
- **Misfire counter** per cylinder (Mode 06): catches a misfiring cylinder before the car sets a trouble code
- Reads the **VIN** and checks the model year against your settings (only the first 11 characters, without the serial number, go to the AI)
- Samples sensors for 10–90 seconds, then **condenses everything into a ~300-token summary** (avg/min/max, trends, idle stability, O2 switch counts). That keeps each AI check to a fraction of a cent.
- Sends the summary to an LLM with a diagnostic prompt that ranks causes, cites the data, never claims certainty, and puts safety first
- Falls back to a transparent **offline rules engine** when there's no API key, no internet, or the AI call fails
- **Demo mode** with nine simulated cars (healthy, out for a drive, lean, misfire, overheating, charging fault, worn catalyst, weak battery, codes recently cleared) so you can build and show it without the hardware

## Quick start (no dongle needed)

Needs Node.js 18+. There are no dependencies to install.

```bash
npm test                                  # 48 tests: protocol parsing, scenarios, AI parsing, Bluetooth framing, features
node cli/demo.mjs --list                  # list simulated faults
node cli/demo.mjs --scenario misfire      # full health check in the terminal (offline rules)
node cli/demo.mjs --scenario lean --json  # also print the exact summary sent to the AI
node cli/demo.mjs --scenario battery --battery  # run the battery test first

# With Claude:
ANTHROPIC_API_KEY=sk-ant-... node cli/demo.mjs --scenario lean --note "hesitates when accelerating"

# With a local model via Ollama (runs on your laptop's GPU):
node cli/demo.mjs --provider openai --base-url http://localhost:11434/v1 --model qwen2.5:7b
```

Windows PowerShell: `$env:ANTHROPIC_API_KEY="sk-ant-..."; node cli/demo.mjs --scenario lean`

### Run the app on your laptop

```bash
npm run serve      # http://localhost:8080
```

Open it in Chrome or Edge, tap **Try demo**, and pick a scenario. Bluetooth also works on `localhost`, so you can test the real dongle from your laptop too.

## Using it in the car (phone)

Web Bluetooth needs an **https://** page. The easiest free option is GitHub Pages, which also gives you a nice portfolio link.

1. Push this repo to GitHub.
2. Go to **Settings → Pages**, choose "Deploy from a branch", pick `main`, and set the folder to `/ (root)`. Then open `https://<you>.github.io/<repo>/` (it forwards to the app).
   (Or use a GitHub Action to publish the `app/` folder only.)
3. On your phone:
   - **Android:** open the link in **Chrome**. Use the menu, then **Add to Home screen**, so it opens like an app.
   - **iPhone:** Safari doesn't support Web Bluetooth. Install the free **Bluefy** browser and open the link there.
4. Open **Settings** (the gear icon), add your Anthropic API key, and check the car details (2019 MG ZS petrol is the default).
5. In the car: plug in the dongle, turn the ignition on (engine running is best), tap **Connect dongle**, and pick it from the list.
6. Drive for about 10 minutes first so the engine is warm, then park, idle, and tap **Run health check**.

**Dongle not in the list?** Tick "List all Bluetooth devices" under the connect button. Don't pair it in your phone's Bluetooth settings first; BLE dongles connect from inside the app.

## Picking a dongle

Get a **BLE (Bluetooth Low Energy)** model. Classic-Bluetooth-only dongles can't be used from a web page, and Wi-Fi ones won't work either. Good picks: **Veepeak OBDCheck BLE / BLE+**, **vLinker iCar2 / MC+ BLE**, **OBDLink CX**. Avoid the no-name blue "ELM327 v2.1" clones; many are flaky.

## Project layout

```
app/
  index.html, styles.css, manifest.webmanifest, icon.svg
  js/main.js                 UI wiring
  js/core/                   all the logic; runs in the browser and in Node
    transport-ble.js         Web Bluetooth link to the dongle (queued commands, packet reassembly)
    elm327.js                ELM327 protocol: init, protocol detection, response parsing, multi-frame
    pids.js                  OBD-II sensor decoding (Mode 01), self-tests, misfire counters (Mode 06), VIN (Mode 09)
    dtc.js                   trouble-code decoding
    dtc-library.js           offline code library: titles + plain-English explanations
    freeze-frame.js          Mode 02 snapshot: which PIDs, plain-English description
    scan.js                  health check: codes + live sampling + compact summary
    analyze.js               LLM prompt, Claude / OpenAI-compatible calls, JSON parsing, fallback
    rules.js                 offline rule-based diagnosis
    fuel.js                  fuel economy from fuel rate or air flow, live and trip average
    battery.js               battery test (resting / cranking / charging) and its assessment
    trip.js                  trip recorder, totals, cost, CSV export
    simulator.js             fake dongle + car with fault scenarios
cli/demo.mjs                 terminal demo
cli/serve.mjs                tiny static server
tests/                       node:test suites
```

The simulator implements the same `send(command)` interface as the Bluetooth transport. Demo mode therefore runs the real protocol code end to end, and swapping in the dongle changes nothing else.

## Notes and limits

- **API key safety:** the key stays in your browser's local storage and goes only to the AI provider. That's fine for a personal app. If you ever make it public, add a small backend that holds the key.
- **What OBD-II can see:** generic engine and emissions data. MG-specific modules (ABS, airbags, body) need manufacturer protocols that generic dongles don't expose.
- **Ollama from the phone:** an https page can't call `http://` on your laptop (the browser blocks mixed content). Use Ollama from the CLI, or put it behind https (for example, a Cloudflare tunnel).
- The real Bluetooth path is covered by a test that fakes a dongle with chunked packets. Real dongles vary, so if one misbehaves, the "Data sent to the AI" panel and the browser console show what came back.
- CarSense gives educational estimates, not a professional diagnosis.

- **Fuel economy** without a fuel-rate sensor is an estimate from the air flow sensor (petrol only), usually within 5-10%. Diesels need the car to report fuel rate.
- **Battery test** readings come from the dongle's voltmeter (about ±0.2 V). Cheap dongles sample slowly, so the true lowest point while cranking can be a little lower than shown.
- **Misfire counters** (Mode 06) are only read on CAN cars (2008+ in most markets), and not every car reports them.
- **Trips** are logged only while the app is open on screen; phones pause web apps in the background. The app asks the phone to keep the screen on during a trip.

## Ideas for next steps

- Save each report so you can track the car's health over time
- Clear codes (Mode 04), with a warning that it resets readiness monitors
- Drive mode: sample while driving to catch issues under load
- On-device model as an offline AI option

## License

MIT

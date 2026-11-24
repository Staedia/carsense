// Tests the Bluetooth transport against a fake Web Bluetooth device that
// answers like a real BLE dongle: replies split into small 20-byte packets,
// ending with the '>' prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BleTransport } from '../app/js/core/transport-ble.js';
import { SimulatedElm } from '../app/js/core/simulator.js';
import { Elm327 } from '../app/js/core/elm327.js';
import { runHealthCheck } from '../app/js/core/scan.js';

function fakeBluetooth(scenario = 'lean') {
  const sim = new SimulatedElm({ scenario, virtualTime: true });
  const listeners = {};
  let pendingCmd = '';
  const notify = {
    uuid: 'fff1',
    properties: { notify: true },
    startNotifications: async () => {},
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
  };
  const write = {
    uuid: 'fff2',
    properties: { write: true, writeWithoutResponse: true },
    async writeValueWithoutResponse(bytes) {
      pendingCmd += new TextDecoder().decode(bytes);
      if (!pendingCmd.endsWith('\r')) return;
      const cmd = pendingCmd.trim();
      pendingCmd = '';
      const reply = new TextEncoder().encode(`${await sim.send(cmd)}>`);
      setTimeout(() => {
        for (let i = 0; i < reply.length; i += 20) {
          const chunk = reply.slice(i, i + 20);
          listeners.characteristicvaluechanged({ target: { value: new DataView(chunk.buffer, chunk.byteOffset, chunk.length) } });
        }
      }, 1);
    },
  };
  const device = {
    name: 'VEEPEAK',
    addEventListener() {},
    gatt: {
      connected: true,
      connect: async () => ({
        getPrimaryService: async (uuid) => {
          if (uuid !== 0xfff0) throw new Error('not found');
          return { getCharacteristics: async () => [notify, write] };
        },
      }),
      disconnect() { this.connected = false; },
    },
  };
  globalThis.navigator ??= {};
  Object.defineProperty(globalThis.navigator, 'bluetooth', {
    configurable: true, value: { requestDevice: async () => device },
  });
  return sim;
}

test('BLE transport: connect, init and full health check over chunked packets', async () => {
  const sim = fakeBluetooth('lean');
  const ble = new BleTransport();
  assert.equal(await ble.connect(), 'VEEPEAK');
  const elm = new Elm327(ble);
  const info = await elm.init();
  assert.equal(info.protocol, '6');
  // Fire commands concurrently: the transport must queue them one at a time.
  const [rpm, coolant] = await Promise.all([elm.readPid(0x0c), elm.readPid(0x05)]);
  assert.ok(rpm > 600 && coolant > 80);
  const summary = await runHealthCheck(elm, { vehicle: {}, durationSec: 5, now: () => sim.now() });
  assert.deepEqual(summary.trouble_codes.stored.map((c) => c.code), ['P0171']);
  assert.ok(summary.readings.long_term_fuel_trim_pct.avg > 10);
});

// Web Bluetooth transport for BLE OBD-II dongles (Veepeak OBDCheck BLE,
// vLinker, OBDLink CX and most ELM327 BLE clones).
// Works in Chrome/Edge on Android, Windows, macOS, ChromeOS and Linux.
// iPhone: Safari has no Web Bluetooth; use the free "Bluefy" browser.

// Service UUIDs used by common BLE OBD adapters. We look for any of these
// and pick the characteristics that can notify (read) and write.
const KNOWN_SERVICES = [
  0xfff0, // Veepeak, many ELM327 BLE clones (FFF1 notify / FFF2 write)
  0xffe0, // HM-10 style clones (FFE1 notify+write)
  0x18f0, // vLinker / some Vgate models (2AF0 notify / 2AF1 write)
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Vgate iCar Pro BLE and others
];
const NAME_PREFIXES = ['OBD', 'OBDII', 'VEEPEAK', 'Veepeak', 'vLinker', 'IOS-Vlink', 'Android-Vlink', 'OBDLink', 'V-LINK', 'Vgate', 'ELM'];

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

export class BleTransport {
  constructor({ onDisconnect } = {}) {
    this.onDisconnect = onDisconnect;
    this.buffer = '';
    this.pending = null;
    this.queue = Promise.resolve();
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
  }

  /** Must be called from a user tap (browser security rule). */
  async connect({ showAll = false } = {}) {
    const options = showAll
      ? { acceptAllDevices: true, optionalServices: KNOWN_SERVICES }
      : {
          filters: [
            ...KNOWN_SERVICES.map((s) => ({ services: [s] })),
            ...NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
          ],
          optionalServices: KNOWN_SERVICES,
        };
    this.device = await navigator.bluetooth.requestDevice(options);
    this.device.addEventListener('gattserverdisconnected', () => {
      this.pending?.reject(new Error('Dongle disconnected'));
      this.pending = null;
      this.onDisconnect?.();
    });

    const server = await this.device.gatt.connect();
    const { notify, write } = await this._findCharacteristics(server);
    this.writeChar = write;
    this.notifyChar = notify;
    await notify.startNotifications();
    notify.addEventListener('characteristicvaluechanged', (e) => this._onData(e.target.value));
    return this.device.name || 'OBD dongle';
  }

  async _findCharacteristics(server) {
    for (const uuid of KNOWN_SERVICES) {
      let service;
      try {
        service = await server.getPrimaryService(uuid);
      } catch {
        continue;
      }
      const chars = await service.getCharacteristics();
      const notify = chars.find((c) => c.properties.notify || c.properties.indicate);
      const write = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (notify && write) return { notify, write };
    }
    throw new Error("Connected, but this device doesn't look like an OBD dongle (no serial service found).");
  }

  _onData(dataView) {
    this.buffer += this.decoder.decode(dataView.buffer.slice(dataView.byteOffset, dataView.byteOffset + dataView.byteLength));
    const idx = this.buffer.indexOf('>');
    if (idx !== -1 && this.pending) {
      const text = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const { resolve, timer } = this.pending;
      clearTimeout(timer);
      this.pending = null;
      resolve(text);
    }
  }

  async _write(text) {
    const bytes = this.encoder.encode(text);
    // BLE packets are small; send in 20-byte chunks to be safe.
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      if (this.writeChar.properties.writeWithoutResponse && this.writeChar.writeValueWithoutResponse) {
        await this.writeChar.writeValueWithoutResponse(chunk);
      } else {
        await this.writeChar.writeValue(chunk);
      }
    }
  }

  /** Send one command, resolve with the text before the '>' prompt. */
  send(cmd, timeoutMs = 5000) {
    const run = () => new Promise((resolve, reject) => {
      if (!this.device?.gatt?.connected) return reject(new Error('Dongle not connected'));
      this.buffer = '';
      const timer = setTimeout(() => {
        this.pending = null;
        // Return whatever arrived; the parser will treat it as no data.
        resolve(this.buffer || 'NO DATA');
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
      this._write(`${cmd}\r`).catch((e) => {
        clearTimeout(timer);
        this.pending = null;
        reject(e);
      });
    });
    // Commands must go one at a time.
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async close() {
    try {
      this.device?.gatt?.disconnect();
    } catch { /* ignore */ }
  }
}

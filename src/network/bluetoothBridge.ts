import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { BluetoothDiscoveredDevice } from '../types/game';

export interface BluetoothMultiplayerNativePlugin {
  ensurePermissions(): Promise<{ granted: boolean; available: boolean }>;
  startDiscovery(): Promise<{ bondedDevices: BluetoothDiscoveredDevice[] }>;
  startHostServer(): Promise<{ hosting: boolean }>;
  connectToDevice(options: { address: string }): Promise<{ connected: boolean; address: string }>;
  sendPacket(options: { data: string }): Promise<void>;
  disconnectAll(): Promise<void>;
  addListener(
    eventName: 'onDeviceDiscovered',
    listenerFunc: (device: BluetoothDiscoveredDevice) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'onPacketReceived',
    listenerFunc: (payload: { data: string; from: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'onConnectionStateChanged',
    listenerFunc: (state: { connected: boolean; peerCount?: number; address?: string; error?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const NativeBluetooth = registerPlugin<BluetoothMultiplayerNativePlugin>('BluetoothMultiplayer');

export class BluetoothBridge {
  readonly isNativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  readonly isWebBluetoothSupported =
    typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  private listeners: PluginListenerHandle[] = [];
  private webGattChar: any = null;

  async ensureReady(): Promise<{ granted: boolean; available: boolean; mode: 'native' | 'web' | 'unavailable' }> {
    if (this.isNativeAndroid) {
      const res = await NativeBluetooth.ensurePermissions();
      return { ...res, mode: 'native' };
    }
    if (this.isWebBluetoothSupported) {
      return { granted: true, available: true, mode: 'web' };
    }
    return { granted: false, available: false, mode: 'unavailable' };
  }

  async startDiscovery(
    onDevice: (dev: BluetoothDiscoveredDevice) => void,
    onPacket: (jsonStr: string) => void,
    onConnectionChange: (state: { connected: boolean; peerCount?: number; error?: string }) => void,
  ): Promise<BluetoothDiscoveredDevice[]> {
    await this.clearListeners();

    if (this.isNativeAndroid) {
      this.listeners.push(
        await NativeBluetooth.addListener('onDeviceDiscovered', onDevice),
      );
      this.listeners.push(
        await NativeBluetooth.addListener('onPacketReceived', (p) => onPacket(p.data)),
      );
      this.listeners.push(
        await NativeBluetooth.addListener('onConnectionStateChanged', onConnectionChange),
      );
      const res = await NativeBluetooth.startDiscovery();
      return res.bondedDevices || [];
    }

    // Web Bluetooth fallback for Chrome Android / Desktop Chromium
    if (this.isWebBluetoothSupported) {
      const navBt = (navigator as any).bluetooth;
      const device = await navBt.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['0000ffe0-0000-1000-8000-00805f9b34fb'],
      });
      const discovered: BluetoothDiscoveredDevice = {
        address: device.id,
        name: device.name || 'BLE Racer',
        rssi: -52,
        bonded: true,
      };
      onDevice(discovered);
      try {
        const server = await device.gatt?.connect();
        const service = await server?.getPrimaryService('0000ffe0-0000-1000-8000-00805f9b34fb');
        this.webGattChar = await service?.getCharacteristic('0000ffe1-0000-1000-8000-00805f9b34fb');
        if (this.webGattChar) {
          await this.webGattChar.startNotifications();
          this.webGattChar.addEventListener('characteristicvaluechanged', (ev: any) => {
            const dec = new TextDecoder().decode(ev.target.value);
            onPacket(dec);
          });
          onConnectionChange({ connected: true, peerCount: 1 });
        }
      } catch {
        onConnectionChange({
          connected: false,
          error: 'Web Bluetooth GATT characteristic unavailable on target; use Native Android APK for RFCOMM.',
        });
      }
      return [discovered];
    }

    throw new Error('Bluetooth unavailable in this runtime. Export Android APK or use Internet Pairing.');
  }

  async hostServer(
    onPacket: (jsonStr: string) => void,
    onConnectionChange: (state: { connected: boolean; peerCount?: number; error?: string }) => void,
  ): Promise<void> {
    if (!this.isNativeAndroid) {
      throw new Error('RFCOMM Bluetooth Host Server requires Android APK runtime.');
    }
    await this.clearListeners();
    this.listeners.push(
      await NativeBluetooth.addListener('onPacketReceived', (p) => onPacket(p.data)),
    );
    this.listeners.push(
      await NativeBluetooth.addListener('onConnectionStateChanged', onConnectionChange),
    );
    await NativeBluetooth.startHostServer();
  }

  async connect(address: string): Promise<void> {
    if (this.isNativeAndroid) {
      await NativeBluetooth.connectToDevice({ address });
    }
  }

  async send(payload: unknown): Promise<void> {
    const data = JSON.stringify(payload);
    if (this.isNativeAndroid) {
      await NativeBluetooth.sendPacket({ data });
    } else if (this.webGattChar) {
      const enc = new TextEncoder().encode(data + '\n');
      await this.webGattChar.writeValueWithoutResponse(enc);
    }
  }

  async disconnect(): Promise<void> {
    await this.clearListeners();
    if (this.isNativeAndroid) {
      await NativeBluetooth.disconnectAll();
    }
    this.webGattChar = null;
  }

  private async clearListeners(): Promise<void> {
    for (const h of this.listeners) {
      await h.remove();
    }
    this.listeners = [];
  }
}

export const bluetoothBridge = new BluetoothBridge();

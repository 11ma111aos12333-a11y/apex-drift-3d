package com.apexdrift.racing;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "BluetoothMultiplayer",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.ACCESS_FINE_LOCATION
            }
        )
    }
)
public class BluetoothMultiplayerPlugin extends Plugin {
    private static final String SERVICE_NAME = "ApexDrift3D";
    private static final UUID SERVICE_UUID = UUID.fromString("8e7f4b20-6a3d-4c11-9b88-a1b2c3d4e5f6");

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothServerSocket serverSocket;
    private final List<PeerConnection> activePeers = new CopyOnWriteArrayList<>();
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private volatile boolean running = false;
    private boolean receiverRegistered = false;

    private final BroadcastReceiver discoveryReceiver = new BroadcastReceiver() {
        @SuppressLint("MissingPermission")
        @Override
        public void onReceive(Context context, Intent intent) {
            if (BluetoothDevice.ACTION_FOUND.equals(intent.getAction())) {
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                short rssi = intent.getShortExtra(BluetoothDevice.EXTRA_RSSI, (short) -65);
                if (device != null && device.getAddress() != null) {
                    JSObject payload = new JSObject();
                    payload.put("address", device.getAddress());
                    payload.put("name", device.getName() != null ? device.getName() : "Android Racer");
                    payload.put("rssi", rssi);
                    payload.put("bonded", device.getBondState() == BluetoothDevice.BOND_BONDED);
                    notifyListeners("onDeviceDiscovered", payload);
                }
            }
        }
    };

    @Override
    public void load() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        if (bm != null) {
            bluetoothAdapter = bm.getAdapter();
        }
    }

    @PluginMethod
    public void ensurePermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            boolean granted =
                ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
                ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
                ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED;
            if (!granted) {
                requestPermissionForAlias("bluetooth", call, "permissionsCallback");
                return;
            }
        } else {
            boolean loc = ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            if (!loc) {
                requestPermissionForAlias("bluetooth", call, "permissionsCallback");
                return;
            }
        }
        JSObject res = new JSObject();
        res.put("granted", true);
        res.put("available", bluetoothAdapter != null && bluetoothAdapter.isEnabled());
        call.resolve(res);
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        JSObject res = new JSObject();
        res.put("granted", true);
        res.put("available", bluetoothAdapter != null && bluetoothAdapter.isEnabled());
        call.resolve(res);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            call.reject("Bluetooth adapter unavailable or disabled");
            return;
        }
        if (!receiverRegistered) {
            IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_FOUND);
            getContext().registerReceiver(discoveryReceiver, filter);
            receiverRegistered = true;
        }

        JSArray bondedArr = new JSArray();
        Set<BluetoothDevice> bonded = bluetoothAdapter.getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice d : bonded) {
                JSObject obj = new JSObject();
                obj.put("address", d.getAddress());
                obj.put("name", d.getName() != null ? d.getName() : "Paired Device");
                obj.put("rssi", -50);
                obj.put("bonded", true);
                bondedArr.put(obj);
            }
        }

        if (bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }
        bluetoothAdapter.startDiscovery();

        JSObject ret = new JSObject();
        ret.put("bondedDevices", bondedArr);
        call.resolve(ret);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startHostServer(PluginCall call) {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            call.reject("Bluetooth disabled");
            return;
        }
        stopConnectionsInternal();

        // Request discoverability so friends can scan and connect
        Intent discoverableIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE);
        discoverableIntent.putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300);
        getActivity().startActivity(discoverableIntent);

        running = true;
        executor.execute(() -> {
            try {
                serverSocket = bluetoothAdapter.listenUsingRfcommWithServiceRecord(SERVICE_NAME, SERVICE_UUID);
                while (running) {
                    BluetoothSocket clientSocket = serverSocket.accept();
                    if (clientSocket != null) {
                        attachPeerSocket(clientSocket);
                    }
                }
            } catch (IOException e) {
                if (running) {
                    JSObject err = new JSObject();
                    err.put("connected", false);
                    err.put("error", e.getMessage());
                    notifyListeners("onConnectionStateChanged", err);
                }
            }
        });

        JSObject res = new JSObject();
        res.put("hosting", true);
        call.resolve(res);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connectToDevice(PluginCall call) {
        String address = call.getString("address");
        if (address == null || bluetoothAdapter == null) {
            call.reject("Invalid Bluetooth address");
            return;
        }
        if (bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }

        running = true;
        executor.execute(() -> {
            try {
                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
                BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SERVICE_UUID);
                socket.connect();
                attachPeerSocket(socket);
                JSObject res = new JSObject();
                res.put("connected", true);
                res.put("address", address);
                call.resolve(res);
            } catch (IOException e) {
                call.reject("RFCOMM connection failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void sendPacket(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.resolve();
            return;
        }
        String line = data + "\n";
        for (PeerConnection peer : activePeers) {
            peer.send(line);
        }
        call.resolve();
    }

    @PluginMethod
    public void disconnectAll(PluginCall call) {
        stopConnectionsInternal();
        call.resolve();
    }

    private void attachPeerSocket(BluetoothSocket socket) throws IOException {
        PeerConnection conn = new PeerConnection(socket);
        activePeers.add(conn);

        JSObject state = new JSObject();
        state.put("connected", true);
        state.put("peerCount", activePeers.size());
        state.put("address", socket.getRemoteDevice().getAddress());
        notifyListeners("onConnectionStateChanged", state);

        executor.execute(conn::readLoop);
    }

    private void stopConnectionsInternal() {
        running = false;
        for (PeerConnection p : activePeers) {
            p.close();
        }
        activePeers.clear();
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {}
            serverSocket = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopConnectionsInternal();
        if (receiverRegistered) {
            try {
                getContext().unregisterReceiver(discoveryReceiver);
            } catch (IllegalArgumentException ignored) {}
            receiverRegistered = false;
        }
        executor.shutdownNow();
    }

    private class PeerConnection {
        private final BluetoothSocket socket;
        private final BufferedReader reader;
        private final BufferedWriter writer;

        PeerConnection(BluetoothSocket socket) throws IOException {
            this.socket = socket;
            this.reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            this.writer = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
        }

        synchronized void send(String line) {
            try {
                writer.write(line);
                writer.flush();
            } catch (IOException e) {
                close();
            }
        }

        void readLoop() {
            try {
                String line;
                while (running && (line = reader.readLine()) != null) {
                    // Relay packet to other Bluetooth peers if acting as star-topology Host
                    for (PeerConnection other : activePeers) {
                        if (other != this) {
                            other.send(line + "\n");
                        }
                    }
                    JSObject payload = new JSObject();
                    payload.put("data", line);
                    payload.put("from", socket.getRemoteDevice().getAddress());
                    notifyListeners("onPacketReceived", payload);
                }
            } catch (IOException ignored) {
            } finally {
                activePeers.remove(this);
                close();
                JSObject state = new JSObject();
                state.put("connected", !activePeers.isEmpty());
                state.put("peerCount", activePeers.size());
                notifyListeners("onConnectionStateChanged", state);
            }
        }

        void close() {
            try {
                socket.close();
            } catch (IOException ignored) {}
        }
    }
}

package com.apexdrift.racing;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BluetoothMultiplayerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

package com.xyblue.myhouse;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeOnLanPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

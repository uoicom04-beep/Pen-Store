package me.thepen.penstore;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle b) { registerPlugin(PenNativePlugin.class); super.onCreate(b); }
}

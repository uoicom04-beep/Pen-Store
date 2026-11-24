package me.thepen.penstore;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "PenNative")
public class PenNativePlugin extends Plugin {
  private File root() { return new File(getContext().getFilesDir(), "games"); }
  private static String safe(String id) { return id.replaceAll("[^\\w-]", "_"); }
  private static long size(File f) { if (f.isFile()) return f.length(); long n = 0; File[] c = f.listFiles(); if (c != null) for (File x : c) n += size(x); return n; }
  private static void del(File f) { File[] c = f.listFiles(); if (c != null) for (File x : c) del(x); f.delete(); }

  @PluginMethod public void play(PluginCall c) {
    Intent i = new Intent(getContext(), GameActivity.class);
    i.putExtra("id", c.getString("id")); i.putExtra("url", c.getString("url", "")); i.putExtra("install", c.getBoolean("install", false));
    getActivity().startActivity(i); c.resolve();
  }
  @PluginMethod public void list(PluginCall c) {
    JSObject games = new JSObject(); File[] ds = root().listFiles();
    if (ds != null) for (File d : ds) if (new File(d, "installed").exists()) { try { games.put(d.getName(), size(d)); } catch (Exception e) {} }
    JSObject o = new JSObject(); o.put("games", games); c.resolve(o);
  }
  @PluginMethod public void remove(PluginCall c) { del(new File(root(), safe(c.getString("id", "x")))); c.resolve(); }
  @PluginMethod public void openExternal(PluginCall c) {
    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(c.getString("url"))); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    getContext().startActivity(i); c.resolve();
  }
}

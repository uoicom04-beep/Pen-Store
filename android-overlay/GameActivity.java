package me.thepen.penstore;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.view.View;
import android.webkit.*;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

/** เล่นเกมเว็บเต็มจอ + แคชไฟล์เกมลงเครื่อง (เล่นออฟไลน์ได้) */
public class GameActivity extends Activity {
  private WebView web; private File dir; private String host; private boolean cache;

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    String id = getIntent().getStringExtra("id").replaceAll("[^\\w-]", "_");
    String url = getIntent().getStringExtra("url");
    boolean install = getIntent().getBooleanExtra("install", false);
    dir = new File(getFilesDir(), "games/" + id); File mk = new File(dir, "installed");
    File uf = new File(dir, "url.txt");
    if (url == null || url.isEmpty()) url = read(uf);
    if (install) { dir.mkdirs(); try { write(mk, "1"); write(uf, url); } catch (Exception e) {} }
    cache = mk.exists();
    try { host = new URL(url).getHost(); } catch (Exception e) { finish(); return; }

    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false); s.setAllowFileAccess(false);
    s.setUseWideViewPort(true); s.setLoadWithOverviewMode(true);
    web.setWebChromeClient(new WebChromeClient() {
      View cv; WebChromeClient.CustomViewCallback cb;
      @Override public void onShowCustomView(View v, CustomViewCallback c) { cv = v; cb = c; setContentView(v); }
      @Override public void onHideCustomView() { if (cb != null) cb.onCustomViewHidden(); setContentView(web); }
    });
    web.setWebViewClient(new WebViewClient() {
      @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) { return intercept(r); }
    });
    setContentView(web);
    hideBars();
    web.loadUrl(url);
  }

  private WebResourceResponse intercept(WebResourceRequest r) {
    try {
      Uri u = r.getUrl();
      if (!cache || !"GET".equals(r.getMethod()) || !host.equals(u.getHost())) return null;
      String key = sha1(u.toString());
      File bin = new File(dir, key + ".bin"), meta = new File(dir, key + ".meta");
      if (!bin.exists() || !meta.exists()) {
        HttpURLConnection c = (HttpURLConnection) new URL(u.toString()).openConnection();
        c.setInstanceFollowRedirects(true); c.setConnectTimeout(15000); c.setReadTimeout(60000);
        if (c.getResponseCode() != 200) return null;
        String ct = c.getContentType() == null ? "application/octet-stream" : c.getContentType();
        File tmp = new File(dir, key + ".tmp");
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) { byte[] buf = new byte[65536]; int n; while ((n = in.read(buf)) > 0) out.write(buf, 0, n); }
        tmp.renameTo(bin); write(meta, ct);
      }
      String ct = read(meta); String mime = ct.split(";")[0].trim();
      Map<String, String> h = new HashMap<>(); h.put("Access-Control-Allow-Origin", "*");
      WebResourceResponse res = new WebResourceResponse(mime, "UTF-8", new FileInputStream(bin));
      res.setResponseHeaders(h); return res;
    } catch (Exception e) { return null; }
  }

  private void hideBars() {
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  }
  @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) hideBars(); }
  @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else finish(); }
  @Override protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
  @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
  @Override protected void onDestroy() { if (web != null) { web.destroy(); web = null; } super.onDestroy(); }

  private static String sha1(String s) throws Exception { StringBuilder sb = new StringBuilder(); for (byte x : MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"))) sb.append(String.format("%02x", x)); return sb.toString(); }
  private static String read(File f) { try (BufferedReader r = new BufferedReader(new FileReader(f))) { return r.readLine(); } catch (Exception e) { return ""; } }
  private static void write(File f, String t) throws Exception { try (FileWriter w = new FileWriter(f)) { w.write(t); } }
}

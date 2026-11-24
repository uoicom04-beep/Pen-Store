'use strict';
// Android (Capacitor): สร้าง window.pen ให้เหมือนฝั่ง Electron — บน Windows/Linux ไฟล์นี้ไม่ทำอะไร (preload สร้าง pen ให้แล้ว)
if (!window.pen && window.Capacitor) {
  const N = window.Capacitor.registerPlugin('PenNative');
  const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const dec = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const page = async (u) => {
    try { const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } }); return { ok: true, status: r.status, url: r.url || u, html: await r.text() }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  };
  window.pen = {
    platform: 'android',
    page: (u) => page(u),
    img: async () => null,
    ext: (u) => N.openExternal({ url: u }),
    onProgress: () => {}, cancelDl: async () => true, setExe: async () => false, openFolder: async () => true, dataPath: async () => '',
    dl: async () => ({ ok: false, error: 'Android เล่นได้เฉพาะเกมเว็บ (HTML5)' }),
    inst: async () => { const r = await N.list(); const o = {}; for (const [id, size] of Object.entries(r.games || {})) o[id] = { size, kind: 'web', exes: [], exe: '' }; return o; },
    uninstall: async (id) => { await N.remove({ id }); return true; },
    clearSave: async () => true,
    lib: async () => get('lib', []),
    libToggle: async (g) => { let l = get('lib', []); l = l.some((x) => x.id === g.id) ? l.filter((x) => x.id !== g.id) : [...l, g]; set('lib', l); return l; },
    addUrl: async (u) => {
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      const url = new URL(u); const l = get('lib', []);
      const g = { id: 'url-' + btoa(unescape(encodeURIComponent(u))).replace(/\W/g, '').slice(-24), title: decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname), author: url.hostname, desc: '', thumb: '', url: u, source: /itch\.io$/.test(url.hostname) ? 'itch.io' : 'URL' };
      const r = await page(u);
      if (r.ok) { const og = (k) => dec(r.html.match(new RegExp('property="og:' + k + '"[^>]*content="([^"]*)"'))?.[1] || ''); g.title = og('title') || g.title; g.thumb = og('image'); g.desc = og('description'); }
      if (!l.some((x) => x.id === g.id)) l.push(g);
      set('lib', l); return { lib: l, game: g };
    },
    play: async (g, install) => {
      const ins = (await N.list()).games || {};
      if (ins[g.id] != null) { await N.play({ id: g.id, url: '', install: true }); return true; }
      let src = g.url;
      if (/(^|\.)itch\.io$/.test(new URL(g.url).hostname)) {
        const r = await page(g.url); const m = r.ok && r.html.match(/data-iframe="([^"]+)"/);
        const f = m && dec(m[1]).match(/src="([^"]+)"/);
        if (!f) { alert('เกมนี้ไม่ใช่เกมเว็บ (HTML5) เล่นในแอปไม่ได้'); return false; }
        src = f[1];
      }
      await N.play({ id: g.id, url: src, install: !!install }); return true;
    }
  };
}

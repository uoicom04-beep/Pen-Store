const { app, BrowserWindow, ipcMain, session, shell, net } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const fs = require('fs');

try { // เก็บเกม/save/ไลบรารีไว้ข้าง PenStore.exe ในโฟลเดอร์ PenStore-Data (ถ้าเขียนได้)
  const pd = process.env.PORTABLE_EXECUTABLE_DIR;
  if (pd) { const d = path.join(pd, 'PenStore-Data'); fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); app.setPath('userData', d); }
} catch {}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const libFile = () => path.join(app.getPath('userData'), 'library.json');
const readLib = () => { try { return JSON.parse(fs.readFileSync(libFile(), 'utf8')); } catch { return []; } };
const writeLib = (l) => fs.writeFileSync(libFile(), JSON.stringify(l, null, 1));
const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// ---------- Pages ----------
// main แค่ดึง HTML ด้วย network ของ Chromium แล้วส่งให้หน้าจอ parse เอง (ไม่ใช้หน้าต่างซ่อน จึงไม่แย่งโฟกัสคีย์บอร์ด)
let mainWin = null;
const sleep0 = (ms) => new Promise((r) => setTimeout(r, ms));
// หน้าต่างซ่อนไว้ render หน้าเว็บที่ใช้ JS/Cloudflare (ใช้เป็นแผนสำรองเมื่อ fetch ธรรมดาไม่ได้ผลลัพธ์)
async function renderPage(url) {
  const win = new BrowserWindow({ show: false, focusable: false, width: 1200, height: 900, webPreferences: { sandbox: true, partition: 'scraper-view', backgroundThrottling: false } });
  win.webContents.setUserAgent(UA);
  try {
    await Promise.race([win.loadURL(url).catch(() => {}), sleep0(20000)]);
    for (let i = 0; i < 40; i++) {
      const n = await win.webContents.executeJavaScript(`document.querySelectorAll('.game_cell').length`).catch(() => 0);
      if (n) break; await sleep0(500);
    }
    await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep0(700);
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
    return { ok: true, status: 200, url: win.webContents.getURL(), html };
  } finally { if (!win.isDestroyed()) win.destroy(); }
}
ipcMain.handle('page', async (_e, url, render) => {
  try {
    if (render) return await renderPage(url);
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    const res = await net.fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,application/json,*/*' }, signal: ctl.signal });
    clearTimeout(t);
    return { ok: true, status: res.status, url: res.url, html: await res.text() };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
// โหลดรูปผ่าน main (กัน hotlink/referrer บล็อก) ใช้เป็นแผนสำรองตอนรูปโหลดตรงไม่ขึ้น
const imgCache = new Map();
ipcMain.handle('img', async (_e, u) => {
  if (!/^https?:\/\//i.test(u || '')) return null;
  if (imgCache.has(u)) return imgCache.get(u);
  try {
    const res = await net.fetch(u, { headers: { 'User-Agent': UA } });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !/^image\//i.test(ct)) return null;
    const d = `data:${ct};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    if (imgCache.size > 300) imgCache.delete(imgCache.keys().next().value);
    imgCache.set(u, d); return d;
  } catch { return null; }
});
ipcMain.handle('open:ext', (_e, u) => shell.openExternal(u));

// ---------- Library ----------
ipcMain.handle('lib:get', () => readLib());
ipcMain.handle('lib:toggle', (_e, g) => {
  let l = readLib();
  l = l.some((x) => x.id === g.id) ? l.filter((x) => x.id !== g.id) : [...l, g];
  writeLib(l); return l;
});
ipcMain.handle('lib:addurl', async (_e, u) => {
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const url = new URL(u); const l = readLib();
  const g = { id: 'url-' + require('crypto').createHash('sha1').update(u).digest('hex').slice(0, 16), title: decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname), author: url.hostname, desc: '', thumb: '', url: u, source: /itch\.io$/.test(url.hostname) ? 'itch.io' : 'URL' };
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 7000);
    const html = await (await fetch(u, { headers: { 'User-Agent': UA }, signal: ctl.signal })).text();
    const og = (k) => decode(html.match(new RegExp('property="og:' + k + '"[^>]*content="([^"]*)"'))?.[1] || '');
    g.title = og('title') || decode(html.match(/<title>([^<]*)</)?.[1] || '') || g.title; g.thumb = og('image'); g.desc = og('description');
  } catch {}
  if (!l.some((x) => x.id === g.id)) l.push(g);
  writeLib(l); return { lib: l, game: g };
});
ipcMain.handle('save:clear', async (_e, id) => {
  await session.fromPartition('persist:game-' + id).clearStorageData(); return true;
});

// ---------- Install / Cache ----------
const gamesRoot = () => path.join(app.getPath('userData'), 'games');
const gDir = (id) => path.join(gamesRoot(), id.replace(/[^\w-]/g, '_'));
const metaOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(gDir(id), 'game.json'), 'utf8')); } catch { return null; } };
const dirSize = (d) => { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch {} return n; };
ipcMain.handle('inst:list', () => {
  const out = {};
  try { for (const d of fs.readdirSync(gamesRoot())) { const m = metaOf(d); if (m) out[m.game.id] = { size: dirSize(path.join(gamesRoot(), d)), kind: m.kind || 'web', exes: (m.exes || []).map((x) => path.relative(m.dir, x)), exe: m.exe ? path.relative(m.dir, m.exe) : '' }; } } catch {}
  return out;
});
ipcMain.handle('inst:remove', (_e, id) => { fs.rmSync(gDir(id), { recursive: true, force: true }); return true; });

const hooked = new Set();
function hookCache(ses, id, getHost) {
  if (hooked.has(id)) return; hooked.add(id);
  const crypto = require('crypto');
  ses.protocol.handle('https', async (req) => {
    const u = new URL(req.url);
    const meta = metaOf(id);
    const ok = meta && req.method === 'GET' && u.hostname === getHost() ;
    if (ok) {
      const f = path.join(gDir(id), crypto.createHash('sha1').update(req.url).digest('hex'));
      if (fs.existsSync(f + '.bin')) {
        const ct = JSON.parse(fs.readFileSync(f + '.json', 'utf8')).ct;
        return new Response(fs.readFileSync(f + '.bin'), { status: 200, headers: { 'content-type': ct, 'access-control-allow-origin': '*' } });
      }
      const res = await net.fetch(req, { bypassCustomProtocolHandlers: true });
      if (res.ok && res.status === 200) {
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get('content-type') || 'application/octet-stream';
        fs.writeFileSync(f + '.bin', buf); fs.writeFileSync(f + '.json', JSON.stringify({ ct }));
        return new Response(buf, { status: 200, headers: { 'content-type': ct, 'access-control-allow-origin': '*' } });
      }
      return res;
    }
    return net.fetch(req, { bypassCustomProtocolHandlers: true });
  });
}

// ---------- Download เกมโหลดไฟล์ (เปิดเว็บเบื้องหลัง กดโหลดให้เอง) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tempRoot = () => path.join(app.getPath('temp'), 'penstore-temp');
const cleanTemp = () => { try { fs.rmSync(tempRoot(), { recursive: true, force: true }); } catch {} };
function findExes(root, depth = 0, out = []) {
  try {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const p = path.join(root, e.name);
      if (e.isDirectory()) { if (depth < 4) findExes(p, depth + 1, out); }
      else if (/\.exe$/i.test(e.name) && !/unins|crash|redist|vcredist|dxsetup|dotnet|notification_helper|updater|vc_redist/i.test(e.name)) out.push({ p, size: fs.statSync(p).size });
    }
  } catch {}
  return out.sort((a, b) => b.size - a.size);
}
function launch(exe, tempDir) {
  const t = Date.now();
  try {
    const c = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
    c.on('error', () => shell.openPath(exe));
    c.on('exit', () => { if (tempDir && Date.now() - t > 15000) setTimeout(() => fs.rmSync(tempDir, { recursive: true, force: true }), 2000); });
    c.unref();
  } catch { shell.openPath(exe); }
}
function extractArchive(file, out) {
  fs.mkdirSync(out, { recursive: true });
  if (/\.zip$/i.test(file)) { new AdmZip(file).extractAllTo(out, true); return true; }
  if (/\.(7z|tar|gz|tgz|bz2|xz)$/i.test(file)) {
    const p7 = require('7zip-bin').path7za.replace('app.asar', 'app.asar.unpacked');
    const run = (f, o) => require('child_process').spawnSync(p7, ['x', f, '-o' + o, '-y'], { windowsHide: true }).status === 0;
    if (!run(file, out)) return false;
    for (const f of fs.readdirSync(out)) if (/\.tar$/i.test(f) && !/\.tar$/i.test(file)) { run(path.join(out, f), out); fs.rmSync(path.join(out, f), { force: true }); }
    return true;
  }
  return false;
}
let pending = null, dlHooked = false;
function hookDl() {
  if (dlHooked) return; dlHooked = true;
  session.fromPartition('scraper').on('will-download', (_ev, item) => {
    const p = pending; if (!p) return item.cancel();
    p.item = item; p.started = true;
    const fp = path.join(p.dir, item.getFilename()); item.setSavePath(fp);
    item.on('updated', () => p.progress(item.getReceivedBytes(), item.getTotalBytes()));
    item.once('done', (_e, state) => state === 'completed' ? p.resolve(fp) : p.reject(new Error(state === 'cancelled' ? 'ยกเลิกแล้ว' : 'ดาวน์โหลดล้มเหลว (' + state + ')')));
  });
}
function waitLoad(win, ms = 8000) {
  return new Promise((res) => { let d = false; const f = () => { if (!d) { d = true; res(); } }; win.webContents.once('did-stop-loading', f); setTimeout(f, ms); });
}
// เดินตามหน้าเว็บ: หน้าเกม -> (Download Now) -> (No thanks, just take me to the downloads) -> ปุ่มโหลดของไฟล์ที่เลือก
const STEP = (id) => `(() => {
  const b = document.querySelector('.download_btn[data-upload_id="${String(id).replace(/\W/g, '')}"]'); if (b) { b.click(); return 'clicked'; }
  const nt = [...document.querySelectorAll('a,button')].find(e => /no thanks,? just take me to the downloads/i.test(e.textContent)); if (nt) { nt.click(); return 'nothanks'; }
  const buy = document.querySelector('a.buy_btn, .buy_btn'); if (buy) { buy.click(); return 'buy'; }
  return 'none'; })()`;
async function drive(win, g, uploadId, send) {
  await win.loadURL(g.url);
  for (let step = 0; step < 8; step++) {
    let r = 'none';
    for (let t = 0; t < 10; t++) { try { r = await win.webContents.executeJavaScript(STEP(uploadId)); } catch { r = 'none'; } if (r !== 'none') break; await sleep(500); }
    if (r === 'clicked') return true;
    if (r === 'none') return false;
    send({ phase: 'OPENING DOWNLOAD PAGE...' }); await waitLoad(win);
  }
  return false;
}
ipcMain.handle('dl:cancel', () => { if (pending) { try { pending.item?.cancel(); } catch {} pending.reject(new Error('ยกเลิกแล้ว')); } return true; });
ipcMain.handle('dl', async (e, { game: g, uploadId, temp }) => {
  if (pending) return { ok: false, error: 'กำลังโหลดเกมอื่นอยู่ รอให้เสร็จก่อน' };
  hookDl();
  const send = (o) => { try { e.sender.send('dl:progress', { id: g.id, ...o }); } catch {} };
  const dir = temp ? path.join(tempRoot(), g.id.replace(/[^\w-]/g, '_')) : path.join(gDir(g.id), 'app');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let win, to;
  try {
    send({ phase: 'OPENING GAME PAGE...' });
    const file = await new Promise(async (resolve, reject) => {
      pending = { dir, resolve, reject, started: false, item: null, progress: (r, t) => send({ phase: 'DOWNLOADING', received: r, total: t, pct: t > 0 ? Math.round((r / t) * 100) : null }) };
      to = setTimeout(() => reject(new Error('หมดเวลา (15 นาที)')), 900000);
      win = new BrowserWindow({ show: false, focusable: false, width: 1000, height: 800, title: g.title + ' - กดดาวน์โหลดเองถ้าไม่เริ่ม', webPreferences: { sandbox: true, partition: 'scraper' } });
      win.webContents.setUserAgent(UA);
      win.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { show: false } }));
      const showWin = (txt) => { if (win && !win.isDestroyed()) { win.setFocusable(true); win.show(); send({ phase: 'MANUAL', text: txt }); } };
      try {
        const ok = await drive(win, g, uploadId, send);
        if (!ok) showWin('แอปกดโหลดให้เองไม่ได้ (เกมอาจต้องซื้อ/เป็นหน้าพิเศษ) — กดดาวน์โหลดในหน้าต่างที่เปิดขึ้น แอปจะรับไฟล์ต่อให้');
        else setTimeout(() => { if (pending && !pending.started) showWin('ยังไม่เริ่มโหลด — กดดาวน์โหลดเองในหน้าต่างที่เปิดขึ้น'); }, 25000);
      } catch (err) { reject(err); }
    });
    clearTimeout(to); pending = null; if (win && !win.isDestroyed()) win.destroy();
    let root = dir;
    if (/\.(zip|7z|tar|gz|tgz|bz2|xz)$/i.test(file)) {
      send({ phase: 'EXTRACTING', pct: null });
      root = path.join(dir, 'game');
      if (!extractArchive(file, root)) { shell.openPath(dir); return { ok: true, manual: true, dir }; }
      fs.rmSync(file, { force: true });
    }
    const exes = /\.exe$/i.test(file) ? [{ p: file }] : findExes(root);
    if (!exes.length) { shell.openPath(root); return { ok: true, manual: true, dir: root }; }
    if (temp) { send({ phase: 'LAUNCHING' }); launch(exes[0].p, dir); return { ok: true, launched: true }; }
    fs.writeFileSync(path.join(gDir(g.id), 'game.json'), JSON.stringify({ game: g, kind: 'exe', dir: root, exe: exes[0].p, exes: exes.slice(0, 15).map((x) => x.p) }));
    return { ok: true, installed: true };
  } catch (err) {
    clearTimeout(to); pending = null; if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('exe:set', (_e, { id, rel }) => {
  const m = metaOf(id); if (!m) return false;
  const p = path.join(m.dir, rel); if (!p.startsWith(m.dir) || !fs.existsSync(p)) return false;
  m.exe = p; fs.writeFileSync(path.join(gDir(id), 'game.json'), JSON.stringify(m)); return true;
});
ipcMain.handle('folder:open', (_e, id) => { const m = metaOf(id); if (m) shell.openPath(m.dir || gDir(id)); return true; });
ipcMain.handle('data:path', () => app.getPath('userData'));
app.on('quit', cleanTemp);

// ---------- Play ----------
// install=true: เก็บไฟล์เกมลงเครื่อง (เล่นออฟไลน์ได้) | install=false: โหลดชั่วคราว ปิดแล้วล้างแคช
// save ของเกม (localStorage/IndexedDB) อยู่ใน partition ถาวรเสมอ
ipcMain.handle('play', async (_e, { game: g, install }) => {
  let meta = metaOf(g.id);
  if (meta?.kind === 'exe') { if (fs.existsSync(meta.exe)) launch(meta.exe); else shell.openPath(meta.dir); return true; }
  const ses = session.fromPartition('persist:game-' + g.id);
  if (install && !meta) {
    fs.mkdirSync(gDir(g.id), { recursive: true });
    meta = { game: g, playUrl: null };
    fs.writeFileSync(path.join(gDir(g.id), 'game.json'), JSON.stringify(meta));
  }
  let host = meta?.playUrl ? new URL(meta.playUrl).hostname : null;
  if (meta) hookCache(ses, g.id, () => host);

  const win = new BrowserWindow({ width: 1280, height: 800, autoHideMenuBar: true, title: g.title, icon: path.join(__dirname, 'renderer/icon.png'),
    webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
  win.webContents.setUserAgent(UA);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  const saveMeta = (playUrl) => { if (!meta) return; meta.playUrl = playUrl; host = new URL(playUrl).hostname; fs.writeFileSync(path.join(gDir(g.id), 'game.json'), JSON.stringify(meta)); };

  if (meta?.playUrl) { win.loadURL(meta.playUrl); }          // ติดตั้งแล้ว: เปิดตรง/ออฟไลน์
  else if (/(^|\.)itch\.io$/.test(new URL(g.url).hostname)) {
    let launched = false;
    win.webContents.on('did-finish-load', async () => {
      if (launched || win.isDestroyed()) return; launched = true;
      try {
        const src = await win.webContents.executeJavaScript(`new Promise(res=>{
          const b=document.querySelector('.load_iframe_btn,.iframe_placeholder .button'); if(b) b.click();
          let n=0;const t=setInterval(()=>{const f=document.querySelector('#game_drop iframe, .game_frame iframe, iframe[allowfullscreen]');
            if(f&&f.src){clearInterval(t);res(f.src);} else if(++n>40){clearInterval(t);res(null);}},250);})`);
        if (src && !win.isDestroyed()) { saveMeta(src); win.loadURL(src); }
        else if (!win.isDestroyed()) win.webContents.executeJavaScript(`alert('เกมนี้ไม่ใช่เกมเว็บ (HTML5) เล่นในแอปไม่ได้')`);
      } catch {}
    });
    win.loadURL(g.url);
  } else { saveMeta(g.url); win.loadURL(g.url); }
  win.on('closed', () => { if (!metaOf(g.id)) ses.clearCache(); });
  return true;
});

app.whenReady().then(() => {
  cleanTemp();
  const win = new BrowserWindow({
    width: 1200, height: 780, minWidth: 900, minHeight: 600, title: 'Pen Store',
    backgroundColor: '#000000', autoHideMenuBar: true, icon: path.join(__dirname, 'renderer/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  mainWin = win;
  win.webContents.on('before-input-event', (_e, i) => { if (i.type === 'keyDown' && (i.key === 'F12' || (i.control && i.shift && i.key.toLowerCase() === 'i'))) win.webContents.toggleDevTools(); });
  win.loadFile('renderer/index.html');
});
app.on('window-all-closed', () => app.quit());

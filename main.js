const { app, BrowserWindow, ipcMain, session, shell, net } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const libFile = () => path.join(app.getPath('userData'), 'library.json');
const readLib = () => { try { return JSON.parse(fs.readFileSync(libFile(), 'utf8')); } catch { return []; } };
const writeLib = (l) => fs.writeFileSync(libFile(), JSON.stringify(l, null, 1));
const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// ---------- Sources ----------
// เพิ่มแหล่งเกมใหม่: ทุก source คืน {games:[{id,title,author,desc,thumb,url,genre,source}], url}
// ใช้หน้าต่างซ่อน (Chromium จริง) อ่านหน้า itch.io ผ่าน DOM แทน regex จะทนกว่าและรูป/ลิงก์ครบ
let scraper = null, queue = Promise.resolve(), mainWin = null;
function refocus() { // หน้าต่างซ่อนอาจแย่งโฟกัสคีย์บอร์ดจนพิมพ์ในช่องค้นหาไม่ได้ -> ดึงโฟกัสกลับ
  if (!mainWin || mainWin.isDestroyed()) return;
  if (BrowserWindow.getAllWindows().some((w) => w !== mainWin && w.isVisible())) return;
  mainWin.focus(); mainWin.webContents.focus();
}
ipcMain.handle('focus', () => refocus());
const EXTRACT = `(() => [...document.querySelectorAll('.game_cell')].map(c => {
  const a = c.querySelector('a.title.game_link, .game_title a, a.game_link'); if (!a) return null;
  const img = c.querySelector('img'); let thumb = img && (img.dataset.lazy_src || (/^https?:/.test(img.src) ? img.src : ''));
  if (!thumb) { const t = c.querySelector('.game_thumb'); const m = t && (t.getAttribute('style') || '').match(/url\\(["']?([^"')]+)/); thumb = m ? m[1] : ''; }
  const id = c.dataset.game_id || a.href;
  return { id: 'itch-' + id, title: a.textContent.trim(), url: a.href, thumb,
    desc: (c.querySelector('.game_text') || {}).textContent || '', author: ((c.querySelector('.game_author a')||{}).textContent || ''),
    genre: ((c.querySelector('.game_genre')||{}).textContent || ''), price: ((c.querySelector('.price_value')||{}).textContent || ''), source: 'itch.io' };
}).filter(Boolean))()`;
function scrape(url, script = EXTRACT, sel = '.game_cell') {
  const job = async () => {
    if (!scraper || scraper.isDestroyed()) scraper = new BrowserWindow({ show: false, focusable: false, webPreferences: { sandbox: true, partition: 'scraper', images: false } });
    scraper.webContents.setUserAgent(UA);
    await scraper.loadURL(url);
    for (let i = 0; i < 28; i++) {
      const ok = await scraper.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(sel)})`);
      if (ok) break; await new Promise((r) => setTimeout(r, 250));
    }
    const out = await scraper.webContents.executeJavaScript(script);
    refocus();
    return out;
  };
  const p = queue.then(job, job); queue = p.catch(() => {}); return p;
}
const sources = {
  // ใช้ URL แบบ itch จริง: https://itch.io/games/tag-1v1 และ https://itch.io/search?q=text (ทุกประเภทเกม ไม่จำกัด HTML5)
  async itch({ q, tag, page = 1, sort = '', filter = '' }) {
    let url;
    if (q) url = `https://itch.io/search?q=${encodeURIComponent(q)}&page=${page}`;
    else {
      const parts = [sort, filter, tag ? 'tag-' + encodeURIComponent(tag) : ''].filter(Boolean);
      url = `https://itch.io/games${parts.length ? '/' + parts.join('/') : ''}?page=${page}`;
    }
    const games = await scrape(url);
    return { games, url };
  }
};

ipcMain.handle('search', async (_e, o) => {
  try { const r = await sources[o.source || 'itch'](o); return { ok: true, games: r.games, url: r.url }; }
  catch (err) { return { ok: false, error: String(err) }; }
});

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

// ---------- Details (รูปตัวอย่าง/คำอธิบาย/ข้อมูลเกม/ไฟล์ดาวน์โหลด) ----------
const DETAIL = `(() => {
  const shots = [...document.querySelectorAll('a[data-image_lightbox]')].map(a => a.href);
  if (!shots.length) { const og = document.querySelector('meta[property="og:image"]'); if (og) shots.push(og.content); }
  const d = document.querySelector('.formatted_description');
  let desc = d ? d.innerText.trim().slice(0, 5000) : '';
  if (!desc) desc = (document.querySelector('meta[property="og:description"]') || {}).content || '';
  const info = [...document.querySelectorAll('.game_info_panel_widget tr')].map(r => { const t = r.querySelectorAll('td'); return t.length >= 2 ? [t[0].innerText.trim(), t[1].innerText.trim().replace(/\\n+/g, ', ')] : null; }).filter(Boolean);
  const uploads = [...document.querySelectorAll('.upload')].map(u => {
    const b = u.querySelector('.download_btn'); if (!b) return null;
    const pl = []; const has = s => !!u.querySelector('[class*="' + s + '"]');
    if (has('icon-windows')) pl.push('win'); if (has('icon-apple')) pl.push('mac'); if (has('icon-tux')) pl.push('linux'); if (has('icon-android')) pl.push('android');
    const n = u.querySelector('.upload_name .name, .upload_name');
    const s = u.querySelector('.file_size');
    return { id: b.dataset.upload_id, name: n ? (n.getAttribute('title') || n.textContent).trim() : 'file', size: s ? s.textContent.trim() : '', platforms: pl };
  }).filter(Boolean);
  const html5 = !!document.querySelector('.load_iframe_btn, .html_embed_widget, .iframe_placeholder');
  return { shots, desc, info, uploads, html5 };
})()`;
ipcMain.handle('details', async (_e, url) => {
  try { return { ok: true, ...(await scrape(url, DETAIL, '.game_info_panel_widget, .formatted_description, .upload_list_widget')) }; }
  catch (err) { return { ok: false, error: String(err) }; }
});
ipcMain.handle('open:ext', (_e, u) => shell.openExternal(u));

// ---------- Install / Cache ----------
const gamesRoot = () => path.join(app.getPath('userData'), 'games');
const gDir = (id) => path.join(gamesRoot(), id.replace(/[^\w-]/g, '_'));
const metaOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(gDir(id), 'game.json'), 'utf8')); } catch { return null; } };
const dirSize = (d) => { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch {} return n; };
ipcMain.handle('inst:list', () => {
  const out = {};
  try { for (const d of fs.readdirSync(gamesRoot())) { const m = metaOf(d); if (m) out[m.game.id] = { size: dirSize(path.join(gamesRoot(), d)), kind: m.kind || 'web' }; } } catch {}
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

// ---------- Download เกมโหลดไฟล์ (exe/zip) ----------
const tempRoot = () => path.join(app.getPath('temp'), 'penstore-temp');
const cleanTemp = () => { try { fs.rmSync(tempRoot(), { recursive: true, force: true }); } catch {} };
function findExes(root, depth = 0, out = []) {
  try {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const p = path.join(root, e.name);
      if (e.isDirectory()) { if (depth < 4) findExes(p, depth + 1, out); }
      else if (/\.exe$/i.test(e.name) && !/unins|crash|redist|vcredist|dxsetup|dotnet|notification_helper|updater/i.test(e.name)) out.push({ p, size: fs.statSync(p).size });
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
let pending = null, dlHooked = false;
function hookDl() {
  if (dlHooked) return; dlHooked = true;
  session.fromPartition('scraper').on('will-download', (_ev, item) => {
    const p = pending; if (!p) return item.cancel();
    const fp = path.join(p.dir, item.getFilename()); item.setSavePath(fp); p.started = true;
    item.on('updated', () => p.progress(item.getReceivedBytes(), item.getTotalBytes()));
    item.once('done', (_e, state) => state === 'completed' ? p.resolve(fp) : p.reject(new Error('download ' + state)));
  });
}
ipcMain.handle('dl', async (e, { game: g, uploadId, temp }) => {
  hookDl();
  const send = (t) => { try { e.sender.send('dl:progress', t); } catch {} };
  const dir = temp ? path.join(tempRoot(), g.id.replace(/[^\w-]/g, '_')) : path.join(gDir(g.id), 'app');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let win;
  try {
    send('OPENING GAME PAGE...');
    const file = await new Promise(async (resolve, reject) => {
      pending = { dir, resolve, reject, started: false, progress: (r, t) => send(`DOWNLOADING ${(r / 1048576).toFixed(1)}${t > 0 ? ' / ' + (t / 1048576).toFixed(1) : ''} MB`) };
      win = new BrowserWindow({ show: false, focusable: false, width: 1000, height: 800, title: g.title + ' - กดดาวน์โหลดเองถ้าไม่เริ่ม', webPreferences: { sandbox: true, partition: 'scraper' } });
      win.webContents.setUserAgent(UA);
      win.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { show: false } }));
      setTimeout(() => reject(new Error('หมดเวลา (10 นาที)')), 600000);
      try {
        await win.loadURL(g.url);
        const ok = await win.webContents.executeJavaScript(`new Promise(res=>{let n=0;const t=setInterval(()=>{const b=document.querySelector('.download_btn[data-upload_id="${String(uploadId).replace(/\W/g, '')}"]');
          if(b){clearInterval(t);b.click();res(true)}else if(++n>30){clearInterval(t);res(false)}},300)})`);
        if (!ok) { win.setFocusable(true); win.show(); send('หาปุ่มดาวน์โหลดไม่เจอ: กดดาวน์โหลดเองในหน้าต่างที่เปิดขึ้น (เกมที่ต้องซื้อ/ต้องกด "No thanks")'); }
        else setTimeout(() => { if (!pending?.started && win && !win.isDestroyed()) { win.setFocusable(true); win.show(); send('ยังไม่เริ่มโหลด: กดดาวน์โหลดเองในหน้าต่างที่เปิดขึ้น'); } }, 20000);
      } catch (err) { reject(err); }
    });
    pending = null; if (win && !win.isDestroyed()) win.destroy();
    let root = dir;
    if (/\.zip$/i.test(file)) { send('EXTRACTING...'); root = path.join(dir, 'game'); new AdmZip(file).extractAllTo(root, true); fs.rmSync(file, { force: true }); }
    const exe = /\.exe$/i.test(file) ? file : findExes(root)[0]?.p;
    if (!exe) { shell.openPath(root); return { ok: true, manual: true, dir: root }; }
    if (!temp) fs.writeFileSync(path.join(gDir(g.id), 'game.json'), JSON.stringify({ game: g, kind: 'exe', dir: root, exe }));
    send('LAUNCHING...'); launch(exe, temp ? dir : null);
    return { ok: true, exe };
  } catch (err) {
    pending = null; if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: false, error: String(err.message || err) };
  }
});
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
    backgroundColor: '#171a21', autoHideMenuBar: true, icon: path.join(__dirname, 'renderer/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  mainWin = win; win.once('ready-to-show', () => win.focus());
  win.loadFile('renderer/index.html');
});
app.on('window-all-closed', () => app.quit());

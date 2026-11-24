const { app, BrowserWindow, ipcMain, session, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const libFile = () => path.join(app.getPath('userData'), 'library.json');
const readLib = () => { try { return JSON.parse(fs.readFileSync(libFile(), 'utf8')); } catch { return []; } };
const writeLib = (l) => fs.writeFileSync(libFile(), JSON.stringify(l, null, 1));
const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// ---------- Sources ----------
// เพิ่มแหล่งเกมใหม่ได้ที่นี่: ทุก source ต้องคืน array ของ {id,title,author,desc,thumb,url,source}
const sources = {
  async itch({ q, tag, page = 1, sort = '' }) {
    let url;
    if (q) url = `https://itch.io/search?type=games&q=${encodeURIComponent(q)}&page=${page}`;
    else url = `https://itch.io/games/html5/free${sort ? '/' + sort : ''}${tag ? '/tag-' + encodeURIComponent(tag) : ''}?page=${page}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const html = await res.text();
    const parts = html.split('data-game_id="').slice(1);
    return parts.map((p) => {
      const id = p.match(/^(\d+)/)?.[1];
      const link = p.match(/class="title game_link"[^>]*href="([^"]+)"/) || p.match(/href="([^"]+)"[^>]*class="title game_link"/);
      const title = p.match(/class="title game_link"[^>]*>([^<]+)</)?.[1];
      const thumb = p.match(/data-lazy_src="([^"]+)"/)?.[1] || p.match(/<img[^>]+src="(https:[^"]+)"/)?.[1];
      const desc = p.match(/class="game_text"[^>]*>([^<]*)</)?.[1] || '';
      const author = p.match(/class="game_author"[^>]*><a[^>]*>([^<]+)</)?.[1] || '';
      if (!id || !link || !title) return null;
      return { id: 'itch-' + id, title: decode(title), author: decode(author), desc: decode(desc), thumb, url: link[1], source: 'itch.io' };
    }).filter(Boolean);
  }
};

ipcMain.handle('search', async (_e, o) => {
  try { return { ok: true, games: await sources[o.source || 'itch'](o) }; }
  catch (err) { return { ok: false, error: String(err) }; }
});

// ---------- Library ----------
ipcMain.handle('lib:get', () => readLib());
ipcMain.handle('lib:toggle', (_e, g) => {
  let l = readLib();
  l = l.some((x) => x.id === g.id) ? l.filter((x) => x.id !== g.id) : [...l, g];
  writeLib(l); return l;
});
ipcMain.handle('lib:addurl', (_e, u) => {
  const l = readLib();
  const host = new URL(u).hostname;
  const g = { id: 'url-' + Buffer.from(u).toString('base64').slice(0, 24), title: host + new URL(u).pathname, author: 'Custom URL', desc: u, thumb: '', url: u, source: 'URL' };
  if (!l.some((x) => x.id === g.id)) l.push(g);
  writeLib(l); return l;
});
ipcMain.handle('save:clear', async (_e, id) => {
  await session.fromPartition('persist:game-' + id).clearStorageData(); return true;
});

// ---------- Details (รูปตัวอย่าง/คำอธิบาย/ข้อมูลเกม) ----------
const strip = (s = '') => decode(s.replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
ipcMain.handle('details', async (_e, url) => {
  try {
    const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
    let shots = [...html.matchAll(/<a\b[^>]*data-image_lightbox[^>]*>/g)].map((x) => x[0].match(/href="([^"]+)"/)?.[1]).filter(Boolean);
    const og = html.match(/property="og:image"[^>]*content="([^"]+)"/)?.[1];
    if (!shots.length && og) shots = [og];
    let desc = '';
    const i = html.indexOf('formatted_description');
    if (i > -1) {
      let seg = html.slice(i, i + 40000);
      seg = seg.slice(seg.indexOf('>') + 1);
      const cut = ['more_information_toggle', 'game_info_panel_widget', 'class="buy_row', 'class="game_comments', 'class="community_post'].map((k) => seg.indexOf(k)).filter((n) => n > 0);
      if (cut.length) seg = seg.slice(0, Math.min(...cut));
      desc = strip(seg).slice(0, 5000);
    }
    if (!desc) desc = decode(html.match(/property="og:description"[^>]*content="([^"]*)"/)?.[1] || '');
    const panel = html.match(/game_info_panel_widget[\s\S]*?<\/table>/)?.[0] || '';
    const info = [...panel.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/g)].map((r) => [strip(r[1]), strip(r[2]).replace(/\n+/g, ', ')]);
    return { ok: true, shots, desc, info };
  } catch (err) { return { ok: false, error: String(err) }; }
});

// ---------- Install / Cache ----------
const gamesRoot = () => path.join(app.getPath('userData'), 'games');
const gDir = (id) => path.join(gamesRoot(), id.replace(/[^\w-]/g, '_'));
const metaOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(gDir(id), 'game.json'), 'utf8')); } catch { return null; } };
const dirSize = (d) => { let n = 0; try { for (const f of fs.readdirSync(d)) n += fs.statSync(path.join(d, f)).size; } catch {} return n; };
ipcMain.handle('inst:list', () => {
  const out = {};
  try { for (const d of fs.readdirSync(gamesRoot())) { const m = metaOf(d); if (m) out[m.game.id] = { size: dirSize(path.join(gamesRoot(), d)) }; } } catch {}
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

// ---------- Play ----------
// install=true: เก็บไฟล์เกมลงเครื่อง (เล่นออฟไลน์ได้) | install=false: โหลดชั่วคราว ปิดแล้วล้างแคช
// save ของเกม (localStorage/IndexedDB) อยู่ใน partition ถาวรเสมอ
ipcMain.handle('play', async (_e, { game: g, install }) => {
  const ses = session.fromPartition('persist:game-' + g.id);
  let meta = metaOf(g.id);
  if (install && !meta) {
    fs.mkdirSync(gDir(g.id), { recursive: true });
    meta = { game: g, playUrl: null };
    fs.writeFileSync(path.join(gDir(g.id), 'game.json'), JSON.stringify(meta));
  }
  let host = meta?.playUrl ? new URL(meta.playUrl).hostname : null;
  if (meta) hookCache(ses, g.id, () => host);

  const win = new BrowserWindow({ width: 1280, height: 800, autoHideMenuBar: true, title: g.title,
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
  const win = new BrowserWindow({
    width: 1200, height: 780, minWidth: 900, minHeight: 600, title: 'Pen Store',
    backgroundColor: '#171a21', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.loadFile('renderer/index.html');
});
app.on('window-all-closed', () => app.quit());

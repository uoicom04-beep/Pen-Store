'use strict';
const TAGS = ['action','adventure','horror','puzzle','platformer','rpg','survival','shooter','strategy','multiplayer','racing','casual','pixel-art','2d','3d','retro','simulation','card-game','fighting','visual-novel','roguelike','cute','sci-fi','fantasy','difficult','funny','atmospheric','short','idle','tower-defense','farming','stealth','zombies','space','cyberpunk','rhythm','sandbox','arcade','point-and-click','minecraft'];
const PF = pen.platform;
const $ = (s) => document.querySelector(s);
const st = { view: 'store', tag: '', q: '', page: 1, inst: {}, lib: [], dl: {}, cur: null, req: 0, loading: false, ended: false };
const slug = (t) => t.toLowerCase().trim().replace(/\s+/g, '-');
const abs = (h, base) => { try { return new URL(h, base).href; } catch { return ''; } };

// ---------- helpers ----------
function toast(t, ms = 3200) { const d = document.createElement('div'); d.textContent = t; $('#toast').appendChild(d); setTimeout(() => d.remove(), ms); }
function status(t) { $('#ss').textContent = t; }
function msg(html) { $('#grid').innerHTML = '<div class="msg">' + html + '</div>'; }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// กล่องถาม/ยืนยันในแอป (ไม่ใช้ alert/confirm ของ Electron เพราะทำให้ช่องพิมพ์ค้างบน Windows)
function dialog({ title, text = '', input = null, ok = 'ตกลง', cancel = 'ยกเลิก' }) {
  return new Promise((res) => {
    $('#dt').textContent = title; $('#dm').textContent = text;
    const i = $('#di'); i.style.display = input === null ? 'none' : ''; i.value = ''; i.placeholder = input || '';
    $('#dok').textContent = ok; $('#dno').textContent = cancel; $('#dno').style.display = cancel ? '' : 'none';
    $('#dlg').style.display = 'flex'; (input === null ? $('#dok') : i).focus();
    const done = (v) => { $('#dlg').style.display = 'none'; i.onkeydown = null; res(v); };
    $('#dok').onclick = () => done(input === null ? true : i.value.trim());
    $('#dno').onclick = () => done(input === null ? false : null);
    i.onkeydown = (e) => { if (e.key === 'Enter') done(i.value.trim()); if (e.key === 'Escape') done(null); };
  });
}
const confirmBox = (title, text) => dialog({ title, text });

// รูป: โหลดตรงก่อน ถ้าพังให้ขอผ่าน main (กัน hotlink) ถ้ายังพังก็ปล่อยเป็นตัวอักษร
function loadImg(box, url, cls) {
  if (!url) return null;
  const i = new Image(); i.referrerPolicy = 'no-referrer'; i.alt = ''; if (cls) i.className = cls;
  let tried = false;
  i.onload = () => { if (!i.isConnected) box.prepend(i); };
  i.onerror = async () => { if (tried) return i.remove(); tried = true; const d = await pen.img(url); if (d) i.src = d; else i.remove(); };
  i.src = url; return i;
}

// ---------- tags / nav ----------
const tg = $('#tags');
tg.innerHTML = '<button class="tg on" data-t="">ทั้งหมด</button>' + TAGS.map((t) => `<button class="tg" data-t="${t}">${t}</button>`).join('');
function markTag() { tg.querySelectorAll('.tg').forEach((n) => n.classList.toggle('on', n.dataset.t === st.tag)); }
tg.onclick = (e) => { const t = e.target.dataset.t; if (t !== undefined) setTag(t); };
function setTag(t) { st.tag = t; st.q = ''; $('#q').value = t ? '#' + t : ''; markTag(); setNav('store'); store(true); }
function setNav(v) { st.view = v; document.querySelectorAll('.nav').forEach((x) => x.classList.toggle('on', x.dataset.v === v)); }
document.querySelectorAll('.nav').forEach((n) => n.onclick = () => { setNav(n.dataset.v); if (n.dataset.v === 'lib') lib(); else store(true); });

// ---------- parsing ----------
function thumbOf(c, base) {
  const cand = [];
  c.querySelectorAll('img').forEach((img) => cand.push(img.getAttribute('data-lazy_src'), img.getAttribute('data-src'), img.getAttribute('src')));
  c.querySelectorAll('[data-background_image]').forEach((e) => cand.push(e.getAttribute('data-background_image')));
  c.querySelectorAll('[style*="url("]').forEach((e) => { const m = (e.getAttribute('style') || '').match(/url\(["']?([^"')]+)/); if (m) cand.push(m[1]); });
  const t = cand.find((u) => u && !u.startsWith('data:') && !/blank|spacer|placeholder/i.test(u));
  return t ? abs(t.replace(/&amp;/g, '&'), base) : '';
}
function parseGames(doc, base) {
  const seen = new Set(); const cells = [...doc.querySelectorAll('.game_cell, [data-game_id]')].filter((c, _, all) => !all.some((o) => o !== c && o.contains(c)));
  return cells.map((c) => {
    const a = c.querySelector('a.title.game_link, .game_title a, a.title, a.game_link'); if (!a) return null;
    const url = abs(a.getAttribute('href'), base); if (!url) return null;
    const tx = (s) => (c.querySelector(s)?.textContent || '').trim();
    const id = 'itch-' + (c.getAttribute('data-game_id') || url); if (seen.has(id)) return null; seen.add(id);
    const title = (a.textContent || '').trim() || tx('.title') || url;
    return { id, title, url, thumb: thumbOf(c, base), desc: tx('.game_text'), author: tx('.game_author a') || tx('.game_author'), genre: tx('.game_genre'), price: tx('.price_value'), source: 'itch.io' };
  }).filter(Boolean);
}
const toDoc = (html) => new DOMParser().parseFromString(html, 'text/html');

// ดึงรายการเกม 3 ชั้น: HTML ธรรมดา -> format=json -> เปิดหน้าซ่อน render
async function fetchGames(url) {
  const notes = [];
  let r = await pen.page(url);
  if (r.ok) {
    notes.push('HTML ' + r.status);
    const g = parseGames(toDoc(r.html), r.url || url); if (g.length) return { games: g, notes };
    if (r.status === 404) return { games: [], notes: [...notes, 'ไม่พบหน้านี้'] };
  } else notes.push('HTML error: ' + r.error);
  const ju = url + (url.includes('?') ? '&' : '?') + 'format=json';
  r = await pen.page(ju);
  if (r.ok) {
    try { const j = JSON.parse(r.html); notes.push('JSON ' + r.status); const g = parseGames(toDoc(j.content || ''), url); if (g.length) return { games: g, notes }; }
    catch { notes.push('JSON ไม่ถูกต้อง'); }
  }
  r = await pen.page(url, true);
  if (r.ok) { notes.push('RENDER'); const g = parseGames(toDoc(r.html), r.url || url); return { games: g, notes }; }
  notes.push('RENDER error: ' + r.error);
  return { games: [], notes, failed: true };
}

// ---------- store ----------
function listUrl() {
  const { q, tag, page } = st;
  if (q) return `https://itch.io/search?q=${encodeURIComponent(q)}&page=${page}`;
  const parts = [$('#sort').value, $('#flt').value, tag ? 'tag-' + encodeURIComponent(tag) : ''].filter(Boolean);
  return `https://itch.io/games${parts.length ? '/' + parts.join('/') : ''}?page=${page}`;
}
async function refreshInst() { try { st.inst = await pen.inst(); } catch { st.inst = {}; } $('#si').textContent = Object.keys(st.inst).length; }
let shown = 0;
function card(x) {
  const d = document.createElement('div'); d.className = 'card'; d.dataset.id = x.id;
  d.innerHTML = '<div class="im"><span></span></div><div class="bd"><div class="t"></div><div class="a"></div></div>';
  const im = d.querySelector('.im'); d.querySelector('span').textContent = ((x.title || '?').trim()[0] || '?').toUpperCase();
  loadImg(im, x.thumb);
  if (st.inst[x.id]) { const b = document.createElement('div'); b.className = 'badge'; b.textContent = 'ติดตั้งแล้ว'; im.appendChild(b); }
  d.querySelector('.t').textContent = x.title; d.querySelector('.t').title = x.title;
  d.querySelector('.a').textContent = [x.author, x.source].filter(Boolean).join(' · ');
  const bd = d.querySelector('.bd');
  if (x.genre) { const g = document.createElement('span'); g.className = 'pill'; g.textContent = x.genre.trim(); bd.appendChild(g); }
  if (x.price) { const g = document.createElement('span'); g.className = 'pill pr'; g.textContent = x.price.trim(); bd.appendChild(g); }
  d.onclick = () => detail(x); return d;
}
function render(games, replace, more) {
  const g = $('#grid'); if (replace) { g.innerHTML = ''; shown = 0; g.scrollTop = 0; }
  g.querySelector('#more')?.remove();
  games.forEach((x) => g.appendChild(card(x))); shown += games.length; $('#sn').textContent = shown;
  if (more) { const b = document.createElement('button'); b.id = 'more'; b.className = 'btn ghost'; b.textContent = 'โหลดเพิ่ม'; b.onclick = () => store(false); g.appendChild(b); }
}
async function store(reset) {
  if (!reset && (st.loading || st.ended)) return;
  const my = ++st.req; st.loading = true;
  if (reset) { st.page = 1; st.ended = false; } else st.page++;
  const moreBtn = $('#more'); if (moreBtn) { moreBtn.disabled = true; moreBtn.textContent = 'กำลังโหลด...'; }
  if (reset) { msg('<div class="spin"></div><b>กำลังโหลดเกม...</b>'); $('#sn').textContent = 0; }
  status('กำลังดึงข้อมูลจาก itch.io...');
  await refreshInst(); if (my !== st.req) return;
  const url = listUrl();
  const res = await fetchGames(url);
  if (my !== st.req) return;          // มีการค้นหาใหม่แล้ว ทิ้งผลเก่า
  st.loading = false;
  const retry = '<br><button class="btn" id="retry">ลองใหม่</button>';
  const wire = () => { const b = $('#retry'); if (b) b.onclick = () => store(true); };
  if (!res.games.length) {
    if (!reset) { st.page--; st.ended = true; status('หมดแล้ว'); if (moreBtn) moreBtn.remove(); return; }
    if (res.failed) { status('ต่อเน็ตไม่ได้'); msg('<b>โหลดไม่ได้</b><br>เช็คอินเทอร์เน็ต แล้วกดลองใหม่' + retry + '<small>' + esc(url) + '<br>' + esc(res.notes.join(' → ')) + '</small>'); return wire(); }
    status('ไม่พบเกม'); msg('<b>ไม่พบเกม</b><br>ลองคำค้นหรือแท็กอื่น' + retry + '<small>' + esc(url) + '<br>' + esc(res.notes.join(' → ')) + '</small>'); return wire();
  }
  render(res.games, reset, true); status('พร้อม');
}

// ---------- library ----------
async function lib() {
  const my = ++st.req; st.loading = false; await refreshInst(); st.lib = await pen.lib(); if (my !== st.req) return;
  const q = st.q.toLowerCase(); const l = st.lib.filter((g) => !q || g.title.toLowerCase().includes(q));
  if (!l.length) { $('#sn').textContent = 0; return msg('<b>คลังยังว่าง</b><br>เปิดเกมแล้วกด "เพิ่มเข้าคลัง" หรือกด "เพิ่มลิงก์เกม"'); }
  render(l, true, false); status('คลังของฉัน');
}

// ---------- detail ----------
function parseDetail(doc, base) {
  let shots = [...doc.querySelectorAll('a[data-image_lightbox]')].map((a) => abs(a.getAttribute('href'), base)).filter(Boolean);
  if (!shots.length) shots = [...doc.querySelectorAll('.screenshot_list img, .screenshots img')].map((i) => abs(i.getAttribute('data-lazy_src') || i.getAttribute('src') || '', base)).filter((u) => u && !u.startsWith('data:'));
  if (!shots.length) { const og = doc.querySelector('meta[property="og:image"]'); if (og?.content) shots = [og.content]; }
  let desc = ''; const d = doc.querySelector('.formatted_description');
  if (d) { const c = d.cloneNode(true); c.querySelectorAll('br').forEach((b) => b.replaceWith('\n')); c.querySelectorAll('p,li,h1,h2,h3,h4,div').forEach((e) => e.append('\n')); desc = c.textContent.replace(/\n{3,}/g, '\n\n').trim().slice(0, 5000); }
  if (!desc) desc = doc.querySelector('meta[property="og:description"]')?.content || '';
  const info = [...doc.querySelectorAll('.game_info_panel_widget tr')].map((r) => {
    const t = r.querySelectorAll('td'); if (t.length < 2) return null;
    const links = [...t[1].querySelectorAll('a')].map((a) => a.textContent.trim()).filter(Boolean);
    return [t[0].textContent.trim(), links.length ? links.join(', ') : t[1].textContent.trim().replace(/\s+/g, ' ')];
  }).filter(Boolean);
  const uploads = [...doc.querySelectorAll('.upload')].map((u) => {
    const b = u.querySelector('.download_btn'); if (!b) return null;
    const has = (s) => !!u.querySelector('[class*="' + s + '"]'); const pl = [];
    if (has('icon-windows')) pl.push('win'); if (has('icon-apple')) pl.push('mac'); if (has('icon-tux')) pl.push('linux'); if (has('icon-android')) pl.push('android');
    const n = u.querySelector('.upload_name .name, .upload_name'); const s = u.querySelector('.file_size');
    return { id: b.getAttribute('data-upload_id'), name: n ? (n.getAttribute('title') || n.textContent).trim() : 'file', size: s ? s.textContent.trim() : '', platforms: pl };
  }).filter(Boolean);
  const html5 = !!doc.querySelector('.load_iframe_btn, .html_embed_widget, .iframe_placeholder');
  return { shots, desc, info, uploads, html5 };
}
async function loadDetail(url) {
  let r = await pen.page(url);
  if (r.ok && r.status === 200) { const d = parseDetail(toDoc(r.html), r.url || url); if (d.shots.length || d.desc || d.uploads.length) return { ok: true, ...d }; }
  r = await pen.page(url, true);
  if (r.ok) return { ok: true, ...parseDetail(toDoc(r.html), r.url || url) };
  return { ok: false, error: r.error };
}
function paintDl(o) {
  const s = st.dl[o.id] = Object.assign(st.dl[o.id] || {}, o); const pct = s.pct != null ? s.pct : null;
  const txt = s.phase === 'DOWNLOADING' ? `กำลังโหลด ${pct != null ? pct + '%' : ''} (${(s.received / 1048576).toFixed(1)}${s.total > 0 ? ' / ' + (s.total / 1048576).toFixed(1) : ''} MB)`
    : ({ 'OPENING GAME PAGE...': 'กำลังเปิดหน้าเกม...', 'OPENING DOWNLOAD PAGE...': 'กำลังเปิดหน้าดาวน์โหลด...', 'EXTRACTING': 'กำลังแตกไฟล์...', 'LAUNCHING': 'กำลังเปิดเกม...', 'STARTING...': 'เริ่มต้น...' }[s.phase] || s.text || s.phase || '');
  status(txt);
  if (st.cur === o.id) { const d = $('#dl'); if (d) { d.innerHTML = '<div></div><div class="pg"><i></i></div>'; d.firstChild.textContent = txt; d.querySelector('i').style.width = (pct != null ? pct : (s.phase === 'EXTRACTING' ? 100 : 6)) + '%'; } }
  const c = document.querySelector(`.card[data-id="${CSS.escape(o.id)}"]`);
  if (c) { let p = c.querySelector('.cpg'); if (!p) { p = document.createElement('div'); p.className = 'pg cpg'; p.innerHTML = '<i></i>'; c.querySelector('.bd').appendChild(p); } p.firstChild.style.width = (pct != null ? pct : 30) + '%'; }
}
pen.onProgress(paintDl);

async function detail(g) {
  await refreshInst(); st.lib = await pen.lib();
  const has = st.lib.some((x) => x.id === g.id), ins = st.inst[g.id], b = $('#box');
  b.innerHTML = '<img id="main" alt=""><div class="th" id="th"></div><div class="in"><h2></h2><div class="a dim"></div><div class="dsc" id="dsc">กำลังโหลด...</div><div class="inf" id="inf"></div><div id="ups"></div><div id="dl"></div><div class="row" id="acts"></div></div>';
  const mi = $('#main'); mi.referrerPolicy = 'no-referrer';
  let mtried = false; mi.onerror = async () => { if (mtried) return; mtried = true; const d = await pen.img(mi.dataset.src); if (d) mi.src = d; };
  const setMain = (u) => { mtried = false; mi.dataset.src = u; mi.style.display = 'block'; mi.src = u; };
  if (g.thumb) setMain(g.thumb); else mi.style.display = 'none';
  b.querySelector('h2').textContent = g.title; b.querySelector('.a').textContent = [g.author, g.source].filter(Boolean).join(' · '); $('#dsc').textContent = g.desc || '';
  const btn = (txt, cls, fn) => { const x = document.createElement('button'); x.className = 'btn ' + cls; x.textContent = txt; x.onclick = fn; $('#acts').appendChild(x); return x; };
  const close = () => { st.cur = null; $('#modal').style.display = 'none'; };
  let R = null;
  const acts = (r) => {
    $('#acts').innerHTML = ''; const busy = st.dl[g.id] && !st.dl[g.id].done;
    if (busy) { btn('✖ ยกเลิกการโหลด', 'red', () => pen.cancelDl()); btn('ปิด (โหลดต่อเบื้องหลัง)', 'ghost', close); return; }
    if (ins) {
      btn(`▶ เล่น (${(ins.size / 1048576).toFixed(1)} MB)`, '', () => pen.play(g, true));
      if (ins.kind === 'exe') {
        btn('📁 เปิดโฟลเดอร์', 'ghost', () => pen.openFolder(g.id));
        if ((ins.exes || []).length > 1) { const s = document.createElement('select'); s.style.cssText = 'width:auto;margin:0;max-width:340px'; ins.exes.forEach((x) => { const o = document.createElement('option'); o.value = x; o.textContent = x; if (x === ins.exe) o.selected = true; s.appendChild(o); }); s.onchange = () => pen.setExe({ id: g.id, rel: s.value }); $('#acts').appendChild(s); }
      }
    } else if (r && r.html5) {
      btn('⬇ ติดตั้งและเล่น (เว็บ)', '', async () => { await pen.play(g, true); if (!has) await pen.libToggle(g); });
      btn('▶ เล่นชั่วคราว', 'ghost', () => pen.play(g, false));
    }
    btn(has ? '★ เอาออกจากคลัง' : '☆ เพิ่มเข้าคลัง', 'ghost', async () => { await pen.libToggle(g); toast(has ? 'เอาออกจากคลังแล้ว' : 'เพิ่มเข้าคลังแล้ว'); close(); if (st.view === 'lib') lib(); });
    btn('เปิดหน้าเว็บ', 'ghost', () => pen.ext(g.url));
    if ((ins && ins.kind !== 'exe') || (!ins && r && r.html5)) btn('ล้างเซฟ', 'ghost', async () => { if (await confirmBox('ล้างเซฟ?', 'ลบเซฟของเกมเว็บนี้ในแอป')) { await pen.clearSave(g.id); toast('ล้างเซฟแล้ว'); } });
    if (ins) btn('ถอนการติดตั้ง', 'red', async () => { if (await confirmBox('ถอนการติดตั้ง?', 'ลบไฟล์เกมออกจากเครื่อง')) { await pen.uninstall(g.id); close(); toast('ถอนการติดตั้งแล้ว'); st.view === 'lib' ? lib() : store(true); } });
    btn('ปิด', 'ghost', close);
  };
  acts(null); st.cur = g.id; $('#modal').style.display = 'flex'; if (st.dl[g.id] && !st.dl[g.id].done) paintDl(st.dl[g.id]);
  const run = async (u, temp) => {
    if (Object.values(st.dl).some((x) => !x.done)) return toast('กำลังโหลดเกมอื่นอยู่ รอให้เสร็จก่อน');
    st.dl[g.id] = { id: g.id, phase: 'STARTING...', pct: null }; acts(R); $('#ups').style.cssText = 'opacity:.35;pointer-events:none'; paintDl({ id: g.id, phase: 'STARTING...' });
    const res = await pen.dl({ game: g, uploadId: u.id, temp });
    st.dl[g.id].done = true; document.querySelector(`.card[data-id="${CSS.escape(g.id)}"] .cpg`)?.remove(); $('#ups') && ($('#ups').style.cssText = '');
    if (!res.ok) { delete st.dl[g.id]; status('ผิดพลาด'); if ($('#dl')) $('#dl').textContent = 'ผิดพลาด: ' + res.error; return acts(R); }
    delete st.dl[g.id];
    if (res.manual) { if ($('#dl')) $('#dl').textContent = 'โหลดแล้ว แต่แตกไฟล์/หา exe อัตโนมัติไม่ได้ — เปิดโฟลเดอร์ให้แล้ว'; return acts(R); }
    if (res.installed) { if (!has) await pen.libToggle(g); await refreshInst(); status('ติดตั้งแล้ว ✓ ' + g.title); toast('ติดตั้งแล้ว ✓'); if (st.cur === g.id) detail(g); return; }
    if ($('#dl')) $('#dl').textContent = 'เปิดเกมแล้ว ✓ (ไฟล์ชั่วคราวจะถูกลบเมื่อปิดเกม/ปิดแอป)'; status('เปิดเกมแล้ว'); acts(R);
  };
  const r = await loadDetail(g.url); if (st.cur !== g.id) return;
  R = r.ok ? r : null;
  if (!r.ok) { $('#dsc').textContent = g.desc || 'โหลดรายละเอียดไม่ได้'; return acts(null); }
  $('#dsc').textContent = r.desc || g.desc || '(ไม่มีคำอธิบาย)';
  const inf = $('#inf'); inf.innerHTML = '';
  r.info.forEach(([k, v]) => {
    const d = document.createElement('div'), bb = document.createElement('b'); bb.textContent = k; d.appendChild(bb);
    if (/tag|genre/i.test(k)) v.split(/,\s*/).filter(Boolean).forEach((t) => { const c = document.createElement('span'); c.className = 'chip'; c.textContent = '#' + t; c.onclick = () => { close(); setTag(slug(t)); }; d.appendChild(c); });
    else d.appendChild(document.createTextNode(v));
    inf.appendChild(d);
  });
  const th = $('#th');
  if (r.shots.length) {
    setMain(r.shots[0]); th.innerHTML = '';
    r.shots.forEach((s, k) => { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.src = s; i.onerror = () => i.remove(); if (!k) i.className = 'on'; th.appendChild(i); });
    th.onclick = (e) => { if (e.target.tagName !== 'IMG') return; setMain(e.target.src); th.querySelectorAll('img').forEach((i) => i.classList.toggle('on', i === e.target)); };
  } else th.style.display = 'none';
  const ups = $('#ups'); ups.innerHTML = '';
  if (r.uploads.length) {
    const h = document.createElement('div'); h.className = 'lbl'; h.style.padding = '10px 0 2px'; h.textContent = 'ไฟล์เกม'; ups.appendChild(h);
    [...r.uploads].sort((a, b) => b.platforms.includes(PF) - a.platforms.includes(PF)).forEach((u) => {
      const w = PF !== 'android' && (u.platforms.includes(PF) || !u.platforms.length);
      const d = document.createElement('div'); d.className = 'up' + (w ? '' : ' off');
      d.innerHTML = '<span class="pf"></span><span class="n"></span><span class="sz"></span>';
      d.querySelector('.pf').textContent = '[' + (u.platforms.map((p) => ({ win: 'WIN', mac: 'MAC', linux: 'LINUX', android: 'ANDROID' }[p])).join('/') || '?') + ']';
      d.querySelector('.n').textContent = u.name; d.querySelector('.n').title = u.name; d.querySelector('.sz').textContent = u.size;
      if (w) {
        const i = document.createElement('button'); i.className = 'btn sm'; i.textContent = '⬇ ดาวน์โหลด'; i.onclick = () => run(u, false); d.appendChild(i);
        const t = document.createElement('button'); t.className = 'btn sm ghost'; t.textContent = '▶ เล่นเลย (ไม่เก็บไฟล์)'; t.onclick = () => run(u, true); d.appendChild(t);
      }
      if (PF === 'android' && u.platforms.includes('android')) { const i = document.createElement('button'); i.className = 'btn sm'; i.textContent = '⬇ เปิดหน้าโหลด APK'; i.onclick = () => pen.ext(g.url); d.appendChild(i); }
      ups.appendChild(d);
    });
    if (PF !== 'win' && !r.uploads.some((u) => u.platforms.includes(PF)) && !r.html5 && !ins) { const n = document.createElement('div'); n.className = 'dim'; n.style.padding = '6px 0'; n.textContent = PF === 'android' ? 'เล่นในแอปได้เฉพาะเกมเว็บ (HTML5) — เกมนี้ไม่ใช่เกมเว็บ' : 'เกมนี้ไม่มีไฟล์ Linux (มีเฉพาะ Windows/Mac)'; ups.appendChild(n); }
  } else if (!r.html5 && !ins) $('#dl').textContent = 'ไม่พบไฟล์ดาวน์โหลดฟรีบนหน้านี้ (อาจเป็นเกมที่ต้องซื้อ) — กด "เปิดหน้าเว็บ" เพื่อดูในเบราว์เซอร์';
  acts(r);
}
$('#modal').onclick = (e) => { if (e.target.id === 'modal') { st.cur = null; e.target.style.display = 'none'; } };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal').style.display === 'flex' && $('#dlg').style.display !== 'flex') { st.cur = null; $('#modal').style.display = 'none'; } });

// ---------- search / actions ----------
function search() {
  const q = $('#q').value.trim();
  if (q.startsWith('#')) { st.tag = slug(q.slice(1)); st.q = ''; } else { st.q = q; st.tag = ''; }
  markTag();
  if (st.view === 'lib') lib(); else store(true);
}
$('#go').onclick = search;
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
$('#sort').onchange = $('#flt').onchange = () => { if (st.view === 'store') store(true); };
$('#url').onclick = async () => {
  const u = await dialog({ title: 'เพิ่มลิงก์เกม', text: 'วางลิงก์เกม เช่น https://xxx.itch.io/ชื่อเกม', input: 'https://...', ok: 'เพิ่ม' });
  if (!u) return;
  try { new URL(/^https?:/i.test(u) ? u : 'https://' + u); } catch { return toast('ลิงก์ไม่ถูกต้อง'); }
  status('กำลังเพิ่ม...'); const r = await pen.addUrl(u); status('พร้อม'); setNav('lib'); await lib(); detail(r.game);
};
window.addEventListener('error', (e) => status('JS ERROR: ' + e.message));
window.addEventListener('unhandledrejection', (e) => { status('ERROR: ' + (e.reason && e.reason.message || e.reason)); st.loading = false; });
// เมื่อโหลดสำเร็จครั้งแรกค่อยโฟกัสช่องค้นหา
store(true); setTimeout(() => $('#q').focus(), 300);

// TikTok LIVE -> Browser Source bridge (chat + gift + follow) via Server-Sent Events
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as TT from 'tiktok-live-connector';

const { TikTokLiveConnection, WebcastEvent: E } = TT;
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const rooms = new Map(); // username -> { clients:Set, conn, retry, demo, closed }

const emit = (room, type, d) => {
  const m = `data: ${JSON.stringify({ type, ...d })}\n\n`;
  room.clients.forEach(r => r.write(m));
};

const who = d => {
  const x = d.user || d;
  return {
    name: x.nickname || x.uniqueId || '?',
    id: x.uniqueId || '',
    avatar: x.profilePicture?.url?.[0] || x.profilePictureUrl || x.avatarThumb?.urlList?.[0] || ''
  };
};

const giftOf = d => {
  const g = d.giftDetails || {};
  const n = d.repeatCount || 1;
  return {
    ...who(d),
    gift: d.giftName || g.giftName || 'Gift',
    count: n,
    diamonds: (d.diamondCount || g.diamondCount || 0) * n,
    img: d.giftPictureUrl || g.giftImage?.urlList?.[0] || g.giftImage?.url_list?.[0] || g.giftImage?.imageUrl || ''
  };
};

function start(user, room) {
  if (user === 'demo') return demo(room);
  const attempt = async () => {
    if (room.closed) return;
    const conn = new TikTokLiveConnection(user);
    room.conn = conn;
    const again = () => { clearTimeout(room.retry); if (!room.closed) room.retry = setTimeout(attempt, 15000); };
    conn.on(E.CHAT, d => emit(room, 'chat', { ...who(d), text: d.comment }));
    conn.on(E.GIFT, d => {
      if (d.giftType === 1 && !d.repeatEnd) return; // streak still running: wait for the final event
      emit(room, 'gift', giftOf(d));
    });
    if (E.FOLLOW) conn.on(E.FOLLOW, d => emit(room, 'follow', who(d)));
    const dc = TT.ControlEvent?.DISCONNECTED;
    if (dc) conn.on(dc, again);
    try {
      await conn.connect();
      console.log(`[${user}] connected`);
      emit(room, 'status', { ok: true });
    } catch (e) {
      console.log(`[${user}] cannot connect (${e?.message || e}) - retry in 15s`);
      emit(room, 'status', { ok: false });
      again();
    }
  };
  attempt();
}

function demo(room) {
  const names = ['น้องมะนาว', 'Pim', 'ลุงตู่', 'Ploy', 'Max'];
  const texts = ['สวัสดีค่ะ', 'วันนี้เล่นอะไรคะ', '555555', 'ไลฟ์สนุกมาก!', 'กดติดตามแล้วนะ'];
  const gifts = [['Rose', 1], ['Finger Heart', 5], ['Galaxy', 1000]];
  const r = a => a[Math.floor(Math.random() * a.length)];
  let t = 0;
  room.demo = setInterval(() => {
    t++;
    const u = { name: r(names), id: 'demo', avatar: '' };
    emit(room, 'chat', { ...u, text: r(texts) });
    if (t % 4 === 0) { const [gift, dm] = r(gifts); emit(room, 'gift', { ...u, gift, count: 1 + (t % 3), diamonds: dm, img: '' }); }
    if (t % 7 === 0) emit(room, 'follow', u);
  }, 2000);
}

function leave(user, room, res) {
  room.clients.delete(res);
  if (room.clients.size) return;
  setTimeout(() => {
    if (room.clients.size) return;
    room.closed = true;
    clearTimeout(room.retry);
    clearInterval(room.demo);
    try { room.conn?.disconnect(); } catch {}
    rooms.delete(user);
    console.log(`[${user}] closed`);
  }, 30000);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/events') {
    const user = (url.searchParams.get('user') || '').replace(/^@/, '').trim().toLowerCase();
    if (!user) { res.writeHead(400).end('missing ?user='); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': ok\n\n');
    let room = rooms.get(user);
    if (!room || room.closed) { room = { clients: new Set() }; rooms.set(user, room); start(user, room); }
    room.clients.add(res);
    const hb = setInterval(() => res.write(': hb\n\n'), 20000);
    req.on('close', () => { clearInterval(hb); leave(user, room, res); });
    return;
  }
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.join(dir, rel);
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Widgets ready: http://localhost:${PORT}`));

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 20000,
  pingInterval: 8000,
  perMessageDeflate: false,
  maxHttpBufferSize: 1e7,
  transports: ['polling', 'websocket'],
});

// COEP only on HTML pages — never on socket/API (causes HTTP 400)
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  }
  next();
});

// Prevent browser caching HTML files — always serve fresh
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ── Extension → core map ──────────────────────────────────────────────────────
const EXT_CORE = {
  '.nes':'nes','.fds':'nes','.unf':'nes','.unif':'nes',
  '.smc':'snes','.sfc':'snes','.fig':'snes','.swc':'snes',
  '.gb':'gb','.gbc':'gb','.sgb':'gb',
  '.gba':'gba','.agb':'gba',
  '.z64':'n64','.n64':'n64','.v64':'n64',
  '.nds':'nds',
  '.gen':'segaMD','.md':'segaMD','.smd':'segaMD','.bin':'segaMD',
  '.sms':'segaMS','.gg':'segaGG','.32x':'sega32x',
  '.pbp':'psx','.cue':'psx','.chd':'psx','.iso':'psx','.img':'psx','.m3u':'psx',
  '.cso':'psp',
  '.a26':'atari2600','.a52':'a5200','.a78':'atari7800',
  '.lnx':'lynx','.j64':'jaguar',
  '.pce':'pce','.sgx':'pce',
  '.ngp':'ngp','.ngc':'ngp',
  '.ws':'ws','.wsc':'ws',
  '.zip':'arcade','.7z':'arcade',
  '.d64':'vice_x64sc','.t64':'vice_x64sc','.prg':'vice_x64sc',
  '.adf':'amiga','.dosz':'dos','.exe':'dos',
  '.jar':'j2me','.jad':'j2me',
  '.col':'coleco','.vb':'vb',
};

const SYSTEM_LABEL = {
  nes:'NES',snes:'Super Nintendo',gb:'Game Boy',gba:'Game Boy Advance',
  n64:'Nintendo 64',nds:'Nintendo DS',segaMD:'Sega Mega Drive',
  segaMS:'Sega Master System',segaGG:'Game Gear',sega32x:'Sega 32X',
  psx:'PlayStation',psp:'PSP',atari2600:'Atari 2600',a5200:'Atari 5200',
  atari7800:'Atari 7800',lynx:'Atari Lynx',jaguar:'Atari Jaguar',
  pce:'PC Engine',ngp:'Neo Geo Pocket',ws:'WonderSwan',
  arcade:'Arcade',vice_x64sc:'Commodore 64',amiga:'Amiga',
  dos:'DOS',j2me:'J2ME',coleco:'ColecoVision',vb:'Virtual Boy',
};

// ── Games API ─────────────────────────────────────────────────────────────────
app.get('/api/games', (_req, res) => {
  const dir = path.join(__dirname, 'public', 'games');
  fs.readdir(dir, (err, files) => {
    if (err) return res.json([]);
    res.json(
      files.map(f => {
        const ext  = path.extname(f).toLowerCase();
        const core = EXT_CORE[ext];
        if (!core) return null;
        const name = path.basename(f, ext).replace(/[_\-\.]/g, ' ').trim();
        let size = 0; try { size = fs.statSync(path.join(dir,f)).size; } catch(_) {}
        return { filename: f, name, core, system: SYSTEM_LABEL[core] || core, size };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
    );
  });
});

// ── Upload ROM — manual multipart parsing, no extra deps ─────────────────────
app.post('/api/upload', (req, res) => {
  const ct = req.headers['content-type'] || '';
  const boundary = ct.split('boundary=')[1];
  if (!boundary) return res.status(400).json({ error: 'No boundary' });

  const chunks = [];
  req.on('data', d => chunks.push(d));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const sep  = '--' + boundary;
    const parts = body.toString('binary').split(sep);
    const saved = [];

    for (const part of parts) {
      if (!part || part === '--' || part === '--\r\n') continue;
      const split = part.indexOf('\r\n\r\n');
      if (split === -1) continue;
      const header = part.slice(0, split);
      const cdMatch = header.match(/Content-Disposition:[^\r]*filename="([^"]+)"/i);
      if (!cdMatch) continue;
      const filename = path.basename(cdMatch[1]);
      const ext = path.extname(filename).toLowerCase();
      if (!EXT_CORE[ext]) continue;
      // data starts after \r\n\r\n and ends before trailing \r\n
      const dataStr = part.slice(split + 4, part.endsWith('\r\n') ? -2 : undefined);
      const buf = Buffer.from(dataStr, 'binary');
      const dest = path.join(__dirname, 'public', 'games', filename);
      fs.writeFileSync(dest, buf);
      saved.push(filename);
    }

    if (!saved.length) return res.status(400).json({ error: 'No valid ROM files' });
    console.log('[upload]', saved.join(', '));
    res.json({ ok: true, files: saved });
  });
  req.on('error', e => res.status(500).json({ error: e.message }));
});

// ── Delete game from server library ──────────────────────────────────────────
app.post('/api/games/delete', express.json(), (req, res) => {
  const { filename } = req.body || {};
  if (!filename) return res.status(400).json({ error: 'Missing filename' });
  const safe = path.basename(filename);
  const filePath = path.join(__dirname, 'public', 'games', safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    fs.unlinkSync(filePath);
    console.log('[delete]', safe);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Shop API ──────────────────────────────────────────────────────────────────
const https = require('https');

const SYS_EXTS = {
  segaMD:['.gen','.md','.smd','.bin'],nes:['.nes','.fds'],snes:['.smc','.sfc','.fig'],
  gb:['.gb','.gbc'],gba:['.gba'],n64:['.z64','.n64','.v64'],nds:['.nds'],
  psx:['.pbp','.chd','.cue','.iso'],psp:['.cso','.iso'],
  segaMS:['.sms'],segaGG:['.gg'],arcade:['.zip'],
};

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'RetroHub/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

app.get('/api/shop/search', async (req, res) => {
  const query  = (req.query.q || '').trim();
  const system = (req.query.system || '').trim();
  if (!query && !system) return res.status(400).json({ error: 'No query' });
  try {
    const exts = system && SYS_EXTS[system] ? SYS_EXTS[system] : Object.values(SYS_EXTS).flat();
    const extFilter = exts.map(e => `format:"${e.slice(1).toUpperCase()}"`).join(' OR ');
    let q = `mediatype:software (${extFilter})`;
    if (query) q += ` AND title:(${query})`;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier,title&rows=40&output=json&sort[]=downloads+desc`;
    const { body } = await httpsGet(url);
    const items = (JSON.parse(body).response?.docs || []).slice(0, 15);
    if (!items.length) return res.json({ results: [] });
    const results = [];
    await Promise.all(items.map(async item => {
      try {
        const { body: mb } = await httpsGet(`https://archive.org/metadata/${item.identifier}/files`);
        (JSON.parse(mb).result || []).forEach(f => {
          const ext = path.extname(f.name || '').toLowerCase();
          if (!exts.includes(ext) || f.size > 2e9) return;
          if (query && !f.name.toLowerCase().includes(query.toLowerCase()) &&
              !item.title?.toLowerCase().includes(query.toLowerCase())) return;
          results.push({ identifier: item.identifier, filename: f.name,
            title: f.name.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ').trim() || item.title,
            ext, size: parseInt(f.size) || 0 });
        });
      } catch(_) {}
    }));
    results.sort((a, b) => (a.size || 0) - (b.size || 0));
    res.json({ results: results.slice(0, 60) });
  } catch(e) {
    console.error('[shop search]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/shop/download', express.json(), async (req, res) => {
  const { identifier, filename } = req.body || {};
  if (!identifier || !filename) return res.status(400).json({ error: 'Missing params' });
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._\-\(\)\[\] ]/g, '_');
  const ext = path.extname(safeName).toLowerCase();
  if (!EXT_CORE[ext]) return res.status(400).json({ error: 'Unsupported file type' });
  const destPath = path.join(__dirname, 'public', 'games', safeName);
  if (fs.existsSync(destPath)) {
    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify({ progress: 100, done: true, filename: safeName }) + '\n');
    return res.end();
  }
  const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');
  const tmpPath = destPath + '.tmp';
  try {
    await new Promise((resolve, reject) => {
      const doGet = (getUrl) => {
        https.get(getUrl, { headers: { 'User-Agent': 'RetroHub/1.0' } }, dlRes => {
          if (dlRes.statusCode >= 300 && dlRes.statusCode < 400 && dlRes.headers.location) {
            dlRes.resume(); return doGet(dlRes.headers.location);
          }
          if (dlRes.statusCode !== 200) { dlRes.resume(); return reject(new Error('HTTP ' + dlRes.statusCode)); }
          const total = parseInt(dlRes.headers['content-length']) || 0;
          let received = 0, lastPct = -1;
          const out = fs.createWriteStream(tmpPath);
          dlRes.on('data', chunk => {
            received += chunk.length;
            if (total > 0) {
              const pct = Math.floor((received / total) * 100);
              if (pct !== lastPct) { lastPct = pct; res.write(JSON.stringify({ progress: pct }) + '\n'); }
            }
          });
          dlRes.pipe(out);
          out.on('finish', () => { fs.renameSync(tmpPath, destPath); res.write(JSON.stringify({ done: true, filename: safeName }) + '\n'); resolve(); });
          out.on('error', reject); dlRes.on('error', reject);
        }).on('error', reject);
      };
      doGet(url);
    });
    res.end();
  } catch(e) {
    console.error('[shop download]', e.message);
    try { fs.unlinkSync(tmpPath); } catch(_) {}
    if (!res.writableEnded) { res.write(JSON.stringify({ error: e.message }) + '\n'); res.end(); }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROOMS — full state machine with session recovery
//
// Room lifecycle:
//   created      → screen registers
//   active       → at least P1 connected
//   screen_away  → screen disconnected, recovery window open (30s)
//   closed       → expired or screen explicitly closed
//
// Controller lifecycle per slot:
//   connected    → slot.connected = true
//   away         → slot.connected = false, slot held for 60s
//   left         → slot removed permanently
// ═══════════════════════════════════════════════════════════════════════════════
const rooms      = {};   // code → room
const expTimers  = {};   // code → timeout handle (room expiry)
const slotTimers = {};   // `${code}:${pid}` → timeout handle (slot expiry)

function makeCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms[c]);
  return c;
}

function publicState(room) {
  return {
    roomCode:      room.code,
    gameActive:    room.gameActive,
    lastSelection: room.lastSelection,
    players:       room.players.map(p => ({ playerId: p.playerId, connected: p.connected })),
  };
}

function scheduleRoomExpiry(code, ms) {
  clearTimeout(expTimers[code]);
  expTimers[code] = setTimeout(() => {
    if (!rooms[code]) return;
    delete rooms[code];
    delete expTimers[code];
    console.log(`[room] ${code} expired`);
  }, ms);
}

function scheduleSlotExpiry(code, pid, ms) {
  const key = `${code}:${pid}`;
  clearTimeout(slotTimers[key]);
  slotTimers[key] = setTimeout(() => {
    const room = rooms[code];
    if (!room) return;
    const slot = room.players.find(p => p.playerId === pid);
    if (slot && !slot.connected) {
      room.players = room.players.filter(p => p.playerId !== pid);
      delete slotTimers[key];
      // Notify screen that the slot is now permanently gone
      if (room.screenConnected) {
        io.to(room.screenId).emit('controller:disconnected', { playerId: pid, permanent: true });
      }
      console.log(`[ctrl] P${pid} slot expired in ${code}`);
    }
  }, ms);
}

io.on('connection', socket => {

  // ── TV registers (fresh or reclaim after reload) ─────────────────────────
  socket.on('screen:register', ({ existingCode } = {}) => {
    const code = (existingCode || '').toUpperCase().trim();
    const existing = code ? rooms[code] : null;

    if (existing && !existing.screenConnected) {
      // Reclaim — screen reloaded / reconnected
      clearTimeout(expTimers[code]);
      existing.screenId        = socket.id;
      existing.screenConnected = true;
      socket.roomCode = code;
      socket.role     = 'screen';
      socket.join(code);
      socket.emit('screen:registered', { roomCode: code, reconnected: true, state: publicState(existing) });
      // Tell any waiting controllers the screen is back
      existing.players.forEach(p => {
        if (p.connected) io.to(p.socketId).emit('screen:reconnected');
      });
      console.log(`[screen] reclaimed ${code}`);
    } else {
      // Fresh room
      const newCode = makeCode();
      rooms[newCode] = {
        code:            newCode,
        screenId:        socket.id,
        screenConnected: true,
        players:         [],
        gameActive:      false,
        lastSelection:   null,
      };
      socket.roomCode = newCode;
      socket.role     = 'screen';
      socket.join(newCode);
      socket.emit('screen:registered', { roomCode: newCode, reconnected: false });
      console.log(`[screen] new room ${newCode}`);
    }
  });

  // ── Controller joins or reclaims slot ────────────────────────────────────
  socket.on('controller:join', ({ roomCode, existingPlayerId } = {}) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room) return socket.emit('room:error', { message: 'Room not found. Check the code on screen.' });

    const pid = parseInt(existingPlayerId) || 0;

    // Clean stale slots — connected=true but socket actually dead
    room.players.forEach(p => {
      if (p.connected && !io.sockets.sockets.get(p.socketId)) {
        p.connected = false;
        console.log(`[ctrl] cleaned stale slot P${p.playerId} in ${code}`);
      }
    });

    // Try to reclaim a disconnected slot (same player ID)
    if (pid) {
      const slot = room.players.find(p => p.playerId === pid && !p.connected);
      if (slot) {
        clearTimeout(slotTimers[`${code}:${pid}`]);
        slot.socketId  = socket.id;
        slot.connected = true;
        socket.roomCode  = code;
        socket.playerId  = pid;
        socket.role      = 'controller';
        socket.join(code);
        socket.emit('room:joined', { playerId: pid, roomCode: code, reconnected: true, state: publicState(room) });
        if (room.screenConnected) io.to(room.screenId).emit('controller:connected', { playerId: pid, reconnected: true });
        if (room.gameActive) socket.emit('game:started', room.lastSelection);
        console.log(`[ctrl] P${pid} reclaimed slot in ${code}`);
        return;
      }
    }

    // New slot — count only truly live connections
    const connected = room.players.filter(p => p.connected && io.sockets.sockets.get(p.socketId)).length;
    if (connected >= 2) return socket.emit('room:error', { message: 'Room is full (2 players max).' });

    // Assign lowest available player ID
    const usedIds = room.players.map(p => p.playerId);
    const newPid  = [1, 2].find(n => !usedIds.includes(n));
    if (!newPid) return socket.emit('room:error', { message: 'Room is full.' });

    room.players.push({ socketId: socket.id, playerId: newPid, connected: true });
    socket.roomCode  = code;
    socket.playerId  = newPid;
    socket.role      = 'controller';
    socket.join(code);

    socket.emit('room:joined', { playerId: newPid, roomCode: code, reconnected: false, state: publicState(room) });
    if (room.screenConnected) io.to(room.screenId).emit('controller:connected', { playerId: newPid });
    if (room.lastSelection) socket.emit('hub:selection', room.lastSelection);
    if (room.gameActive)    socket.emit('game:started',  room.lastSelection);
    console.log(`[ctrl] P${newPid} joined ${code}`);
  });

  // ── Screen broadcasts game selection ─────────────────────────────────────
  socket.on('hub:selection', data => {
    if (socket.role !== 'screen') return;
    const room = rooms[socket.roomCode]; if (!room) return;
    room.lastSelection = data;
    room.players.forEach(p => { if (p.connected) io.to(p.socketId).emit('hub:selection', data); });
  });

  // ── Controller → screen: navigate library ────────────────────────────────
  socket.on('nav:prev',  () => relay('nav:prev'));
  socket.on('nav:next',  () => relay('nav:next'));
  socket.on('open:shop', () => relay('open:shop'));

  // ── Controller (P1) → all: start game ────────────────────────────────────
  socket.on('nav:start', () => {
    if (socket.role !== 'controller' || socket.playerId !== 1) return;
    const room = rooms[socket.roomCode]; if (!room) return;
    room.gameActive = true;
    io.to(room.screenId).emit('nav:start');
    room.players.forEach(p => { if (p.connected) io.to(p.socketId).emit('game:started', room.lastSelection); });
  });

  // ── Controller → screen: game input ──────────────────────────────────────
  socket.on('game:input', data => {
    if (socket.role !== 'controller') return;
    const room = rooms[socket.roomCode]; if (!room) return;
    // volatile: stale inputs are dropped instead of queuing — eliminates lag buildup
    io.to(room.screenId).volatile.emit('game:input', { ...data, playerId: socket.playerId });
  });

  // ── Any controller → all: stop game ──────────────────────────────────────
  socket.on('game:stop', () => {
    if (socket.role !== 'controller') return;
    const room = rooms[socket.roomCode]; if (!room) return;
    room.gameActive = false;
    io.to(socket.roomCode).emit('game:stop');
  });

  // ── Screen → all: stop game (TV exit button) ─────────────────────────────
  socket.on('screen:stop_game', () => {
    if (socket.role !== 'screen') return;
    const room = rooms[socket.roomCode]; if (!room) return;
    room.gameActive = false;
    io.to(socket.roomCode).emit('game:stop');
  });

  // ── Controller intentionally leaves session ──────────────────────────────
  socket.on('controller:leave', () => {
    const code = socket.roomCode;
    const room = rooms[code]; if (!room) return;
    const pid = socket.playerId;
    room.players = room.players.filter(p => p.socketId !== socket.id);
    clearTimeout(slotTimers[`${code}:${pid}`]);
    socket.leave(code);
    socket.roomCode = null; socket.playerId = null; socket.role = null;
    socket.emit('room:left');
    if (room.screenConnected) io.to(room.screenId).emit('controller:disconnected', { playerId: pid, permanent: true });
    console.log(`[ctrl] P${pid} left ${code} intentionally`);
  });

  // ── Screen intentionally closes the session ──────────────────────────────
  socket.on('screen:close', () => {
    const code = socket.roomCode;
    const room = rooms[code]; if (!room) return;
    // Notify all controllers session ended
    io.to(code).emit('session:ended', { reason: 'host_closed' });
    delete rooms[code];
    clearTimeout(expTimers[code]);
    room.players.forEach(p => clearTimeout(slotTimers[`${code}:${p.playerId}`]));
    console.log(`[screen] ${code} closed intentionally`);
  });

  // ── Network disconnect (may reconnect) ───────────────────────────────────
  socket.on('disconnect', reason => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];

    if (socket.role === 'screen') {
      room.screenConnected = false;
      // Tell controllers the screen dropped — they show reconnecting overlay
      room.players.forEach(p => { if (p.connected) io.to(p.socketId).emit('screen:disconnected'); });
      // Hold room for 45s waiting for screen to come back
      scheduleRoomExpiry(code, 45000);
      console.log(`[screen] ${code} disconnected (${reason})`);

    } else if (socket.role === 'controller') {
      const slot = room.players.find(p => p.socketId === socket.id);
      if (slot) {
        slot.connected = false;
        // Notify screen controller went away (not permanent yet)
        if (room.screenConnected) {
          io.to(room.screenId).emit('controller:disconnected', { playerId: socket.playerId, permanent: false });
        }
        // Hold slot for 60s — phones commonly refresh or lose wifi briefly
        scheduleSlotExpiry(code, socket.playerId, 60000);
      }
      console.log(`[ctrl] P${socket.playerId} disconnected from ${code} (${reason})`);
    }
  });

  function relay(ev, data) {
    if (socket.role !== 'controller') return;
    const room = rooms[socket.roomCode]; if (!room) return;
    data !== undefined ? io.to(room.screenId).emit(ev, data) : io.to(room.screenId).emit(ev);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🕹  RetroHub`);
  console.log(`   TV    →  http://localhost:${PORT}/`);
  console.log(`   Phone →  http://localhost:${PORT}/remote.html\n`);
});
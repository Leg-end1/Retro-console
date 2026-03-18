const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 10000,
  pingInterval: 5000,
  perMessageDeflate: false,
  maxHttpBufferSize: 1e7,
  // Allow both transports — polling fallback ensures connection works everywhere
  // (pure websocket-only breaks on some proxies, Railway, and local setups)
  transports: ['polling', 'websocket'],
});

// COEP credentialless — required for SharedArrayBuffer (EJS WebAssembly)
// Only apply to HTML page responses — NOT to Socket.io or API routes
// Applying these to XHR/polling requests causes HTTP 400 on Socket.io handshake
app.use((req, res, next) => {
  const isPage = req.path === '/' || req.path.endsWith('.html');
  if (isPage) {
    res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Extension → EJS core map ──────────────────────────────────────────────────
const EXT_CORE = {
  // NES
  '.nes':'nes', '.fds':'nes', '.unf':'nes', '.unif':'nes',
  // SNES
  '.smc':'snes', '.sfc':'snes', '.fig':'snes', '.swc':'snes',
  // Game Boy
  '.gb':'gb', '.gbc':'gb', '.sgb':'gb',
  // GBA
  '.gba':'gba', '.agb':'gba',
  // N64
  '.z64':'n64', '.n64':'n64', '.v64':'n64',
  // NDS
  '.nds':'nds',
  // Mega Drive
  '.gen':'segaMD', '.md':'segaMD', '.smd':'segaMD', '.bin':'segaMD',
  // Master System
  '.sms':'segaMS',
  // Game Gear
  '.gg':'segaGG',
  // 32X
  '.32x':'sega32x',
  // PSX
  '.pbp':'psx', '.cue':'psx', '.chd':'psx', '.iso':'psx', '.img':'psx', '.m3u':'psx',
  // PSP
  '.cso':'psp',
  // Atari
  '.a26':'atari2600', '.a52':'a5200', '.a78':'atari7800',
  '.lnx':'lynx', '.j64':'jaguar',
  // PC Engine
  '.pce':'pce', '.sgx':'pce',
  // Neo Geo Pocket
  '.ngp':'ngp', '.ngc':'ngp',
  // WonderSwan
  '.ws':'ws', '.wsc':'ws',
  // Arcade
  '.zip':'arcade', '.7z':'arcade',
  // Commodore
  '.d64':'vice_x64sc', '.t64':'vice_x64sc', '.prg':'vice_x64sc',
  '.adf':'amiga',
  // DOS
  '.dosz':'dos', '.exe':'dos',
  // J2ME
  '.jar':'j2me', '.jad':'j2me',
  // ColecoVision
  '.col':'coleco',
  // Virtual Boy
  '.vb':'vb',
};

const SYSTEM_LABEL = {
  nes:'NES', snes:'Super Nintendo', gb:'Game Boy', gba:'Game Boy Advance',
  n64:'Nintendo 64', nds:'Nintendo DS', segaMD:'Sega Mega Drive',
  segaMS:'Sega Master System', segaGG:'Game Gear', sega32x:'Sega 32X',
  psx:'PlayStation', psp:'PSP', atari2600:'Atari 2600', a5200:'Atari 5200',
  atari7800:'Atari 7800', lynx:'Atari Lynx', jaguar:'Atari Jaguar',
  pce:'PC Engine', ngp:'Neo Geo Pocket', ws:'WonderSwan',
  arcade:'Arcade', vice_x64sc:'Commodore 64', amiga:'Amiga',
  dos:'DOS', j2me:'J2ME', coleco:'ColecoVision', vb:'Virtual Boy',
};

// ── Games API ─────────────────────────────────────────────────────────────────
app.get('/api/games', (_req, res) => {
  const dir = path.join(__dirname, 'public', 'games');
  fs.readdir(dir, (err, files) => {
    if (err) return res.json([]);
    const games = files
      .map(f => {
        const ext  = path.extname(f).toLowerCase();
        const core = EXT_CORE[ext];
        if (!core) return null;
        const name = path.basename(f, ext).replace(/[_\-\.]/g, ' ').trim();
        return { filename: f, name, core, system: SYSTEM_LABEL[core] || core };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(games);
  });
});


// ── Game Shop API ─────────────────────────────────────────────────────────────
const https = require('https');

const SYS_EXTS = {
  segaMD:['.gen','.md','.smd','.bin'], nes:['.nes','.fds'], snes:['.smc','.sfc','.fig'],
  gb:['.gb','.gbc'], gba:['.gba'], n64:['.z64','.n64','.v64'], nds:['.nds'],
  psx:['.pbp','.chd','.cue','.iso'], psp:['.cso','.iso'],
  segaMS:['.sms'], segaGG:['.gg'], arcade:['.zip'],
};

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'RetroHub/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
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
    const allowedExts = system && SYS_EXTS[system]
      ? SYS_EXTS[system]
      : Object.values(SYS_EXTS).flat();

    const extFilter = allowedExts.map(e => `format:"${e.slice(1).toUpperCase()}"`).join(' OR ');
    let q = `mediatype:software (${extFilter})`;
    if (query) q += ` AND title:(${query})`;

    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier,title&rows=40&output=json&sort[]=downloads+desc`;
    const { body } = await httpsGet(url);
    const json = JSON.parse(body);
    const items = (json.response?.docs || []).slice(0, 15);

    if (items.length === 0) return res.json({ results: [] });

    const results = [];
    await Promise.all(items.map(async item => {
      try {
        const { body: mb } = await httpsGet(`https://archive.org/metadata/${item.identifier}/files`);
        const files = (JSON.parse(mb).result || []);
        files.forEach(f => {
          const ext = path.extname(f.name || '').toLowerCase();
          if (!allowedExts.includes(ext)) return;
          if (f.size > 2e9) return;
          if (query && !f.name.toLowerCase().includes(query.toLowerCase()) &&
              !item.title?.toLowerCase().includes(query.toLowerCase())) return;
          results.push({
            identifier: item.identifier,
            filename: f.name,
            title: f.name.replace(/\.[^.]+$/, '').replace(/[_\-]/g, ' ').trim() || item.title,
            ext, size: parseInt(f.size) || 0,
          });
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
          if (dlRes.statusCode !== 200) {
            dlRes.resume(); return reject(new Error('HTTP ' + dlRes.statusCode));
          }
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
          out.on('finish', () => {
            fs.renameSync(tmpPath, destPath);
            res.write(JSON.stringify({ done: true, filename: safeName }) + '\n');
            resolve();
          });
          out.on('error', reject);
          dlRes.on('error', reject);
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

// ── Rooms ─────────────────────────────────────────────────────────────────────
const rooms = {};

function makeCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (rooms[c]);
  return c;
}

io.on('connection', socket => {

  // ── TV screen registers ───────────────────────────────────────────────────
  socket.on('screen:register', () => {
    const code = makeCode();
    rooms[code] = {
      screenId:      socket.id,
      players:       [],   // [{socketId, playerId}]
      gameActive:    false,
      lastSelection: null,
    };
    socket.roomCode = code;
    socket.role     = 'screen';
    socket.join(code);
    socket.emit('screen:registered', { roomCode: code });
    console.log(`[screen] room ${code}`);
  });

  // ── Phone controller joins ────────────────────────────────────────────────
  socket.on('controller:join', ({ roomCode }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room)                    return socket.emit('room:error', { message: 'Room not found.' });
    if (room.players.length >= 2) return socket.emit('room:error', { message: 'Room is full.' });

    const pid = room.players.length + 1;  // 1 or 2
    room.players.push({ socketId: socket.id, playerId: pid });
    socket.roomCode  = code;
    socket.playerId  = pid;
    socket.role      = 'controller';
    socket.join(code);

    socket.emit('room:joined', { playerId: pid, roomCode: code });
    io.to(room.screenId).emit('controller:connected', { playerId: pid });

    // Catch up late joiners
    if (room.lastSelection) socket.emit('hub:selection', room.lastSelection);
    if (room.gameActive)    socket.emit('game:started', room.lastSelection);

    console.log(`[ctrl] P${pid} joined ${code}`);
  });

  // ── Screen → controllers: current selection ───────────────────────────────
  socket.on('hub:selection', data => {
    if (socket.role !== 'screen') return;
    const room = rooms[socket.roomCode];
    if (!room) return;
    room.lastSelection = data;
    room.players.forEach(p => io.to(p.socketId).emit('hub:selection', data));
  });

  // ── Controller → screen: navigation ──────────────────────────────────────
  socket.on('nav:prev',  () => relayToScreen('nav:prev'));
  socket.on('nav:next',  () => relayToScreen('nav:next'));

  // ── Controller → screen: start game ──────────────────────────────────────
  socket.on('nav:start', () => {
    if (socket.role !== 'controller' || socket.playerId !== 1) return;
    const room = rooms[socket.roomCode];
    if (!room) return;
    room.gameActive = true;
    // Tell the screen
    io.to(room.screenId).emit('nav:start');
    // Tell every controller (so all phones switch to pad view)
    room.players.forEach(p => io.to(p.socketId).emit('game:started', room.lastSelection));
  });

  // ── Controller → screen: button input ────────────────────────────────────
  socket.on('game:input', data => {
    if (socket.role !== 'controller') return;
    const room = rooms[socket.roomCode];
    if (!room) return;
    const payload = { ...data, playerId: socket.playerId };
    // setImmediate: P1/P2 input bursts don't block each other on the event loop
    setImmediate(() => io.to(room.screenId).emit('game:input', payload));
  });

  // ── Controller → everyone: stop game ─────────────────────────────────────
  socket.on('game:stop', () => {
    if (socket.role !== 'controller') return;
    const room = rooms[socket.roomCode];
    if (!room) return;
    room.gameActive = false;
    io.to(socket.roomCode).emit('game:stop');
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (socket.role === 'screen') {
      io.to(code).emit('room:error', { message: 'TV disconnected.' });
      delete rooms[code];
    } else if (socket.role === 'controller') {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      io.to(room.screenId).emit('controller:disconnected', { playerId: socket.playerId });
      console.log(`[ctrl] P${socket.playerId} left ${code}`);
    }
  });

  function relayToScreen(ev, data) {
    if (socket.role !== 'controller') return;
    const room = rooms[socket.roomCode];
    if (!room) return;
    data !== undefined
      ? io.to(room.screenId).emit(ev, data)
      : io.to(room.screenId).emit(ev);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🕹  RetroHub running`);
  console.log(`   TV      →  http://localhost:${PORT}/`);
  console.log(`   Phone   →  http://localhost:${PORT}/remote.html\n`);
});
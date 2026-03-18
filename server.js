const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const fs   = require('fs');
const path = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// COEP: 'credentialless' NOT 'require-corp' — lets CDN EmulatorJS assets load
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETE EmulatorJS core → extension map
// Sources: emulatorjs.org/docs/systems  +  emulatorjs.com/core/*.html
// Core strings match EJS_core values exactly.
// Ambiguous extensions (.bin, .iso, .cue, .chd, .zip, .img) are mapped to
// the most common consumer system; users can rename with a system prefix
// e.g. "game.psx.chd" to force a specific core (handled below).
// ═══════════════════════════════════════════════════════════════════════════════
const CORE_MAP = {

  // ── Nintendo Entertainment System / Famicom ───────────────────────────────
  '.nes':  'nes',
  '.fds':  'nes',   // Famicom Disk System
  '.unf':  'nes',
  '.unif': 'nes',
  '.qd':   'nes',   // FDS quick-disk

  // ── Super Nintendo / Super Famicom ────────────────────────────────────────
  '.smc':  'snes',
  '.sfc':  'snes',
  '.fig':  'snes',
  '.gd3':  'snes',
  '.gd7':  'snes',
  '.dx2':  'snes',
  '.bsx':  'snes',
  '.swc':  'snes',

  // ── Game Boy / Game Boy Color ─────────────────────────────────────────────
  '.gb':   'gb',
  '.gbc':  'gb',
  '.sgb':  'gb',    // Super Game Boy

  // ── Game Boy Advance ──────────────────────────────────────────────────────
  '.gba':  'gba',
  '.agb':  'gba',
  '.gbz':  'gba',

  // ── Virtual Boy ───────────────────────────────────────────────────────────
  '.vb':   'vb',
  '.vboy': 'vb',

  // ── Nintendo DS ───────────────────────────────────────────────────────────
  '.nds':  'nds',
  '.dsi':  'nds',

  // ── Nintendo 64 ───────────────────────────────────────────────────────────
  '.z64':  'n64',
  '.n64':  'n64',
  '.v64':  'n64',

  // ── PlayStation ───────────────────────────────────────────────────────────
  '.pbp':  'psx',
  '.toc':  'psx',
  '.cbn':  'psx',
  '.m3u':  'psx',   // multi-disc playlist
  '.mdf':  'psx',
  '.img':  'psx',

  // ── PlayStation Portable ──────────────────────────────────────────────────
  '.cso':  'psp',

  // ── Sega Mega Drive / Genesis ─────────────────────────────────────────────
  '.gen':  'segaMD',
  '.md':   'segaMD',
  '.smd':  'segaMD',
  '.68k':  'segaMD',

  // ── Sega Master System ────────────────────────────────────────────────────
  '.sms':  'segaMS',

  // ── Sega Game Gear ────────────────────────────────────────────────────────
  '.gg':   'segaGG',

  // ── Sega 32X ──────────────────────────────────────────────────────────────
  '.32x':  'sega32x',

  // ── Sega Saturn ───────────────────────────────────────────────────────────
  // .cue / .iso / .chd shared below in AMBIGUOUS section

  // ── Sega CD / Mega CD ─────────────────────────────────────────────────────
  // .cue / .iso / .chd shared below

  // ── 3DO ───────────────────────────────────────────────────────────────────
  // .bin / .cue / .iso / .chd shared below

  // ── Atari 2600 ────────────────────────────────────────────────────────────
  '.a26':  'atari2600',

  // ── Atari 5200 ────────────────────────────────────────────────────────────
  '.a52':  'a5200',

  // ── Atari 7800 ────────────────────────────────────────────────────────────
  '.a78':  'atari7800',

  // ── Atari Jaguar ──────────────────────────────────────────────────────────
  '.j64':  'jaguar',
  '.jag':  'jaguar',
  '.abs':  'jaguar',
  '.cof':  'jaguar',
  '.rom':  'jaguar',

  // ── Atari Lynx ────────────────────────────────────────────────────────────
  '.lnx':  'lynx',
  '.lyx':  'lynx',

  // ── PC Engine / TurboGrafx-16 / SuperGrafx ────────────────────────────────
  '.pce':  'pce',
  '.sgx':  'pce',   // SuperGrafx

  // ── PC-FX ─────────────────────────────────────────────────────────────────
  '.pcf':  'pcfx',
  '.pcfx': 'pcfx',

  // ── Neo Geo Pocket / Color ────────────────────────────────────────────────
  '.ngp':  'ngp',
  '.ngc':  'ngp',
  '.npc':  'ngp',

  // ── WonderSwan / WonderSwan Color ─────────────────────────────────────────
  '.ws':   'ws',
  '.wsc':  'ws',
  '.pc2':  'ws',

  // ── ColecoVision ──────────────────────────────────────────────────────────
  '.col':  'coleco',
  '.cv':   'coleco',

  // ── Commodore 64 ──────────────────────────────────────────────────────────
  '.d64':  'vice_x64sc',
  '.t64':  'vice_x64sc',
  '.d71':  'vice_x64sc',
  '.d80':  'vice_x64sc',
  '.d82':  'vice_x64sc',
  '.d81':  'vice_x64sc',
  '.g64':  'vice_x64sc',
  '.p64':  'vice_x64sc',
  '.x64':  'vice_x64sc',
  '.tap':  'vice_x64sc',
  '.prg':  'vice_x64sc',
  '.p00':  'vice_x64sc',

  // ── Commodore 128 ─────────────────────────────────────────────────────────
  // shares most .d64/.t64 etc — handled by separate naming convention
  // Users rename .c128.d64 to pick this core (see system-prefix logic below)

  // ── Commodore VIC-20 ──────────────────────────────────────────────────────
  '.20':   'vice_xvic',

  // ── Commodore Amiga ───────────────────────────────────────────────────────
  '.adf':  'amiga',
  '.adz':  'amiga',
  '.dms':  'amiga',
  '.fdi':  'amiga',
  '.ipf':  'amiga',
  '.hdf':  'amiga',
  '.hdz':  'amiga',
  '.lha':  'amiga',
  '.lzx':  'amiga',
  '.slave':'amiga',
  '.info': 'amiga',

  // ── Commodore PET ─────────────────────────────────────────────────────────
  '.pet':  'vice_xpet',

  // ── Commodore Plus/4 ──────────────────────────────────────────────────────
  '.d4m':  'vice_xplus4',

  // ── DOS (DOSBox Pure) ─────────────────────────────────────────────────────
  '.dosz': 'dos',
  '.exe':  'dos',
  '.com':  'dos',
  '.bat':  'dos',
  '.conf': 'dos',

  // ── Arcade (FBNeo / MAME) ─────────────────────────────────────────────────
  // .zip is the primary arcade format
  // NOTE: .zip also used by other systems — see AMBIGUOUS section

  // ── J2ME Mobile ──────────────────────────────────────────────────────────
  '.jar':  'j2me',
  '.jad':  'j2me',
};

// ── AMBIGUOUS EXTENSIONS ─────────────────────────────────────────────────────
// These extensions are shared by multiple systems. We detect intent from
// system-prefix in filename: "game.psx.chd", "game.3do.bin", "game.segaCD.cue"
// Fallback (no prefix): map to most common system.
const AMBIGUOUS = {
  '.bin':  'segaMD',   // also 3do, psx, segaCD, segaSaturn, atari2600
  '.cue':  'psx',      // also segaCD, segaSaturn, 3do
  '.chd':  'psx',      // also segaCD, segaSaturn, 3do
  '.iso':  'psx',      // also segaCD, segaSaturn, 3do
  '.ccd':  'psx',      // also segaCD
  '.zip':  'arcade',   // also used for many systems
  '.7z':   'arcade',   // archive format for arcade ROMs
  '.car':  'a5200',    // also atari800
};

// System-prefix → core override (e.g. "Crash Bandicoot.psx.chd" → core='psx')
const PREFIX_CORE = {
  'psx': 'psx', 'ps1': 'psx', 'playstation': 'psx',
  'psp': 'psp',
  '3do': '3do',
  'segacd': 'segaCD', 'megacd': 'segaCD', 'scd': 'segaCD',
  'segasaturn': 'segaSaturn', 'saturn': 'segaSaturn',
  'segamd': 'segaMD', 'genesis': 'segaMD', 'md': 'segaMD', 'gen': 'segaMD',
  'segams': 'segaMS', 'sms': 'segaMS', 'mastersystem': 'segaMS',
  'segagg': 'segaGG', 'gamegear': 'segaGG', 'gg': 'segaGG',
  'sega32x': 'sega32x', '32x': 'sega32x',
  'n64': 'n64', 'nintendo64': 'n64',
  'nds': 'nds', 'ds': 'nds',
  'gba': 'gba',
  'gb': 'gb', 'gbc': 'gb',
  'nes': 'nes', 'famicom': 'nes',
  'snes': 'snes', 'superfamicom': 'snes',
  'vb': 'vb', 'virtualboy': 'vb',
  'atari2600': 'atari2600', 'a2600': 'atari2600',
  'a5200': 'a5200', 'atari5200': 'a5200',
  'atari7800': 'atari7800', 'a7800': 'atari7800',
  'jaguar': 'jaguar',
  'lynx': 'lynx',
  'arcade': 'arcade', 'mame': 'mame2003', 'fbneo': 'arcade',
  'pce': 'pce', 'tg16': 'pce', 'turbografx': 'pce', 'pcengine': 'pce',
  'pcfx': 'pcfx',
  'ngp': 'ngp', 'neogeopocket': 'ngp',
  'ws': 'ws', 'wonderswan': 'ws',
  'coleco': 'coleco', 'colecovision': 'coleco',
  'c64': 'vice_x64sc', 'commodore64': 'vice_x64sc',
  'c128': 'vice_x128', 'commodore128': 'vice_x128',
  'vic20': 'vice_xvic',
  'pet': 'vice_xpet',
  'plus4': 'vice_xplus4',
  'amiga': 'amiga',
  'dos': 'dos', 'msdos': 'dos',
  'j2me': 'j2me',
};

function inferCore(filename) {
  const base = path.basename(filename);
  const ext  = path.extname(base).toLowerCase();

  // 1. Exact match
  if (CORE_MAP[ext]) return CORE_MAP[ext];

  // 2. Ambiguous extension — check system prefix in name
  if (AMBIGUOUS[ext]) {
    // strip extension, check if remaining name ends with .SYSTEM
    const noext = base.slice(0, -ext.length).toLowerCase();
    const parts = noext.split('.');
    if (parts.length >= 2) {
      const sysHint = parts[parts.length - 1];
      if (PREFIX_CORE[sysHint]) return PREFIX_CORE[sysHint];
    }
    return AMBIGUOUS[ext];
  }

  return null;
}

// ── Game list API ─────────────────────────────────────────────────────────────
app.get('/api/games', (_req, res) => {
  const dir = path.join(__dirname, 'public', 'games');
  fs.readdir(dir, (err, files) => {
    if (err) return res.json([]);
    const allExts = new Set([...Object.keys(CORE_MAP), ...Object.keys(AMBIGUOUS)]);
    res.json(
      files
        .filter(f => allExts.has(path.extname(f).toLowerCase()))
        .map(f => {
          const core = inferCore(f);
          if (!core) return null;
          // Clean display name: strip system prefix if present
          let name = path.basename(f, path.extname(f));
          const parts = name.split('.');
          if (parts.length >= 2 && PREFIX_CORE[parts[parts.length-1].toLowerCase()]) {
            parts.pop();
          }
          name = parts.join('.').replace(/[_-]/g, ' ').trim();
          return { filename: f, name, core, ext: path.extname(f).toLowerCase() };
        })
        .filter(Boolean)
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROOMS & SOCKETS
// ═══════════════════════════════════════════════════════════════════════════════
const rooms = {};

function genCode() {
  let c;
  do { c = Math.random().toString(36).substring(2, 6).toUpperCase(); } while (rooms[c]);
  return c;
}

io.on('connection', socket => {
  console.log(`[+] ${socket.id}`);

  socket.on('screen:register', () => {
    const code = genCode();
    rooms[code] = { screenId: socket.id, players: [] };
    socket.join(code); socket.roomCode = code; socket.role = 'screen';
    socket.emit('screen:registered', { roomCode: code });
    console.log(`[room] TV → ${code}`);
  });

  socket.on('controller:join', ({ roomCode }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room)                    return socket.emit('room:error', { message: 'Room not found.' });
    if (room.players.length >= 2) return socket.emit('room:error', { message: 'Room full (2 players max).' });
    const pid = room.players.length + 1;
    room.players.push({ socketId: socket.id, playerId: pid });
    socket.join(code); socket.roomCode = code; socket.playerId = pid; socket.role = 'controller';
    socket.emit('room:joined', { playerId: pid, roomCode: code });
    io.to(room.screenId).emit('controller:connected', { playerId: pid });
    // Send current game selection to the new controller so P2 knows what's selected
    if (room.lastSelection) socket.emit('hub:selection', room.lastSelection);
    // If game is already active, immediately push nav:start so P2 gets the pad
    if (room.gameActive) socket.emit('nav:start', { game: room.lastSelection?.game });
    console.log(`[room] P${pid} → ${code}`);
  });

  const relay = (ev, d) => {
    if (socket.role !== 'controller') return;
    const r = rooms[socket.roomCode]; if (!r) return;
    d !== undefined ? io.to(r.screenId).emit(ev, d) : io.to(r.screenId).emit(ev);
  };

  socket.on('nav:prev',   ()  => relay('nav:prev'));
  socket.on('nav:next',   ()  => relay('nav:next'));
  socket.on('nav:start',  d   => {
    if (socket.role !== 'controller') return;
    const r = rooms[socket.roomCode]; if (!r) return;
    const payload = { ...d, initiatorPlayerId: socket.playerId };
    // Tell the screen
    io.to(r.screenId).emit('nav:start', payload);
    // Tell ALL controllers (so P2 also switches to pad)
    r.players.forEach(p => io.to(p.socketId).emit('nav:start', payload));
    r.gameActive = true;
  });
  socket.on('game:stop',  ()  => {
    if (socket.role !== 'controller' || !socket.roomCode) return;
    const r = rooms[socket.roomCode]; if (!r) return;
    r.gameActive = false;
    io.to(socket.roomCode).emit('game:stop');
  });
  socket.on('game:input', d   => {
    if (socket.role !== 'controller') return;
    const r = rooms[socket.roomCode]; if (!r) return;
    io.to(r.screenId).emit('game:input', { ...d, playerId: socket.playerId });
  });
  socket.on('hub:selection', d => {
    if (socket.role !== 'screen') return;
    const r = rooms[socket.roomCode]; if (!r) return;
    r.lastSelection = d; // remember for late-joining P2
    r.players.forEach(p => io.to(p.socketId).emit('hub:selection', d));
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    if (socket.role === 'screen') {
      io.to(code).emit('room:error', { message: 'TV disconnected.' });
      delete rooms[code];
    } else if (socket.role === 'controller') {
      rooms[code].players = rooms[code].players.filter(p => p.socketId !== socket.id);
      io.to(rooms[code].screenId).emit('controller:disconnected', { playerId: socket.playerId });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🕹  Game Hub`);
  console.log(`   TV    → http://localhost:${PORT}/`);
  console.log(`   Phone → http://localhost:${PORT}/remote.html\n`);
});
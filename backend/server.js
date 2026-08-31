const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const BuildOrchestrator = require('./orchestrator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 4000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend', 'dist');

const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;
const AUTH_TOKEN = AUTH_USER && AUTH_PASS
  ? Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString('base64')
  : null;

[UPLOAD_DIR, OUTPUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const buildClients = new Map();
const buildStatus = new Map();
const STATUS_DIR = path.join(__dirname, 'build_status');
const PENDING_DIR = path.join(__dirname, 'pending_builds');
fs.mkdirSync(STATUS_DIR, { recursive: true });
fs.mkdirSync(PENDING_DIR, { recursive: true });

// בעת startup — בדוק אם יש builds שהשרת לא ידע על תוצאתם
function recoverPendingBuilds() {
  try {
    const files = fs.readdirSync(PENDING_DIR);
    files.forEach(file => {
      if (!file.endsWith('.json')) return;
      const data = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, file)));
      const buildId = data.buildId;
      const age = Date.now() - data.startTime;
      if (age > 30 * 60 * 1000) {
        // ישן מדי — נמחק
        fs.rmSync(path.join(PENDING_DIR, file), { force: true });
        return;
      }
      // בדוק אם יש תוצאה שמורה
      const savedStatus = loadStatus(buildId);
      if (savedStatus && savedStatus.result) {
        // יש תוצאה! broadcast אותה
        setTimeout(() => broadcast(buildId, savedStatus.result), 1000);
        fs.rmSync(path.join(PENDING_DIR, file), { force: true });
      }
    });
  } catch {}
}

setTimeout(recoverPendingBuilds, 3000);

function saveStatus(buildId, data) {
  try {
    fs.writeFileSync(path.join(STATUS_DIR, buildId + '.json'), JSON.stringify(data));
  } catch {}
}

function loadStatus(buildId) {
  try {
    const file = path.join(STATUS_DIR, buildId + '.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file));
  } catch {}
  return null;
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}.zip`)
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const ok = file.mimetype === 'application/zip'
      || file.mimetype === 'application/x-zip-compressed'
      || file.mimetype === 'application/octet-stream'
      || name.endsWith('.zip')
      || name.endsWith('.apk')
      || name.endsWith('.aab');
    ok ? cb(null, true) : cb(new Error('ZIP files only'));
  }
});

app.use(cors());
app.use(express.json());

// Token Auth middleware — רק על API routes
const tokenAuth = (req, res, next) => {
  // פטור: static files, callback, health, auth/check
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/callback/')) return next();
  if (req.path === '/api/health') return next();
  if (req.path === '/api/auth/check') return next();
  if (req.path.startsWith('/downloads/')) return next();
  if (req.path.startsWith('/api/status/')) return next();
  if (!AUTH_TOKEN) return next();

  // פטור: WebView requests (User-Agent מכיל "wv" או "Android")
  const ua = req.headers['user-agent'] || '';
  if (ua.includes('; wv)') || ua.includes('apkbuilder')) return next();

  // בדוק token מ-header או query string
  const token = req.headers['x-auth-token'] || req.query.token;
  if (token === AUTH_TOKEN) return next();

  // בדוק Basic Auth
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    const base64 = authHeader.split(' ')[1];
    if (base64 === AUTH_TOKEN) return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
};

app.use(tokenAuth);

if (fs.existsSync(FRONTEND_DIR)) app.use(express.static(FRONTEND_DIR));

// Downloads — ללא auth (URL ייחודי מספיק כהגנה)
app.get('/downloads/:file', (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  res.download(filePath);
});

// WebSocket
wss.on('connection', (ws, req) => {
  // Auth for WebSocket
  if (AUTH_USER && AUTH_PASS) {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const expected = Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString('base64');
    if (token !== expected) { ws.close(1008, 'Unauthorized'); return; }
  }

  const match = req.url.match(/^\/ws\/([a-zA-Z0-9-]+)/);
  if (!match) { ws.close(); return; }
  const buildId = match[1];
  if (!buildClients.has(buildId)) buildClients.set(buildId, new Set());
  buildClients.get(buildId).add(ws);

  const status = buildStatus.get(buildId);
  if (status) {
    status.logs.forEach(log => ws.send(JSON.stringify({ type: 'log', ...log })));
    if (status.result) ws.send(JSON.stringify(status.result));
  }

  ws.on('close', () => {
    const set = buildClients.get(buildId);
    if (set) { set.delete(ws); if (!set.size) buildClients.delete(buildId); }
  });
  ws.send(JSON.stringify({ type: 'log', text: 'Connected to build stream', level: 'info' }));
});

function broadcast(buildId, msg) {
  if (!buildStatus.has(buildId)) buildStatus.set(buildId, { logs: [], result: null });
  const status = buildStatus.get(buildId);
  if (msg.type === 'log') status.logs.push({ text: msg.text, level: msg.level });
  if (['success', 'error'].includes(msg.type)) {
    status.result = msg;
    saveStatus(buildId, status);
    setTimeout(() => {
      buildStatus.delete(buildId);
      try { fs.rmSync(path.join(STATUS_DIR, buildId + '.json'), { force: true }); } catch {}
    }, 3600000);
  }
  const clients = buildClients.get(buildId);
  if (!clients) return;
  const data = JSON.stringify(msg);
  clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
}

// Upload + trigger build
app.post('/api/build', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const buildId = uuidv4();
  const buildType = req.body.buildType || 'debug';
  const originalName = req.file.originalname;
  const versionName = req.body.versionName || '';
  const versionCode = req.body.versionCode || '';
  res.json({ buildId });

  const orchestrator = new BuildOrchestrator({
    buildId, zipPath: req.file.path, originalName,
    buildType, versionName, versionCode,
    outputDir: OUTPUT_DIR,
    onLog: (text, level = 'info') => broadcast(buildId, { type: 'log', text, level }),
    onStage: (stage) => broadcast(buildId, { type: 'stage', stage }),
    onSuccess: (data) => broadcast(buildId, { type: 'success', ...data }),
    onError: (message) => broadcast(buildId, { type: 'error', message }),
  });

  // שמור את ה-build כ-pending (למקרה של Railway restart)
  const pendingFile = path.join(PENDING_DIR, buildId + '.json');
  fs.writeFileSync(pendingFile, JSON.stringify({ buildId, startTime: Date.now(), buildType }));

  orchestrator.run().then(() => {
    fs.rmSync(pendingFile, { force: true });
  }).catch(err => {
    broadcast(buildId, { type: 'error', message: err.message });
    fs.rmSync(pendingFile, { force: true });
  });
});

// Polling
app.get('/api/status/:buildId', (req, res) => {
  let status = buildStatus.get(req.params.buildId);
  // אם לא בזיכרון — נסה מהדיסק (אחרי Railway restart)
  if (!status) status = loadStatus(req.params.buildId);
  if (!status) return res.json({ status: 'unknown' });
  res.json({
    status: status.result ? (status.result.type === 'success' ? 'done' : 'error') : 'building',
    logs: status.logs,
    result: status.result
  });
});

// Callback from GitHub Actions (ללא auth)
app.post('/api/callback/:buildId', upload.single('apk'), (req, res) => {
  const { buildId } = req.params;
  const status = req.body.status;
  res.json({ ok: true });

  const callbacks = global.buildCallbacks || {};
  if (!callbacks[buildId]) return;

  if (status === 'success' && req.file) {
    const apkBuffer = fs.readFileSync(req.file.path);
    fs.rmSync(req.file.path, { force: true });
    callbacks[buildId].resolve(apkBuffer);
  } else {
    callbacks[buildId].reject(req.body.error || 'Build failed');
  }
  delete callbacks[buildId];
});

app.get('/api/history', (req, res) => {
  try {
    const histFile = path.join(__dirname, 'history.json');
    res.json(fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile)) : []);
  } catch { res.json([]); }
});

app.get('/api/auth/check', (req, res) => {
  if (!AUTH_TOKEN) return res.json({ required: false });
  const token = req.headers['x-auth-token'] || req.query.token;
  const authHeader = req.headers['authorization'];
  const basicToken = authHeader && authHeader.startsWith('Basic ') ? authHeader.split(' ')[1] : null;
  if (token === AUTH_TOKEN || basicToken === AUTH_TOKEN) {
    return res.json({ required: true, valid: true });
  }
  return res.status(401).json({ required: true, valid: false });
});

app.get('/api/health', (req, res) => res.json({
  status: 'ok', ts: Date.now(),
  githubActions: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER),
  auth: !!(AUTH_USER && AUTH_PASS),
  node: process.version
}));

app.get('*', (req, res) => {
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  fs.existsSync(indexPath) ? res.sendFile(indexPath) : res.status(200).send(
    '<h2 style="font-family:sans-serif;padding:40px">APK Builder running</h2>'
  );
});

server.listen(PORT, () => {
  console.log(`APK Builder on :${PORT}`);
  console.log(`Auth: ${AUTH_USER ? 'enabled' : 'disabled'}`);
  console.log(`GitHub Actions: ${process.env.GITHUB_TOKEN ? 'configured' : 'NOT configured'}`);
});

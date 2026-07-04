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

[UPLOAD_DIR, OUTPUT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const buildClients = new Map();

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}.zip`)
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/zip'
      || file.mimetype === 'application/x-zip-compressed'
      || file.originalname.toLowerCase().endsWith('.zip')
      || file.originalname.toLowerCase().endsWith('.apk');
    ok ? cb(null, true) : cb(new Error('ZIP files only'));
  }
});

app.use(cors());
app.use(express.json());

if (fs.existsSync(FRONTEND_DIR)) app.use(express.static(FRONTEND_DIR));
app.use('/downloads', express.static(OUTPUT_DIR));

// WebSocket
wss.on('connection', (ws, req) => {
  const match = req.url.match(/^\/ws\/([a-zA-Z0-9-]+)$/);
  if (!match) { ws.close(); return; }
  const buildId = match[1];
  if (!buildClients.has(buildId)) buildClients.set(buildId, new Set());
  buildClients.get(buildId).add(ws);
  ws.on('close', () => {
    const set = buildClients.get(buildId);
    if (set) { set.delete(ws); if (!set.size) buildClients.delete(buildId); }
  });
  ws.send(JSON.stringify({ type: 'log', text: 'Connected to build stream', level: 'info' }));
});

function broadcast(buildId, msg) {
  const clients = buildClients.get(buildId);
  if (!clients) return;
  const data = JSON.stringify(msg);
  clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(data); });
}

// Upload + trigger build
app.post('/api/build', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const buildId = uuidv4();
  const buildType = req.body.buildType === 'release' ? 'release' : 'debug';
  const originalName = req.file.originalname; // שם הקובץ המקורי
  res.json({ buildId });

  const orchestrator = new BuildOrchestrator({
    buildId,
    zipPath: req.file.path,
    originalName, // מעבירים את השם המקורי
    buildType,
    outputDir: OUTPUT_DIR,
    onLog: (text, level = 'info') => broadcast(buildId, { type: 'log', text, level }),
    onStage: (stage) => broadcast(buildId, { type: 'stage', stage }),
    onSuccess: (data) => broadcast(buildId, { type: 'success', ...data }),
    onError: (message) => broadcast(buildId, { type: 'error', message }),
  });

  orchestrator.run().catch(err => broadcast(buildId, { type: 'error', message: err.message }));
});

// Callback from GitHub Actions
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

app.get('/api/health', (req, res) => res.json({
  status: 'ok', ts: Date.now(),
  githubActions: !!(process.env.GITHUB_TOKEN && process.env.GITHUB_OWNER),
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
  console.log(`GitHub Actions: ${process.env.GITHUB_TOKEN ? 'configured' : 'NOT configured'}`);
});

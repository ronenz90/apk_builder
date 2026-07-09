import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";

const API_URL = import.meta.env.VITE_API_URL || window.location.origin;
const WS_PROTO = window.location.protocol === 'https:' ? 'wss' : 'ws';
const WS_BASE = import.meta.env.VITE_WS_URL || `${WS_PROTO}://${window.location.host}`;

const STAGES = [
  { id: "upload", label: "Upload", icon: "⬆" },
  { id: "extract", label: "Extract", icon: "📦" },
  { id: "validate", label: "Validate", icon: "✓" },
  { id: "build", label: "Build", icon: "⚙" },
  { id: "done", label: "Done", icon: "✦" },
];

const TRANSLATIONS = {
  en: {
    title: "APK Builder", sub: "Upload ZIP → Build → Download",
    drop: "Drop your .zip here", browse: "or tap to browse files",
    maxSize: "Max 200MB · ZIP files only", debug: "Debug", release: "Release", aab: "AAB",
    buildType: "Build Type", uploading: "Uploading...", extracting: "Extracting ZIP...",
    validating: "Validating project...", building: "Building...",
    success: "Build Successful!", download: "Download", failed: "Build Failed",
    restart: "New Build", logs: "Build Logs", install: "Install App",
    aabNote: "AAB is for Play Store upload only",
    versionSection: "Version (optional)",
    versionName: "Version Name", versionNamePlaceholder: "e.g. 1.2.0 (leave empty = use from ZIP)",
    versionCode: "Version Code", versionCodePlaceholder: "e.g. 12 (leave empty = use from ZIP)",
    loginTitle: "APK Builder", loginSub: "Sign in to continue",
    username: "Username", password: "Password", loginBtn: "Sign In",
    loginError: "Invalid username or password",
    logout: "Sign Out",
  },
  he: {
    title: "בונה APK", sub: "העלה ZIP ← בנה ← הורד",
    drop: "גרור קובץ .zip לכאן", browse: "או לחץ לבחירת קובץ",
    maxSize: "מקסימום 200MB · קבצי ZIP בלבד", debug: "דיבאג", release: "ריליס", aab: "AAB",
    buildType: "סוג בנייה", uploading: "מעלה...", extracting: "מחלץ...",
    validating: "מאמת פרויקט...", building: "בונה...",
    success: "הבנייה הצליחה!", download: "הורד", failed: "הבנייה נכשלה",
    restart: "בנייה חדשה", logs: "יומן בנייה", install: "התקן אפליקציה",
    aabNote: "AAB מיועד להעלאה לחנות בלבד",
    versionSection: "גרסה (אופציונלי)",
    versionName: "שם גרסה", versionNamePlaceholder: "למשל 1.2.0 (ריק = מה שבZIP)",
    versionCode: "קוד גרסה", versionCodePlaceholder: "למשל 12 (ריק = מה שבZIP)",
    loginTitle: "בונה APK", loginSub: "התחבר להמשיך",
    username: "שם משתמש", password: "סיסמה", loginBtn: "כניסה",
    loginError: "שם משתמש או סיסמה שגויים",
    logout: "התנתק",
  },
};

// ── Auth helpers ──────────────────────────────────────────
function getToken() {
  return sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || '';
}
function setToken(user, pass) {
  const token = btoa(`${user}:${pass}`);
  sessionStorage.setItem('auth_token', token);
  localStorage.setItem('auth_token', token);
  return token;
}
function clearToken() {
  sessionStorage.removeItem('auth_token');
  localStorage.removeItem('auth_token');
}
function authHeaders() {
  const token = getToken();
  return token ? { 'x-auth-token': token } : {};
}

// ── Login Screen ──────────────────────────────────────────
function LoginScreen({ lang, onLogin }) {
  const t = TRANSLATIONS[lang];
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!user || !pass) return;
    setLoading(true);
    setError('');
    const token = btoa(`${user}:${pass}`);
    try {
      const res = await fetch(`${API_URL}/api/auth/check`, {
        headers: { 'x-auth-token': token }
      });
      const data = await res.json();
      if (data.valid) {
        setToken(user, pass);
        onLogin();
      } else {
        setError(t.loginError);
      }
    } catch (e) {
      setError('Connection error: ' + e.message);
    }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">◈</div>
        <h1 className="login-title">{t.loginTitle}</h1>
        <p className="login-sub">{t.loginSub}</p>
        <input
          className="login-input"
          type="text"
          placeholder={t.username}
          value={user}
          onChange={e => setUser(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
        />
        <input
          className="login-input"
          type="password"
          placeholder={t.password}
          value={pass}
          onChange={e => setPass(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
        />
        {error && <p className="login-error">{error}</p>}
        <button className="login-btn" onClick={handleLogin} disabled={loading}>
          {loading ? '...' : t.loginBtn}
        </button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState("en");
  const [authed, setAuthed] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [buildType, setBuildType] = useState("debug");
  const [versionName, setVersionName] = useState("");
  const [versionCode, setVersionCode] = useState("");
  const [stage, setStage] = useState("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [apkUrl, setApkUrl] = useState(null);
  const [apkSize, setApkSize] = useState(null);
  const [buildTime, setBuildTime] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [buildStartTime, setBuildStartTime] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const logsRef = useRef(null);
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  const seenLogsRef = useRef(new Set());

  const t = TRANSLATIONS[lang];

  // Check if auth is needed on load
  useEffect(() => {
    const token = getToken();
    const headers = token ? { 'x-auth-token': token } : {};
    fetch(`${API_URL}/api/auth/check`, { headers }).then(res => res.json()).then(data => {
      if (!data.required) {
        // אין סיסמה בשרת — כנס ישירות
        setAuthed(true);
      } else if (data.valid) {
        // יש token שמור ותקין
        setNeedsAuth(true);
        setAuthed(true);
      } else {
        // צריך סיסמה
        setNeedsAuth(true);
        setAuthed(false);
      }
    }).catch(() => setAuthed(true));
  }, []);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const addLog = (text, type = "info") => {
    const key = `${text}${type}`;
    if (seenLogsRef.current.has(key)) return;
    seenLogsRef.current.add(key);
    setLogs(prev => [...prev, { text, type, ts: Date.now() }]);
  };

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleResult = useCallback((msg) => {
    if (msg.type === 'success') {
      setStage("done"); setApkUrl(msg.apkUrl); setApkSize(msg.apkSize);
      setQrCode(msg.qrCode);
      setBuildTime(((Date.now() - buildStartTime) / 1000).toFixed(1));
      stopPolling();
      // Android notification
      if (window.AndroidBridge) {
        window.AndroidBridge.buildSuccess(msg.apkUrl?.split('/').pop() || 'app', msg.apkSize || '');
      }
    }
    if (msg.type === 'error') {
      setStage("error"); setErrorMsg(msg.message); stopPolling();
      // Android notification
      if (window.AndroidBridge) {
        window.AndroidBridge.buildFailed('Build', msg.message || 'Unknown error');
      }
    }
  }, [buildStartTime]);

  const startPolling = useCallback((buildId) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/status/${buildId}`, { headers: authHeaders() });
        const data = await res.json();
        if (data.logs) data.logs.forEach(log => addLog(log.text, log.level || 'info'));
        if (data.status === 'building') setStage('build');
        if (data.result) handleResult(data.result);
      } catch {}
    }, 5000);
  }, [handleResult]);

  const connectWS = useCallback((buildId) => {
    const token = getToken();
    const ws = new WebSocket(`${WS_BASE}/ws/${buildId}?token=${token}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "log") addLog(msg.text, msg.level || "info");
      if (msg.type === "stage") setStage(msg.stage);
      if (msg.type === "success" || msg.type === "error") handleResult(msg);
    };
    ws.onerror = () => addLog("WebSocket disconnected — polling active", "warn");
  }, [handleResult]);

  const onDrop = useCallback(async (accepted, rejected) => {
    if (rejected.length > 0) { setErrorMsg("Please upload a .zip file under 200MB"); setStage("error"); return; }
    const file = accepted[0];
    setStage("uploading"); setUploadProgress(0); setLogs([]);
    setApkUrl(null); setErrorMsg(null); setBuildStartTime(Date.now());
    seenLogsRef.current = new Set();
    stopPolling();

    const formData = new FormData();
    formData.append("file", file);
    formData.append("buildType", buildType);
    formData.append("versionName", versionName.trim());
    formData.append("versionCode", versionCode.trim());

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status === 200) {
        connectWS(data.buildId); startPolling(data.buildId);
        setStage("extract"); addLog(`Build ID: ${data.buildId}`);
        if (versionName) addLog(`Version: ${versionName} (code: ${versionCode || 'from ZIP'})`);
      } else if (xhr.status === 401) {
        setAuthed(false);
      } else {
        setStage("error"); setErrorMsg(data.error || "Upload failed");
      }
    };
    xhr.onerror = () => { setStage("error"); setErrorMsg("Network error"); };
    xhr.open("POST", `${API_URL}/api/build`);
    const token = getToken();
    if (token) xhr.setRequestHeader('x-auth-token', token);
    xhr.send(formData);
  }, [buildType, versionName, versionCode, connectWS, startPolling]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/zip": [".zip"], "application/x-zip-compressed": [".zip"] },
    maxSize: 200 * 1024 * 1024, multiple: false,
    disabled: !["idle", "done", "error"].includes(stage),
  });

  const reset = () => {
    if (wsRef.current) wsRef.current.close();
    stopPolling();
    setStage("idle"); setLogs([]); setUploadProgress(0);
    setApkUrl(null); setApkSize(null); setBuildTime(null);
    setErrorMsg(null); setQrCode(null);
    seenLogsRef.current = new Set();
  };

  const logout = () => {
    clearToken();
    setAuthed(false);
  };

  // Show login if needed and not authed
  if (needsAuth && !authed) {
    return <LoginScreen lang={lang} onLogin={() => setAuthed(true)} />;
  }

  const isActive = !["idle", "done", "error"].includes(stage);
  const currentStageIdx = STAGES.findIndex(s =>
    stage === "done" ? s.id === "done" :
    stage === "uploading" ? s.id === "upload" : s.id === stage
  );
  const isAAB = buildType === "aab";
  const fileExt = isAAB ? "AAB" : "APK";

  return (
    <div className={`app ${lang === "he" ? "rtl" : ""}`}>
      <nav className="navbar">
        <div className="nav-brand">
          <span className="brand-icon">◈</span>
          <span className="brand-name">APK Builder</span>
        </div>
        <div className="nav-actions">
          {installPrompt && (
            <button className="install-btn" onClick={() => installPrompt.prompt()}>📲 {t.install}</button>
          )}
          {needsAuth && authed && (
            <button className="lang-btn" onClick={logout} style={{color:'#f87171',borderColor:'#f87171'}}>
              {t.logout}
            </button>
          )}
          <button className={`lang-btn ${lang === "en" ? "active" : ""}`} onClick={() => setLang("en")}>EN</button>
          <button className={`lang-btn ${lang === "he" ? "active" : ""}`} onClick={() => setLang("he")}>עב</button>
        </div>
      </nav>

      <main className="main">
        <header className="hero">
          <h1 className="hero-title">{t.title}</h1>
          <p className="hero-sub">{t.sub}</p>
        </header>

        <div className="build-type-row">
          <span className="build-type-label">{t.buildType}:</span>
          <div className="toggle-group">
            <button className={`toggle-btn ${buildType === "debug" ? "active" : ""}`}
              onClick={() => setBuildType("debug")} disabled={isActive}>🐛 {t.debug}</button>
            <button className={`toggle-btn ${buildType === "release" ? "active" : ""}`}
              onClick={() => setBuildType("release")} disabled={isActive}>🚀 {t.release}</button>
            <button className={`toggle-btn aab ${buildType === "aab" ? "active" : ""}`}
              onClick={() => setBuildType("aab")} disabled={isActive}>📦 {t.aab}</button>
          </div>
        </div>

        {buildType === "aab" && <div className="aab-note">🏪 {t.aabNote}</div>}

        {["idle", "done", "error"].includes(stage) && (
          <div className="version-section">
            <span className="version-label">🏷 {t.versionSection}</span>
            <div className="version-fields">
              <div className="version-field">
                <label>{t.versionName}</label>
                <input type="text" placeholder={t.versionNamePlaceholder}
                  value={versionName} onChange={e => setVersionName(e.target.value)}
                  className="version-input" />
              </div>
              <div className="version-field">
                <label>{t.versionCode}</label>
                <input type="number" placeholder={t.versionCodePlaceholder}
                  value={versionCode} onChange={e => setVersionCode(e.target.value)}
                  className="version-input" min="1" />
              </div>
            </div>
          </div>
        )}

        {["idle", "done", "error"].includes(stage) && (
          <div {...getRootProps()} className={`dropzone ${isDragActive ? "drag-active" : ""} ${stage === "error" ? "error-state" : ""}`}>
            <input {...getInputProps()} />
            <div className="drop-icon">
              {stage === "error" ? "✗" : stage === "done" ? "✓" : isDragActive ? "↓" : "⬆"}
            </div>
            <p className="drop-text">{t.drop}</p>
            <p className="drop-sub">{t.browse}</p>
            <p className="drop-hint">{t.maxSize}</p>
            {stage === "error" && errorMsg && <div className="drop-error">{errorMsg}</div>}
          </div>
        )}

        {isActive && (
          <div className="stage-track">
            {STAGES.map((s, i) => {
              const done = i < currentStageIdx;
              const active = i === currentStageIdx;
              return (
                <div key={s.id} className={`stage-item ${done ? "done" : active ? "active" : ""}`}>
                  <div className="stage-dot"><span>{done ? "✓" : s.icon}</span></div>
                  <span className="stage-label">{s.label}</span>
                  {i < STAGES.length - 1 && <div className={`stage-line ${done ? "done" : ""}`} />}
                </div>
              );
            })}
          </div>
        )}

        {stage === "uploading" && (
          <div className="progress-wrap">
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="progress-pct">{uploadProgress}%</span>
          </div>
        )}

        {isActive && (
          <div className="status-msg">
            <span className="spinner" />
            <span>
              {stage === "uploading" ? t.uploading
                : stage === "extract" ? t.extracting
                : stage === "validate" ? t.validating
                : t.building}
            </span>
          </div>
        )}

        {stage === "done" && (
          <div className="result-card success">
            <div className="result-icon success">✦</div>
            <h2 className="result-title">{t.success}</h2>
            <div className="result-meta">
              {apkSize && <span className="meta-chip">📦 {fileExt} · {apkSize}</span>}
              {buildTime && <span className="meta-chip">⏱ {buildTime}s</span>}
              {versionName && <span className="meta-chip">🏷 v{versionName}</span>}
            </div>
            <a href={`${API_URL}${apkUrl}`} download className="download-btn">
              ↓ {t.download} {fileExt}
            </a>
            {!isAAB && qrCode && (
              <div className="qr-wrap">
                <img src={qrCode} alt="QR" className="qr-img" />
                <p className="qr-hint">Scan on another device</p>
              </div>
            )}
            {isAAB && <div className="aab-note" style={{marginTop:'8px'}}>🏪 העלה את ה-AAB ל-Google Play Console</div>}
            <button className="restart-btn" onClick={reset}>{t.restart}</button>
          </div>
        )}

        {stage === "error" && errorMsg && (
          <div className="result-card error">
            <div className="result-icon error">✗</div>
            <h2 className="result-title">{t.failed}</h2>
            <p className="error-detail">{errorMsg}</p>
            <button className="restart-btn" onClick={reset}>{t.restart}</button>
          </div>
        )}

        {logs.length > 0 && (
          <div className="terminal-wrap">
            <div className="terminal-header">
              <div className="terminal-dots">
                <span className="dot red"/><span className="dot yellow"/><span className="dot green"/>
              </div>
              <span className="terminal-title">{t.logs}</span>
            </div>
            <div className="terminal-body" ref={logsRef}>
              {logs.map((log, i) => (
                <div key={i} className={`log-line ${log.type}`}>
                  <span className="log-ts">{new Date(log.ts).toLocaleTimeString()}</span>
                  <span className="log-text">{log.text}</span>
                </div>
              ))}
              <span className="cursor-blink">▌</span>
            </div>
          </div>
        )}
      </main>

      <footer className="footer">APK Builder · Railway · PWA</footer>
    </div>
  );
}

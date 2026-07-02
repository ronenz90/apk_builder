import { useState, useCallback, useRef, useEffect } from "react";
import { useDropzone } from "react-dropzone";

// Auto-detect URLs - works locally AND on Railway
const API_URL = import.meta.env.VITE_API_URL || window.location.origin;
const WS_URL = import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;

const STAGES = [
  { id: "upload", label: "Upload", icon: "⬆" },
  { id: "extract", label: "Extract", icon: "📦" },
  { id: "validate", label: "Validate", icon: "✓" },
  { id: "build", label: "Build", icon: "⚙" },
  { id: "done", label: "Done", icon: "✦" },
];

const TRANSLATIONS = {
  en: {
    title: "APK Builder", sub: "Upload ZIP → Build → Download APK",
    drop: "Drop your .zip here", browse: "or tap to browse files",
    maxSize: "Max 200MB · ZIP files only", debug: "Debug", release: "Release",
    buildType: "Build Type", uploading: "Uploading...", extracting: "Extracting ZIP...",
    validating: "Validating project...", building: "Building APK...",
    success: "Build Successful!", download: "Download APK", failed: "Build Failed",
    restart: "New Build", logs: "Build Logs", apkSize: "APK Size",
    buildTime: "Build Time", install: "Install App", installing: "Add to Home Screen",
  },
  he: {
    title: "בונה APK", sub: "העלה ZIP ← בנה ← הורד APK",
    drop: "גרור קובץ .zip לכאן", browse: "או לחץ לבחירת קובץ",
    maxSize: "מקסימום 200MB · קבצי ZIP בלבד", debug: "דיבאג", release: "ריליס",
    buildType: "סוג בנייה", uploading: "מעלה...", extracting: "מחלץ...",
    validating: "מאמת פרויקט...", building: "בונה APK...",
    success: "הבנייה הצליחה!", download: "הורד APK", failed: "הבנייה נכשלה",
    restart: "בנייה חדשה", logs: "יומן בנייה", apkSize: "גודל APK",
    buildTime: "זמן בנייה", install: "התקן אפליקציה", installing: "הוסף למסך הבית",
  },
};

export default function App() {
  const [lang, setLang] = useState("en");
  const [buildType, setBuildType] = useState("debug");
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
  const [isInstalled, setIsInstalled] = useState(false);
  const logsRef = useRef(null);
  const wsRef = useRef(null);

  const t = TRANSLATIONS[lang];

  // Capture PWA install prompt
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setIsInstalled(true));
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') { setIsInstalled(true); setInstallPrompt(null); }
  };

  const addLog = (text, type = "info") =>
    setLogs(prev => [...prev, { text, type, ts: Date.now() }]);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const connectWS = (id) => {
    const ws = new WebSocket(`${WS_URL}/ws/${id}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "log") addLog(msg.text, msg.level || "info");
      if (msg.type === "stage") setStage(msg.stage);
      if (msg.type === "success") {
        setStage("done");
        setApkUrl(msg.apkUrl);
        setApkSize(msg.apkSize);
        setQrCode(msg.qrCode);
        setBuildTime(((Date.now() - buildStartTime) / 1000).toFixed(1));
      }
      if (msg.type === "error") { setStage("error"); setErrorMsg(msg.message); }
    };
    ws.onerror = () => addLog("Connection error — try refreshing", "error");
  };

  const onDrop = useCallback(async (accepted, rejected) => {
    if (rejected.length > 0) {
      setErrorMsg("Please upload a .zip file under 200MB");
      setStage("error"); return;
    }
    const file = accepted[0];
    setStage("uploading"); setUploadProgress(0); setLogs([]); setApkUrl(null);
    setErrorMsg(null); setBuildStartTime(Date.now());

    const formData = new FormData();
    formData.append("file", file);
    formData.append("buildType", buildType);

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status === 200) {
        connectWS(data.buildId);
        setStage("extract");
        addLog(`Build ID: ${data.buildId}`);
      } else {
        setStage("error"); setErrorMsg(data.error || "Upload failed");
      }
    };
    xhr.onerror = () => { setStage("error"); setErrorMsg("Network error"); };
    xhr.open("POST", `${API_URL}/api/build`);
    xhr.send(formData);
  }, [buildType, buildStartTime]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/zip": [".zip"], "application/x-zip-compressed": [".zip"] },
    maxSize: 200 * 1024 * 1024, multiple: false,
    disabled: !["idle", "done", "error"].includes(stage),
  });

  const reset = () => {
    if (wsRef.current) wsRef.current.close();
    setStage("idle"); setLogs([]); setUploadProgress(0);
    setApkUrl(null); setApkSize(null); setBuildTime(null);
    setErrorMsg(null); setQrCode(null);
  };

  const isActive = !["idle", "done", "error"].includes(stage);
  const currentStageIdx = STAGES.findIndex(s =>
    stage === "done" ? s.id === "done" :
    stage === "uploading" ? s.id === "upload" : s.id === stage
  );

  return (
    <div className={`app ${lang === "he" ? "rtl" : ""}`}>

      {/* Navbar */}
      <nav className="navbar">
        <div className="nav-brand">
          <span className="brand-icon">◈</span>
          <span className="brand-name">APK Builder</span>
        </div>
        <div className="nav-actions">
          {/* PWA Install Button */}
          {installPrompt && !isInstalled && (
            <button className="install-btn" onClick={handleInstall}>
              📲 {t.install}
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

        {/* Build Type */}
        <div className="build-type-row">
          <span className="build-type-label">{t.buildType}:</span>
          <div className="toggle-group">
            <button className={`toggle-btn ${buildType === "debug" ? "active" : ""}`}
              onClick={() => setBuildType("debug")} disabled={isActive}>
              🐛 {t.debug}
            </button>
            <button className={`toggle-btn ${buildType === "release" ? "active" : ""}`}
              onClick={() => setBuildType("release")} disabled={isActive}>
              🚀 {t.release}
            </button>
          </div>
        </div>

        {/* Drop Zone */}
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

        {/* Stage Track */}
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

        {/* Upload Progress */}
        {stage === "uploading" && (
          <div className="progress-wrap">
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="progress-pct">{uploadProgress}%</span>
          </div>
        )}

        {/* Status */}
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

        {/* Success */}
        {stage === "done" && (
          <div className="result-card success">
            <div className="result-icon success">✦</div>
            <h2 className="result-title">{t.success}</h2>
            <div className="result-meta">
              {apkSize && <span className="meta-chip">📦 {apkSize}</span>}
              {buildTime && <span className="meta-chip">⏱ {buildTime}s</span>}
            </div>
            <a href={`${API_URL}${apkUrl}`} download className="download-btn">↓ {t.download}</a>
            {qrCode && (
              <div className="qr-wrap">
                <img src={qrCode} alt="QR" className="qr-img" />
                <p className="qr-hint">Scan on another device</p>
              </div>
            )}
            <button className="restart-btn" onClick={reset}>{t.restart}</button>
          </div>
        )}

        {/* Error */}
        {stage === "error" && errorMsg && (
          <div className="result-card error">
            <div className="result-icon error">✗</div>
            <h2 className="result-title">{t.failed}</h2>
            <p className="error-detail">{errorMsg}</p>
            <button className="restart-btn" onClick={reset}>{t.restart}</button>
          </div>
        )}

        {/* Terminal Logs */}
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

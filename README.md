# ◈ APK Builder 😊 

> Upload your Android Studio ZIP → Automatic APK build → Download in seconds

A full-stack web application that builds Android APKs from uploaded Android Studio project ZIPs, using isolated Docker containers for each build.

---

## ✨ Features

- **Drag & Drop Upload** — Drop any `.zip` of your Android Studio project
- **Real-time Build Logs** — WebSocket-powered live terminal output
- **Docker Isolation** — Each build runs in its own container (security + reproducibility)
- **Debug & Release** — Toggle between build types
- **QR Code Download** — Scan to instantly get APK on your phone
- **Build History** — Track previous builds
- **Hebrew + English** — Full RTL/LTR language toggle
- **Mobile Friendly** — Fully responsive, works from any device

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (React)                     │
│  Drag & Drop → Upload → Live Logs → Download APK        │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP + WebSocket
┌──────────────────────▼──────────────────────────────────┐
│               Backend (Node.js + Express)               │
│  Multer Upload → Validation → Docker Spawn → WS Logs    │
└──────────────────────┬──────────────────────────────────┘
                       │ docker run
┌──────────────────────▼──────────────────────────────────┐
│          Build Container (apk-builder-env)              │
│  Ubuntu 22 + Java 17 + Android SDK 34 + Gradle 8.7      │
│  CPU: 2 cores  |  RAM: 2GB  |  Timeout: 10 min         │
└──────────────────────┬──────────────────────────────────┘
                       │ APK output
┌──────────────────────▼──────────────────────────────────┐
│            File Storage (backend/outputs/)              │
│  APK served via /downloads/:filename                    │
└─────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
apk-builder/
├── frontend/                  # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx            # Main app with all UI logic
│   │   └── App.css            # Dark theme styles
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   ├── nginx.conf             # Production nginx config
│   └── Dockerfile.frontend
│
├── backend/                   # Node.js + Express API
│   ├── server.js              # Express + WebSocket server
│   ├── orchestrator.js        # Build lifecycle manager
│   └── package.json
│
├── docker/
│   ├── Dockerfile             # Android build environment
│   ├── Dockerfile.backend     # Backend container
│   └── docker-gradle-init.sh  # Gradle cache warmer
│
├── scripts/
│   ├── setup.sh               # First-time setup
│   └── start.sh               # Dev startup
│
├── docker-compose.yml         # Production deployment
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Docker** (Desktop or Engine)
- **npm** or **pnpm**

### Option A: Docker Compose (Production)

```bash
# 1. Build the Android SDK image (one time, ~10 min)
docker build -f docker/Dockerfile -t apk-builder-env:latest .

# 2. Start everything
docker-compose up --build

# App available at:
#   Frontend: http://localhost:3000
#   Backend:  http://localhost:4000
```

### Option B: Manual Dev Setup

```bash
# 1. Build Android SDK Docker image
docker build -f docker/Dockerfile -t apk-builder-env:latest .

# 2. Backend
cd backend
npm install
npm run dev   # starts on :4000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev   # starts on :3000

# 4. Open http://localhost:3000
```

### Option C: One-line Setup Script

```bash
chmod +x scripts/setup.sh scripts/start.sh
./scripts/setup.sh   # builds images + installs deps
./scripts/start.sh   # starts both services
```

---

## ⚙️ Configuration

### Environment Variables (backend)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Backend port |
| `BASE_URL` | `http://localhost:4000` | Public URL (for QR codes) |
| `USE_DOCKER` | `true` | Use Docker isolation for builds |
| `BUILD_TIMEOUT_MS` | `600000` | Build timeout (10 min) |

### Environment Variables (frontend)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000` | Backend API URL |
| `VITE_WS_URL` | `ws://localhost:4000` | WebSocket URL |

Create `.env` files in `frontend/` and `backend/` to override these.

---

## 🔐 Security

- **Docker isolation** — each build gets a fresh container, deleted after completion
- **Resource limits** — 2 CPU cores, 2GB RAM per build
- **Build timeout** — hard 10-minute limit
- **File validation** — only ZIP files ≤ 200MB accepted
- **Project validation** — must contain `build.gradle` + `app/` + `settings.gradle`
- **Auto-cleanup** — workspace deleted 5 seconds after build completion
- **No persistent access** — build containers have no network access by default

---

## 📦 Upload Format

Your ZIP should be the **root of your Android Studio project**:

```
my-app.zip
└── my-app/           ← or just the root files directly
    ├── app/
    │   └── src/
    ├── build.gradle
    ├── settings.gradle
    └── gradlew
```

The app auto-detects the project root up to 3 levels deep inside the ZIP.

---

## 🔨 Build Process

1. **Upload** — ZIP uploaded via multipart form, max 200MB
2. **Extract** — Unzipped to isolated workspace
3. **Validate** — Checks for `build.gradle`, `app/`, `settings.gradle`
4. **Build** — Runs in Docker: `./gradlew assembleDebug` or `assembleRelease`
5. **Output** — APK copied to `/downloads/` directory
6. **QR Code** — Generated for mobile direct download
7. **Cleanup** — Workspace deleted after 5 seconds

---

## 🐛 Troubleshooting

**"Docker image not found"**
```bash
docker build -f docker/Dockerfile -t apk-builder-env:latest .
```

**"Build timed out"**
- Increase `BUILD_TIMEOUT_MS` in backend `.env`
- Check Docker has enough resources (Docker Desktop → Settings → Resources)

**"Not a valid Android Studio project"**
- Ensure your ZIP contains `build.gradle`, `app/` directory, and `settings.gradle`
- Don't zip just the `app/` folder — zip the whole project root

**Gradle download issues in Docker**
- The Dockerfile pre-caches Gradle 8.7, 8.4, and 7.6
- For other versions, the container needs internet access

---

## 📄 License

MIT © APK Builder

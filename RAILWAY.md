# ◈ APK Builder — Railway Deployment Guide

## פריסה ב-Railway (5 דקות)

### שלב 1 — העלה ל-GitHub

```bash
git init
git add .
git commit -m "APK Builder"
git remote add origin https://github.com/YOUR_USERNAME/apk-builder.git
git push -u origin main
```

### שלב 2 — צור פרויקט ב-Railway

1. כנס ל־ https://railway.app → **New Project**
2. בחר **Deploy from GitHub repo**
3. בחר את ה-repo שזה עתה העלית
4. Railway יזהה את `railway.json` ויתחיל לבנות אוטומטית

### שלב 3 — הגדר משתני סביבה

ב-Railway → Settings → Variables, הוסף:

| משתנה | ערך | הסבר |
|---|---|---|
| `NODE_ENV` | `production` | מצב פרודקשן |
| `BUILD_TIMEOUT_MS` | `600000` | timeout של 10 דקות |
| `USE_DOCKER` | `false` | **חשוב!** אל תשתמש ב-Docker |

> `RAILWAY_PUBLIC_DOMAIN` נוצר **אוטומטית** על ידי Railway — לא צריך להגדיר אותו.

### שלב 4 — קבל URL ציבורי

1. Railway → Settings → Networking → **Generate Domain**
2. תקבל URL כמו: `https://apk-builder-production.up.railway.app`

### שלב 5 — התקן כ-PWA על הטלפון

1. פתח את ה-URL ב-Chrome לאנדרואיד
2. תראה כפתור **"📲 Install App"** בראש הדף
3. לחץ → **"Add to Home Screen"**
4. מעכשיו יש לך אייקון על המסך כמו אפליקציה רגילה!

---

## מבנה הפרויקט

```
apk-builder/
├── frontend/          # React PWA
│   ├── src/App.jsx    # ממשק משתמש
│   ├── public/
│   │   ├── manifest.json   # PWA manifest
│   │   └── sw.js           # Service Worker
│   └── package.json
│
├── backend/
│   ├── server.js      # Express + WebSocket
│   ├── orchestrator.js # ניהול הבנייה
│   └── package.json
│
├── nixpacks.toml      # Railway build config (Android SDK)
├── railway.json       # Railway deployment config
└── README.md
```

---

## איך עובד הזרימה

```
טלפון → PWA → upload ZIP
         ↓
    Railway Server
    (Node.js + Android SDK)
         ↓
    ./gradlew assembleDebug
         ↓
    WebSocket → לוגים חיים
         ↓
    APK מוכן → QR Code → הורדה
```

---

## בעיות נפוצות

**❌ "ANDROID_HOME not set"**
→ Railway צריך להוריד את Android SDK בפעם הראשונה — חכה לסיום ה-build

**❌ "gradlew not found"**
→ ודא שה-ZIP כולל את ה-gradlew בתיקיית השורש

**❌ Build timeout**
→ הגדל את `BUILD_TIMEOUT_MS` ל-`900000` (15 דקות)

**❌ Out of memory**
→ שדרג ל-Railway Pro ($5/חודש) לזיכרון גדול יותר

---

## חינמי vs. Pro

| | Free | Pro ($5/חודש) |
|---|---|---|
| RAM | 512MB | 8GB |
| CPU | 0.5 vCPU | 8 vCPU |
| Builds | איטי | מהיר |
| Uptime | 500 שעות/חודש | ללא הגבלה |

לפרויקטים קטנים — החינמי מספיק.
לשימוש יומיומי — Pro מומלץ.

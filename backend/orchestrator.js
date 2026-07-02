const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const QRCode = require('qrcode');

const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.BASE_URL || 'http://localhost:4000');

const BUILD_TIMEOUT_MS = parseInt(process.env.BUILD_TIMEOUT_MS || '600000');
const WORK_DIR = path.join(__dirname, 'workspace');

fs.mkdirSync(WORK_DIR, { recursive: true });

class BuildOrchestrator {
  constructor({ buildId, zipPath, buildType, outputDir, onLog, onStage, onSuccess, onError }) {
    this.buildId = buildId;
    this.zipPath = zipPath;
    this.buildType = buildType;
    this.outputDir = outputDir;
    this.onLog = onLog;
    this.onStage = onStage;
    this.onSuccess = onSuccess;
    this.onError = onError;
    this.workPath = path.join(WORK_DIR, buildId);
  }

  log(text, level = 'info') { this.onLog(text, level); }

  async run() {
    try {
      // Stage 1: Extract
      this.onStage('extract');
      this.log('📦 Extracting ZIP...');
      await this.extract();
      this.log('✓ Extracted successfully', 'success');

      // Stage 2: Validate
      this.onStage('validate');
      this.log('🔍 Validating Android project...');
      const projectRoot = this.findAndroidRoot(this.workPath);
      if (!projectRoot) throw new Error(
        'Invalid Android project. Make sure ZIP contains build.gradle, app/ and settings.gradle at the root.'
      );
      this.log(`✓ Project found: ${path.basename(projectRoot)}`, 'success');

      // Check gradlew
      const gradlew = path.join(projectRoot, 'gradlew');
      if (fs.existsSync(gradlew)) {
        fs.chmodSync(gradlew, '755');
        this.log('  gradlew found ✓');
      } else {
        this.log('⚠ gradlew not found — using system gradle', 'warn');
      }

      // Stage 3: Build
      this.onStage('build');
      const task = this.buildType === 'release' ? 'assembleRelease' : 'assembleDebug';
      this.log(`🔨 Running: ./gradlew ${task}`);
      this.log('ℹ First build may take 5-10 min (Gradle downloads dependencies)');

      const apkPath = await this.runGradle(projectRoot, task);
      this.log('✓ Build successful!', 'success');

      // Copy APK to outputs
      const apkFilename = `${this.buildId}-${this.buildType}.apk`;
      const destPath = path.join(this.outputDir, apkFilename);
      fs.copyFileSync(apkPath, destPath);

      const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(2);
      const apkUrl = `/downloads/${apkFilename}`;
      const fullUrl = `${BASE_URL}${apkUrl}`;

      this.log(`📱 APK ready: ${apkFilename} (${sizeMB} MB)`, 'success');
      this.log(`🔗 ${fullUrl}`, 'info');

      // QR Code
      let qrCode = null;
      try {
        qrCode = await QRCode.toDataURL(fullUrl, { width: 200, margin: 1 });
        this.log('📷 QR code generated', 'info');
      } catch {}

      // Save history
      this.saveHistory({ apkUrl, sizeMB });

      this.onSuccess({ apkUrl, apkSize: `${sizeMB} MB`, qrCode });

    } catch (err) {
      this.log(`✗ ${err.message}`, 'error');
      this.onError(err.message);
    } finally {
      setTimeout(() => this.cleanup(), 10000);
    }
  }

  async extract() {
    fs.mkdirSync(this.workPath, { recursive: true });
    const zip = new AdmZip(this.zipPath);
    zip.extractAllTo(this.workPath, true);
    fs.rmSync(this.zipPath, { force: true });
  }

  findAndroidRoot(dir, depth = 0) {
    if (depth > 3) return null;
    const has = (f) => fs.existsSync(path.join(dir, f));
    if ((has('build.gradle') || has('build.gradle.kts')) &&
        has('app') && (has('settings.gradle') || has('settings.gradle.kts'))) {
      return dir;
    }
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const found = this.findAndroidRoot(path.join(dir, entry.name), depth + 1);
          if (found) return found;
        }
      }
    } catch {}
    return null;
  }

  runGradle(projectRoot, task) {
    return new Promise((resolve, reject) => {
      // Build env with Android SDK paths
      const androidHome = process.env.ANDROID_HOME || `${process.env.HOME}/android-sdk`;
      const env = {
        ...process.env,
        ANDROID_HOME: androidHome,
        ANDROID_SDK_ROOT: androidHome,
        JAVA_HOME: process.env.JAVA_HOME || '/nix/var/nix/profiles/default',
        PATH: [
          `${androidHome}/cmdline-tools/latest/bin`,
          `${androidHome}/platform-tools`,
          `${androidHome}/build-tools/34.0.0`,
          process.env.PATH
        ].join(':'),
        GRADLE_OPTS: '-Xmx1536m -Dorg.gradle.daemon=false',
      };

      const gradlew = fs.existsSync(path.join(projectRoot, 'gradlew'))
        ? './gradlew'
        : 'gradle';

      this.log(`  Executor: ${gradlew}`);
      this.log(`  ANDROID_HOME: ${androidHome}`);

      const proc = spawn('bash', ['-c', `${gradlew} ${task} --no-daemon --stacktrace 2>&1`], {
        cwd: projectRoot,
        env,
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`Build timed out after ${BUILD_TIMEOUT_MS / 60000} minutes`));
      }, BUILD_TIMEOUT_MS);

      proc.stdout.on('data', (data) => {
        data.toString().split('\n')
          .map(l => l.trim()).filter(Boolean)
          .forEach(line => {
            const level = /ERROR|FAILED|Exception/.test(line) ? 'error'
              : /warning|Warning/.test(line) ? 'warn'
              : /BUILD SUCCESSFUL|UP-TO-DATE/.test(line) ? 'success'
              : 'info';
            this.log(line, level);
          });
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) return reject(new Error(`Gradle exited with code ${code}`));
        const apk = this.findAPK(projectRoot);
        if (!apk) return reject(new Error('Build succeeded but APK not found'));
        resolve(apk);
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Cannot run gradle: ${err.message}`));
      });
    });
  }

  findAPK(root) {
    const search = (dir) => {
      if (!fs.existsSync(dir)) return null;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { const f = search(full); if (f) return f; }
        else if (entry.name.endsWith('.apk') && !entry.name.includes('unsigned')) return full;
      }
      return null;
    };
    return search(path.join(root, 'app', 'build', 'outputs'));
  }

  saveHistory({ apkUrl, sizeMB }) {
    const histFile = path.join(__dirname, 'history.json');
    let h = [];
    try { h = JSON.parse(fs.readFileSync(histFile)); } catch {}
    h.unshift({ buildId: this.buildId, buildType: this.buildType, apkUrl, apkSize: `${sizeMB} MB`, ts: new Date().toISOString() });
    fs.writeFileSync(histFile, JSON.stringify(h.slice(0, 50), null, 2));
  }

  cleanup() {
    try { fs.rmSync(this.workPath, { recursive: true, force: true }); } catch {}
  }
}

module.exports = BuildOrchestrator;

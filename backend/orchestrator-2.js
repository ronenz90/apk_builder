const fs = require('fs');
const path = require('path');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const QRCode = require('qrcode');

const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : (process.env.BASE_URL || 'http://localhost:4000');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_BUILDS_REPO = process.env.GITHUB_BUILDS_REPO;

const WORK_DIR = path.join(__dirname, 'workspace');
fs.mkdirSync(WORK_DIR, { recursive: true });

class BuildOrchestrator {
  constructor({ buildId, zipPath, originalName, buildType, versionName, versionCode, outputDir, onLog, onStage, onSuccess, onError }) {
    this.buildId = buildId;
    this.zipPath = zipPath;
    this.originalName = originalName || 'app';
    this.buildType = buildType;
    this.versionName = versionName || '';
    this.versionCode = versionCode || '';
    this.outputDir = outputDir;
    this.onLog = onLog;
    this.onStage = onStage;
    this.onSuccess = onSuccess;
    this.onError = onError;
  }

  log(text, level = 'info') { this.onLog(text, level); }

  async run() {
    try {
      this.onStage('extract');
      this.log('📦 Validating ZIP...');
      const zip = new AdmZip(this.zipPath);
      const entries = zip.getEntries().map(e => e.entryName);
      const hasGradle = entries.some(e => e.includes('build.gradle'));
      const hasApp = entries.some(e => e.includes('app/'));
      if (!hasGradle || !hasApp) {
        throw new Error('Invalid Android project. ZIP must contain build.gradle and app/ directory.');
      }
      this.log('✓ Valid Android project', 'success');

      this.onStage('validate');
      this.log('☁️ Uploading project to GitHub...');
      const downloadUrl = await this.uploadToGitHub();
      this.log('✓ Uploaded successfully', 'success');

      this.onStage('build');
      this.log('🔨 Triggering GitHub Actions build...');
      const callbackUrl = `${BASE_URL}/api/callback/${this.buildId}`;
      await this.triggerWorkflow(downloadUrl, callbackUrl);
      this.log('✓ Build started on GitHub Actions', 'success');
      this.log('ℹ Waiting for build (~3-5 minutes)...');

      await this.waitForCallback();

    } catch (err) {
      this.log(`✗ ${err.message}`, 'error');
      this.onError(err.message);
      this.cleanup();
    }
  }

  uploadToGitHub() {
    return new Promise(async (resolve, reject) => {
      try {
        const zipContent = fs.readFileSync(this.zipPath);
        const filename = `${this.buildId}.zip`;

        const releaseData = JSON.stringify({
          tag_name: `build-${this.buildId}`,
          name: `Build ${this.buildId}`,
          draft: false,
          prerelease: true
        });

        const release = await this.githubRequest('POST',
          `/repos/${GITHUB_OWNER}/${GITHUB_BUILDS_REPO}/releases`,
          releaseData
        );

        const releaseId = JSON.parse(release).id;
        const uploadUrl = `https://uploads.github.com/repos/${GITHUB_OWNER}/${GITHUB_BUILDS_REPO}/releases/${releaseId}/assets?name=${filename}`;
        await this.uploadAsset(uploadUrl, zipContent, filename);

        const downloadUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_BUILDS_REPO}/releases/download/build-${this.buildId}/${filename}`;
        resolve(downloadUrl);
      } catch (err) {
        reject(err);
      }
    });
  }

  triggerWorkflow(downloadUrl, callbackUrl) {
    const projectName = this.originalName
      .replace(/\.zip$/i, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .substring(0, 50);

    const data = JSON.stringify({
      ref: 'main',
      inputs: {
        download_url: downloadUrl,
        build_type: this.buildType,
        callback_url: callbackUrl,
        project_name: projectName,
        version_name: this.versionName,
        version_code: this.versionCode
      }
    });

    return this.githubRequest('POST',
      `/repos/${GITHUB_OWNER}/${GITHUB_BUILDS_REPO}/actions/workflows/main.yml/dispatches`,
      data
    );
  }

  waitForCallback() {
    return new Promise((resolve, reject) => {
      global.buildCallbacks = global.buildCallbacks || {};
      global.buildCallbacks[this.buildId] = {
        resolve: (apkBuffer) => {
          this.handleSuccess(apkBuffer).then(resolve).catch(reject);
        },
        reject: (err) => {
          this.onError(err);
          reject(new Error(err));
        }
      };

      setTimeout(() => {
        delete global.buildCallbacks[this.buildId];
        reject(new Error('Build timed out after 15 minutes'));
      }, 15 * 60 * 1000);
    });
  }

  async handleSuccess(apkBuffer) {
    const projectName = this.originalName.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = this.buildType === 'aab' ? 'aab' : 'apk';
    const versionSuffix = this.versionName ? `-v${this.versionName}` : '';
    const apkFilename = `${projectName}${versionSuffix}-${this.buildType}.${ext}`;
    const destPath = path.join(this.outputDir, apkFilename);
    fs.writeFileSync(destPath, apkBuffer);

    const sizeMB = (fs.statSync(destPath).size / 1024 / 1024).toFixed(2);
    const apkUrl = `/downloads/${apkFilename}`;
    const fullUrl = `${BASE_URL}${apkUrl}`;

    this.log(`📱 Ready: ${apkFilename} (${sizeMB} MB)`, 'success');

    let qrCode = null;
    try { qrCode = await QRCode.toDataURL(fullUrl, { width: 200, margin: 1 }); } catch {}

    this.onSuccess({ apkUrl, apkSize: `${sizeMB} MB`, qrCode });
    this.cleanup();
  }

  githubRequest(method, apiPath, data) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'APK-Builder',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data || '')
        }
      };

      const req = https.request(options, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 400) reject(new Error(`GitHub API ${res.statusCode}: ${body}`));
          else resolve(body);
        });
      });

      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  uploadAsset(url, content, filename) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/zip',
          'Content-Length': content.length,
          'User-Agent': 'APK-Builder'
        }
      };

      const req = https.request(options, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 400) reject(new Error(`Upload error ${res.statusCode}: ${body}`));
          else resolve(body);
        });
      });

      req.on('error', reject);
      req.write(content);
      req.end();
    });
  }

  cleanup() {
    try { fs.rmSync(this.zipPath, { force: true }); } catch {}
  }
}

module.exports = BuildOrchestrator;

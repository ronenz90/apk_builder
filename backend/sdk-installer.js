const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ANDROID_HOME = process.env.ANDROID_HOME || path.join(process.env.HOME || '/root', 'android-sdk');
const SDK_MARKER = path.join(ANDROID_HOME, '.sdk-ready');

async function installAndroidSDK() {
  // Already installed?
  if (fs.existsSync(SDK_MARKER)) {
    console.log('✓ Android SDK already installed');
    process.env.ANDROID_HOME = ANDROID_HOME;
    process.env.ANDROID_SDK_ROOT = ANDROID_HOME;
    return true;
  }

  console.log('📦 Installing Android SDK (first time, ~3 minutes)...');

  try {
    const cmdlineToolsDir = path.join(ANDROID_HOME, 'cmdline-tools');
    fs.mkdirSync(cmdlineToolsDir, { recursive: true });

    // Download cmdline-tools
    console.log('  Downloading Android command-line tools...');
    execSync(
      `wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmdtools.zip`,
      { stdio: 'inherit', timeout: 120000 }
    );

    execSync(`unzip -q /tmp/cmdtools.zip -d /tmp/cmdtools`, { stdio: 'pipe' });
    execSync(`mv /tmp/cmdtools/cmdline-tools ${path.join(cmdlineToolsDir, 'latest')}`, { stdio: 'pipe' });
    execSync(`rm -rf /tmp/cmdtools /tmp/cmdtools.zip`, { stdio: 'pipe' });

    // Set env
    const sdkBin = path.join(ANDROID_HOME, 'cmdline-tools', 'latest', 'bin');
    process.env.ANDROID_HOME = ANDROID_HOME;
    process.env.ANDROID_SDK_ROOT = ANDROID_HOME;
    process.env.PATH = `${sdkBin}:${path.join(ANDROID_HOME, 'platform-tools')}:${process.env.PATH}`;

    // Accept licenses + install packages
    console.log('  Installing SDK packages...');
    execSync(`yes | ${path.join(sdkBin, 'sdkmanager')} --licenses`, { stdio: 'pipe', timeout: 30000 }).toString();
    execSync(
      `${path.join(sdkBin, 'sdkmanager')} "platform-tools" "platforms;android-34" "build-tools;34.0.0"`,
      { stdio: 'inherit', timeout: 180000 }
    );

    // Mark as done
    fs.writeFileSync(SDK_MARKER, new Date().toISOString());
    console.log('✓ Android SDK installed successfully!');
    return true;

  } catch (err) {
    console.error('⚠ Android SDK install failed:', err.message);
    console.error('  Builds will fail until SDK is available');
    return false;
  }
}

module.exports = { installAndroidSDK, ANDROID_HOME };

#!/usr/bin/env node
/**
 * Local Android build pipeline (no EAS account needed).
 *
 *   node scripts/android.mjs keystore   # one-time: create credentials/release.jks
 *   node scripts/android.mjs build      # expo prebuild + gradle assembleRelease
 *   node scripts/android.mjs install    # adb install -r the built APK
 *   node scripts/android.mjs run        # build + install
 *   node scripts/android.mjs debug      # gradle assembleDebug (JS bundled, no Metro needed)
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const androidDir = path.join(root, 'android');
const credDir = path.join(root, 'credentials');

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const quote = (s) => (isWin && /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  const r = spawnSync(quote(cmd), args.map(quote), { stdio: 'inherit', shell: isWin, cwd: root, ...opts });
  if (r.status !== 0) {
    console.error(`\nCommand failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

function ensureSdkEnv() {
  if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
    const candidates = [
      path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'),
      path.join(os.homedir(), 'Android', 'Sdk'),
      path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    ];
    const found = candidates.find((c) => c && existsSync(c));
    if (!found) {
      console.error('Android SDK not found. Set ANDROID_HOME.');
      process.exit(1);
    }
    process.env.ANDROID_HOME = found;
    console.log(`ANDROID_HOME=${found}`);
  }
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (existsSync(androidDir)) {
    const lp = path.join(androidDir, 'local.properties');
    const line = `sdk.dir=${sdk.replace(/\\/g, '\\\\')}`;
    if (!existsSync(lp) || !readFileSync(lp, 'utf8').includes(line)) writeFileSync(lp, `${line}\n`);
  }
  if (!process.env.JAVA_HOME) {
    const studioJbr = isWin ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
    if (existsSync(studioJbr)) {
      process.env.JAVA_HOME = studioJbr;
      console.log(`JAVA_HOME=${studioJbr}`);
    }
  }
}

function keystore() {
  mkdirSync(credDir, { recursive: true });
  const jks = path.join(credDir, 'release.jks');
  const propsFile = path.join(credDir, 'keystore.properties');
  if (existsSync(jks)) {
    console.log(`Keystore already exists: ${jks}`);
    return;
  }
  const pw = randomBytes(18).toString('base64url');
  const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'keytool') : 'keytool';
  run(keytool, [
    '-genkeypair', '-v', '-keystore', jks, '-alias', 'roombahome2', '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000', '-storepass', pw, '-keypass', pw, '-dname', 'CN=Roomba Home 2, OU=home, O=home, L=home, ST=home, C=US',
  ]);
  writeFileSync(propsFile, `storePassword=${pw}\nkeyPassword=${pw}\nkeyAlias=roombahome2\n`);
  console.log(`\nCreated ${jks} and ${propsFile}. Keep them: the same key is needed to update the installed app.`);
}

function prebuild() {
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install']);
  ensureSdkEnv();
}

function gradle(task) {
  const gradlew = isWin ? 'gradlew.bat' : './gradlew';
  run(gradlew, [task, '--console=plain'], { cwd: androidDir });
}

function apkPath(variant) {
  return path.join(androidDir, 'app', 'build', 'outputs', 'apk', variant, `app-${variant}.apk`);
}

function install(variant = 'release') {
  const apk = apkPath(variant);
  if (!existsSync(apk)) {
    console.error(`APK not found: ${apk}. Run "build" first.`);
    process.exit(1);
  }
  const devices = execSync('adb devices', { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .filter((l) => l.trim().endsWith('device'));
  if (devices.length === 0) {
    console.error('No Android device connected. Enable USB debugging on the phone and plug it in (adb devices).');
    process.exit(1);
  }
  run('adb', ['install', '-r', apk]);
  console.log('\nInstalled. Launch "Roomba Home 2.0" on the phone.');
}

const cmd = process.argv[2] ?? 'run';
ensureSdkEnv();
switch (cmd) {
  case 'keystore':
    keystore();
    break;
  case 'prebuild':
    prebuild();
    break;
  case 'build':
    if (!existsSync(path.join(credDir, 'release.jks'))) keystore();
    prebuild();
    gradle('assembleRelease');
    console.log(`\nAPK: ${apkPath('release')}`);
    break;
  case 'debug':
    prebuild();
    gradle('assembleDebug');
    console.log(`\nAPK: ${apkPath('debug')}`);
    break;
  case 'install':
    install(process.argv[3] ?? 'release');
    break;
  case 'run':
    if (!existsSync(path.join(credDir, 'release.jks'))) keystore();
    prebuild();
    gradle('assembleRelease');
    install('release');
    break;
  default:
    console.error(`Unknown command ${cmd}`);
    process.exit(2);
}

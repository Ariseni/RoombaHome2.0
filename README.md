# Roomba Home 2.0

Unofficial Android app for the **Roomba Plus 505 AutoWash** (Prime/V4 cloud protocol). Faster, local-first UI that talks to iRobot's own servers — no third-party backend.

Not affiliated with iRobot. Initial robot Wi-Fi setup, account creation, firmware updates and Matter/Alexa linking still require the official Roomba Home app.

## What it does

- Sign in with your iRobot account (credentials stay on the phone, Android Keystore)
- Live status: battery, phase, bin/tank, vendor error text
- Start / pause / resume / stop / dock / find
- Whole-house clean with vacuum / mop / combo, suction and pad wetness
- Map with room/zone tap-to-select and targeted cleaning
- AutoWash dock: empty bin, wash pads, dry pads, refill
- Live map trail while cleaning

## Protocol spike (no UI)

Close the official Roomba app first (iRobot limits concurrent sessions).

```bash
ROOMBA_USER=you@example.com ROOMBA_PASS='secret' ROOMBA_COUNTRY=DE npm run spike
```

Optional: `ROOMBA_FIND=1` (chime), `ROOMBA_WATCH=30`, `ROOMBA_LIVEMAP=1`, `ROOMBA_DUMP=./tmp-dump`.

## Install on the S24+

Needs Android SDK + JDK (Android Studio is enough). USB debugging on, phone plugged in.

```bash
npm install
npm run keystore          # once — creates credentials/release.jks (git-ignored)
npm run run:android       # prebuild + signed release APK + adb install
```

Or separately: `npm run build:android` then `npm run install:android`.

## Dev

```bash
npm test
npm run typecheck
npx expo start            # Metro, for a debug build already on the device
```

`src/protocol/` is pure TypeScript (no React Native) so the spike and tests run in Node.

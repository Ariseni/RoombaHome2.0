import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import type { Credentials } from '@/protocol/types';

const CREDS_KEY = 'rh2.credentials';
const ROBOT_KEY = 'rh2.robot';

/** Credentials live in the Android Keystore-backed SecureStore. */
export async function loadCredentials(): Promise<Credentials | null> {
  const raw = await SecureStore.getItemAsync(CREDS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  await SecureStore.setItemAsync(CREDS_KEY, JSON.stringify(creds));
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDS_KEY);
  await SecureStore.deleteItemAsync(ROBOT_KEY);
}

export async function loadSelectedRobot(): Promise<string | null> {
  return SecureStore.getItemAsync(ROBOT_KEY);
}

export async function saveSelectedRobot(blid: string | null): Promise<void> {
  if (blid) await SecureStore.setItemAsync(ROBOT_KEY, blid);
  else await SecureStore.deleteItemAsync(ROBOT_KEY);
}

// --- JSON / binary cache on disk (non-sensitive) ---------------------------

function cacheDir(): Directory {
  const dir = new Directory(Paths.cache, 'rh2');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function safeName(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function readJsonCache<T>(key: string): T | null {
  try {
    const f = new File(cacheDir(), `${safeName(key)}.json`);
    if (!f.exists) return null;
    return JSON.parse(f.textSync()) as T;
  } catch {
    return null;
  }
}

export function writeJsonCache(key: string, value: unknown): void {
  try {
    const f = new File(cacheDir(), `${safeName(key)}.json`);
    f.write(JSON.stringify(value));
  } catch (e) {
    console.warn('cache write failed', key, e);
  }
}

export function readBytesCache(key: string): Uint8Array | null {
  try {
    const f = new File(cacheDir(), `${safeName(key)}.bin`);
    if (!f.exists) return null;
    return f.bytesSync();
  } catch {
    return null;
  }
}

export function writeBytesCache(key: string, bytes: Uint8Array): void {
  try {
    const f = new File(cacheDir(), `${safeName(key)}.bin`);
    f.write(bytes);
  } catch (e) {
    console.warn('cache write failed', key, e);
  }
}

export function clearCache(): void {
  try {
    const dir = new Directory(Paths.cache, 'rh2');
    if (dir.exists) dir.delete();
  } catch {
    /* ignore */
  }
}

import { inflate } from 'pako';

import type { JsonObject } from '../types';

export interface PositionSample {
  x: number;
  y: number;
  theta: number;
  operatingModes: number;
}

export interface PositionUpdate {
  kind: 'position';
  sequence: number;
  samples: PositionSample[];
  timestamp: number; // unix seconds
  expiresAt: number | null; // unix seconds
}

export interface MapUpdate {
  kind: 'map';
  livemapUrl: string;
  livemapUrlRaw: string | null;
  timestamp: number | null;
}

export type LiveMapMessage = PositionUpdate | MapUpdate;

function asSeconds(v: unknown): number | null {
  if (typeof v !== 'number' || v <= 0) return null;
  return v > 7_258_118_400 ? v / 1000 : v;
}

/**
 * Parses a message from `{irbt}/things/{blid}/livemap/update`.
 * pos_update.cur_path is a flat array: [seq, x,y,theta,modes, x,y,theta,modes, ..., ts]
 */
export function parseLiveMapMessage(data: JsonObject): LiveMapMessage | null {
  const pos = data.pos_update as JsonObject | undefined;
  if (pos && Array.isArray(pos.cur_path)) {
    const cur = pos.cur_path as number[];
    if ((cur.length - 2) % 4 !== 0) return null;
    const samples: PositionSample[] = [];
    for (let i = 1; i < cur.length - 1; i += 4) {
      samples.push({ x: cur[i], y: cur[i + 1], theta: cur[i + 2], operatingModes: Math.trunc(cur[i + 3]) });
    }
    return {
      kind: 'position',
      sequence: Math.trunc(cur[0]),
      samples,
      timestamp: cur[cur.length - 1],
      expiresAt: asSeconds(data.update_expire_ts),
    };
  }
  const mu = data.map_update as JsonObject | undefined;
  if (mu && typeof mu.livemap_url === 'string') {
    return {
      kind: 'map',
      livemapUrl: mu.livemap_url,
      livemapUrlRaw: typeof mu.livemap_url_raw === 'string' ? mu.livemap_url_raw : null,
      timestamp: typeof data.timestamp === 'number' ? data.timestamp : null,
    };
  }
  return null;
}

/** Live map payloads are zlib-compressed (`78 9c`); pass through otherwise. */
export function maybeInflate(bytes: Uint8Array): Uint8Array {
  if (bytes[0] === 0x78 || (bytes[0] === 0x1f && bytes[1] === 0x8b)) return inflate(bytes);
  return bytes;
}

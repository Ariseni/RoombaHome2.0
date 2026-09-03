import { Buffer } from 'buffer';

import type { JsonObject } from '../types';
import {
  type Bounds,
  type Point,
  type PolygonCoords,
  type Ring,
  boundsOfRings,
  centroid,
  emptyBounds,
  extendBounds,
  isValidBounds,
  lineStringsOf,
  pointOf,
  polygonsOf,
} from './geometry';
import { unpackTarGz } from './tar';

export interface RoomFeature {
  id: string;
  name: string | null;
  roomType: string | null;
  polygons: PolygonCoords[];
  centroid: Point;
  area: number;
  adjacentRoomIds: string[];
}

export interface ZoneFeature {
  id: string;
  name: string | null;
  polygons: PolygonCoords[];
  centroid: Point;
}

export interface PolicyZoneFeature {
  id: string;
  /** 1 = keep-out zone, 6 = no-mop zone (observed); raw type kept. */
  zoneType: string | number | null;
  polygons: PolygonCoords[];
  lines: Ring[];
}

export interface FloorPlanFeature {
  id: string;
  roomId: string | null;
  floorType: string | null;
  polygons: PolygonCoords[];
}

export interface FurnitureFeature {
  id: string;
  furnitureType: string | null;
  polygons: PolygonCoords[];
}

export interface HazardFeature {
  id: string;
  hazardType: string | null;
  point: Point;
}

export interface MapModel {
  p2mapId: string;
  versionId: string;
  name: string | null;
  rooms: RoomFeature[];
  zones: ZoneFeature[];
  policyZones: PolicyZoneFeature[];
  floorPlan: FloorPlanFeature[];
  borders: PolygonCoords[];
  furniture: FurnitureFeature[];
  hazards: HazardFeature[];
  trajectories: Ring[];
  coverage: PolygonCoords[];
  dock: { point: Point; orientation: number | null } | null;
  bounds: Bounds;
  /** Raw parsed files, keyed by filename without extension. */
  files: Record<string, unknown>;
}

interface GeoFeature {
  id?: string | number;
  type?: string;
  geometry?: unknown;
  properties?: JsonObject;
}

function featuresOf(file: unknown): GeoFeature[] {
  if (!file || typeof file !== 'object') return [];
  const f = file as { type?: string; features?: unknown };
  if (Array.isArray(f.features)) return f.features as GeoFeature[];
  if (Array.isArray(file)) return file as GeoFeature[];
  if (f.type === 'Feature') return [file as GeoFeature];
  return [];
}

function idOf(f: GeoFeature, fallback: number): string {
  if (f.id !== undefined && f.id !== null) return String(f.id);
  const p = f.properties ?? {};
  for (const k of ['id', 'region_id', 'roomId', 'zoneId']) if (p[k] != null) return String(p[k]);
  return String(fallback);
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v));

/** Turns the raw tar.gz bundle bytes into `{ filename: parsedJson | text | bytes }`. */
export function parseBundleFiles(bytes: Uint8Array): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of unpackTarGz(bytes)) {
    let key = entry.name.split('/').pop() ?? entry.name;
    if (key.includes('.')) key = key.slice(0, key.lastIndexOf('.'));
    const text = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength).toString('utf8');
    try {
      out[key] = JSON.parse(text);
    } catch {
      out[key] = text;
    }
  }
  return out;
}

export interface BuildMapInput {
  p2mapId: string;
  versionId: string;
  name?: string | null;
  files: Record<string, unknown>;
  /** Extra region names, e.g. from rooms_metadata or the version document. */
  regionNames?: Record<string, string>;
}

export function buildMapModel(input: BuildMapInput): MapModel {
  const { files } = input;
  const names = input.regionNames ?? {};
  const bounds = emptyBounds();

  const rooms: RoomFeature[] = featuresOf(files.rooms).map((f, i) => {
    const polygons = polygonsOf(f.geometry);
    const outer = polygons[0]?.[0] ?? [];
    boundsOfRings(polygons.flat(), bounds);
    const id = idOf(f, i);
    const p = f.properties ?? {};
    return {
      id,
      name: strOrNull(p.name) ?? names[id] ?? null,
      roomType: strOrNull(p.type),
      polygons,
      centroid: centroid(outer),
      area: polygons.reduce((a, poly) => a + (poly[0] ? ringAreaSafe(poly[0]) : 0), 0),
      adjacentRoomIds: Array.isArray(p.adjacentRoomIDs) ? (p.adjacentRoomIDs as unknown[]).map(String) : [],
    };
  });

  const zones: ZoneFeature[] = featuresOf(files.cleanZones).map((f, i) => {
    const polygons = polygonsOf(f.geometry);
    boundsOfRings(polygons.flat(), bounds);
    const id = idOf(f, i);
    return {
      id,
      name: strOrNull(f.properties?.name) ?? names[id] ?? null,
      polygons,
      centroid: centroid(polygons[0]?.[0] ?? []),
    };
  });

  const policyZones: PolicyZoneFeature[] = featuresOf(files.policyZones).map((f, i) => {
    const polygons = polygonsOf(f.geometry);
    const lines = lineStringsOf(f.geometry);
    boundsOfRings(polygons.flat(), bounds);
    boundsOfRings(lines, bounds);
    const t = f.properties?.type;
    return { id: idOf(f, i), zoneType: typeof t === 'number' || typeof t === 'string' ? t : null, polygons, lines };
  });

  const floorPlan: FloorPlanFeature[] = featuresOf(files.floorPlan).map((f, i) => {
    const polygons = polygonsOf(f.geometry);
    boundsOfRings(polygons.flat(), bounds);
    return {
      id: idOf(f, i),
      roomId: strOrNull(f.properties?.roomId),
      floorType: strOrNull(f.properties?.type),
      polygons,
    };
  });

  const borders: PolygonCoords[] = featuresOf(files.borders).flatMap((f) => polygonsOf(f.geometry));
  boundsOfRings(borders.flat(), bounds);

  const furniture: FurnitureFeature[] = featuresOf(files.furniture).map((f, i) => ({
    id: idOf(f, i),
    furnitureType: strOrNull(f.properties?.type),
    polygons: polygonsOf(f.geometry),
  }));

  const hazards: HazardFeature[] = featuresOf(files.hazard)
    .map((f, i) => {
      const point = pointOf(f.geometry);
      return point ? { id: idOf(f, i), hazardType: strOrNull(f.properties?.type), point } : null;
    })
    .filter((h): h is HazardFeature => h !== null);

  const trajectories: Ring[] = featuresOf(files.trajectories).flatMap((f) => lineStringsOf(f.geometry));
  const coverage: PolygonCoords[] = featuresOf(files.coverage).flatMap((f) => polygonsOf(f.geometry));

  let dock: MapModel['dock'] = null;
  const dockFeature = featuresOf(files.dockPose)[0];
  if (dockFeature) {
    const point = pointOf(dockFeature.geometry);
    if (point) {
      extendBounds(bounds, point);
      const o = dockFeature.properties?.orientation;
      dock = { point, orientation: typeof o === 'number' ? o : null };
    }
  }

  if (!isValidBounds(bounds)) {
    bounds.minX = -1;
    bounds.minY = -1;
    bounds.maxX = 1;
    bounds.maxY = 1;
  }

  return {
    p2mapId: input.p2mapId,
    versionId: input.versionId,
    name: input.name ?? null,
    rooms,
    zones,
    policyZones,
    floorPlan,
    borders,
    furniture,
    hazards,
    trajectories,
    coverage,
    dock,
    bounds,
    files,
  };
}

function ringAreaSafe(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/**
 * Extracts `{ region_id: name }` from the sources that may carry names:
 * the active-map list's rooms_metadata, and the version document's
 * geojson_details.regions.
 */
export function regionNamesFrom(...sources: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list as JsonObject[]) {
      if (!item || typeof item !== 'object') continue;
      const id = item.id ?? item.region_id ?? item.room_id;
      const name = item.name ?? item.region_name;
      if (id != null && typeof name === 'string' && name) out[String(id)] = name;
    }
  };
  for (const s of sources) {
    if (!s) continue;
    if (Array.isArray(s)) visit(s);
    else if (typeof s === 'object') {
      const o = s as JsonObject;
      visit(o.rooms_metadata);
      visit((o.geojson_details as JsonObject | undefined)?.regions);
      visit(o.regions);
    }
  }
  return out;
}

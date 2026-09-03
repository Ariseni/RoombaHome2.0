export type Point = [number, number];
export type Ring = Point[];
/** GeoJSON Polygon coordinates: first ring outer, rest holes. */
export type PolygonCoords = Ring[];
export type MultiPolygonCoords = PolygonCoords[];

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBounds(b: Bounds, p: Point): void {
  if (p[0] < b.minX) b.minX = p[0];
  if (p[0] > b.maxX) b.maxX = p[0];
  if (p[1] < b.minY) b.minY = p[1];
  if (p[1] > b.maxY) b.maxY = p[1];
}

export function boundsOfRings(rings: Ring[], b = emptyBounds()): Bounds {
  for (const r of rings) for (const p of r) extendBounds(b, p);
  return b;
}

export function isValidBounds(b: Bounds): boolean {
  return Number.isFinite(b.minX) && Number.isFinite(b.maxX) && b.maxX > b.minX && b.maxY > b.minY;
}

/** Area-weighted centroid of the outer ring (shoelace). */
export function centroid(ring: Ring): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  if (n === 0) return [0, 0];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    // degenerate: average
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / n, sy / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/** Ray-casting point-in-polygon honouring holes. */
export function pointInPolygon(p: Point, poly: PolygonCoords): boolean {
  if (poly.length === 0 || !pointInRing(p, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i])) return false;
  return true;
}

export function pointInRing(p: Point, ring: Ring): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Coerces GeoJSON geometry into a list of polygons (Polygon or MultiPolygon). */
export function polygonsOf(geometry: unknown): PolygonCoords[] {
  if (!geometry || typeof geometry !== 'object') return [];
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) return [g.coordinates as PolygonCoords];
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) return g.coordinates as MultiPolygonCoords;
  return [];
}

export function lineStringsOf(geometry: unknown): Ring[] {
  if (!geometry || typeof geometry !== 'object') return [];
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g.type === 'LineString' && Array.isArray(g.coordinates)) return [g.coordinates as Ring];
  if (g.type === 'MultiLineString' && Array.isArray(g.coordinates)) return g.coordinates as Ring[];
  return [];
}

export function pointOf(geometry: unknown): Point | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    return [Number(g.coordinates[0]), Number(g.coordinates[1])];
  }
  return null;
}

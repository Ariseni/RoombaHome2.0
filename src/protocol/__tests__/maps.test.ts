import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { buildMapModel, parseBundleFiles, regionNamesFrom } from '../maps/bundle';
import { pointInPolygon } from '../maps/geometry';
import { untar } from '../maps/tar';

/** Builds a minimal ustar archive from {name: content}. */
function makeTar(files: Record<string, string>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 'ascii');
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    header.write('00000000000\0', 136, 'ascii');
    header.write('        ', 148, 'ascii');
    header.write('0', 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let sum = 0;
    for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return new Uint8Array(Buffer.concat(blocks));
}

const rooms = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: '12',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 3], [0, 3], [0, 0]]] },
      properties: { name: 'Kitchen', type: 'kitchen', adjacentRoomIDs: ['13'] },
    },
    {
      type: 'Feature',
      id: '13',
      geometry: { type: 'Polygon', coordinates: [[[4, 0], [8, 0], [8, 3], [4, 3], [4, 0]]] },
      properties: { type: 'livingRoom' },
    },
  ],
};
const dock = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { orientation: 1.57 } }],
};

describe('map bundle', () => {
  it('untars and parses json files', () => {
    const tar = makeTar({ 'rooms.geojson': JSON.stringify(rooms), 'manifest.json': '{"a":1}', 'notes.txt': 'hi' });
    const entries = untar(tar);
    expect(entries.map((e) => e.name)).toEqual(['rooms.geojson', 'manifest.json', 'notes.txt']);
    const files = parseBundleFiles(new Uint8Array(gzipSync(Buffer.from(tar))));
    expect(Object.keys(files).sort()).toEqual(['manifest', 'notes', 'rooms']);
    expect(files.notes).toBe('hi');
  });

  it('builds a map model with rooms, names, bounds and dock', () => {
    const files = parseBundleFiles(makeTar({ 'rooms.geojson': JSON.stringify(rooms), 'dockPose.geojson': JSON.stringify(dock) }));
    const model = buildMapModel({
      p2mapId: 'm1',
      versionId: 'v1',
      files,
      regionNames: regionNamesFrom({ rooms_metadata: [{ id: '13', name: 'Living room' }] }),
    });
    expect(model.rooms).toHaveLength(2);
    expect(model.rooms[0].name).toBe('Kitchen');
    expect(model.rooms[1].name).toBe('Living room');
    expect(model.rooms[0].area).toBeCloseTo(12);
    expect(model.rooms[0].centroid[0]).toBeCloseTo(2);
    expect(model.rooms[0].centroid[1]).toBeCloseTo(1.5);
    expect(model.bounds).toEqual({ minX: 0, minY: 0, maxX: 8, maxY: 3 });
    expect(model.dock).toEqual({ point: [1, 1], orientation: 1.57 });
    expect(pointInPolygon([6, 1], model.rooms[1].polygons[0])).toBe(true);
    expect(pointInPolygon([6, 1], model.rooms[0].polygons[0])).toBe(false);
  });
});

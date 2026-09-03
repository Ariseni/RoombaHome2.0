import { inflate } from 'pako';

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

function readString(b: Uint8Array, off: number, len: number): string {
  let end = off;
  const max = off + len;
  while (end < max && b[end] !== 0) end++;
  let s = '';
  for (let i = off; i < end; i++) s += String.fromCharCode(b[i]);
  return s;
}

function readOctal(b: Uint8Array, off: number, len: number): number {
  const s = readString(b, off, len).trim();
  return s ? parseInt(s, 8) : 0;
}

/** Minimal POSIX/GNU tar reader (regular files only). */
export function untar(bytes: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let off = 0;
  let longName: string | null = null;
  while (off + 512 <= bytes.length) {
    const header = bytes.subarray(off, off + 512);
    if (header.every((x) => x === 0)) break; // end-of-archive
    let name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = readString(header, 345, 155);
    if (prefix && readString(header, 257, 6).startsWith('ustar')) name = `${prefix}/${name}`;
    const dataStart = off + 512;
    const data = bytes.subarray(dataStart, dataStart + size);
    if (type === 'L') {
      longName = readString(data, 0, data.length);
    } else if (type === '0' || type === '\0' || type === '7') {
      out.push({ name: longName ?? name, data });
      longName = null;
    } else {
      longName = null; // directories, pax headers, links: skip
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** gunzip (if needed) + untar. */
export function unpackTarGz(bytes: Uint8Array): TarEntry[] {
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const isZlib = bytes[0] === 0x78;
  const tar = isGzip || isZlib ? inflate(bytes) : bytes;
  return untar(tar);
}

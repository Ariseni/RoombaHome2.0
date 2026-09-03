/**
 * Minimal MQTT 3.1.1 packet encoder/decoder — only what the AWS IoT
 * shadow/cmd traffic needs. Pure Uint8Array, no Node stream deps, so it
 * runs identically under Hermes and Node.
 */
import { Buffer } from 'buffer';

export const enum PacketType {
  CONNECT = 1,
  CONNACK = 2,
  PUBLISH = 3,
  PUBACK = 4,
  SUBSCRIBE = 8,
  SUBACK = 9,
  UNSUBSCRIBE = 10,
  UNSUBACK = 11,
  PINGREQ = 12,
  PINGRESP = 13,
  DISCONNECT = 14,
}

export type Packet =
  | { type: PacketType.CONNACK; sessionPresent: boolean; returnCode: number }
  | { type: PacketType.PUBLISH; topic: string; payload: Uint8Array; qos: number; retain: boolean; dup: boolean; packetId?: number }
  | { type: PacketType.PUBACK; packetId: number }
  | { type: PacketType.SUBACK; packetId: number; returnCodes: number[] }
  | { type: PacketType.UNSUBACK; packetId: number }
  | { type: PacketType.PINGRESP }
  | { type: PacketType.PINGREQ }
  | { type: PacketType.DISCONNECT };

function utf8(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'utf8'));
}

function decodeUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

function encodeString(str: string): Uint8Array {
  const b = utf8(str);
  const out = new Uint8Array(2 + b.length);
  out[0] = (b.length >> 8) & 0xff;
  out[1] = b.length & 0xff;
  out.set(b, 2);
  return out;
}

function encodeRemainingLength(len: number): Uint8Array {
  const bytes: number[] = [];
  do {
    let digit = len % 128;
    len = Math.floor(len / 128);
    if (len > 0) digit |= 0x80;
    bytes.push(digit);
  } while (len > 0);
  return new Uint8Array(bytes);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function frame(typeAndFlags: number, body: Uint8Array): Uint8Array {
  return concat([new Uint8Array([typeAndFlags]), encodeRemainingLength(body.length), body]);
}

export interface ConnectOptions {
  clientId: string;
  keepalive: number; // seconds
  cleanSession?: boolean;
  username?: string;
  password?: string;
}

export function encodeConnect(o: ConnectOptions): Uint8Array {
  let flags = 0;
  if (o.cleanSession !== false) flags |= 0x02;
  if (o.username !== undefined) flags |= 0x80;
  if (o.password !== undefined) flags |= 0x40;
  const parts = [
    encodeString('MQTT'),
    new Uint8Array([4, flags, (o.keepalive >> 8) & 0xff, o.keepalive & 0xff]),
    encodeString(o.clientId),
  ];
  if (o.username !== undefined) parts.push(encodeString(o.username));
  if (o.password !== undefined) parts.push(encodeString(o.password));
  return frame(PacketType.CONNECT << 4, concat(parts));
}

export function encodePublish(topic: string, payload: Uint8Array, qos: 0 | 1, packetId?: number): Uint8Array {
  const parts = [encodeString(topic)];
  if (qos > 0) {
    if (packetId === undefined) throw new Error('packetId required for QoS>0');
    parts.push(new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]));
  }
  parts.push(payload);
  return frame((PacketType.PUBLISH << 4) | (qos << 1), concat(parts));
}

export function encodeSubscribe(packetId: number, topics: { topic: string; qos: 0 | 1 }[]): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff])];
  for (const t of topics) {
    parts.push(encodeString(t.topic), new Uint8Array([t.qos]));
  }
  return frame((PacketType.SUBSCRIBE << 4) | 0x02, concat(parts));
}

export function encodeUnsubscribe(packetId: number, topics: string[]): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff])];
  for (const t of topics) parts.push(encodeString(t));
  return frame((PacketType.UNSUBSCRIBE << 4) | 0x02, concat(parts));
}

export function encodePuback(packetId: number): Uint8Array {
  return new Uint8Array([PacketType.PUBACK << 4, 2, (packetId >> 8) & 0xff, packetId & 0xff]);
}

export function encodePingreq(): Uint8Array {
  return new Uint8Array([PacketType.PINGREQ << 4, 0]);
}

export function encodeDisconnect(): Uint8Array {
  return new Uint8Array([PacketType.DISCONNECT << 4, 0]);
}

/**
 * Incremental parser: feed() bytes as they arrive; complete packets are
 * returned. Partial packets are buffered until the rest arrives.
 */
export class PacketParser {
  private buf: Uint8Array = new Uint8Array(0);

  feed(chunk: Uint8Array): Packet[] {
    this.buf = this.buf.length === 0 ? chunk : concat([this.buf, chunk]);
    const out: Packet[] = [];
    for (;;) {
      const parsed = this.tryParseOne();
      if (!parsed) break;
      out.push(parsed.packet);
      this.buf = this.buf.subarray(parsed.consumed);
    }
    return out;
  }

  private tryParseOne(): { packet: Packet; consumed: number } | null {
    const b = this.buf;
    if (b.length < 2) return null;
    // remaining length varint
    let mult = 1;
    let len = 0;
    let i = 1;
    for (;;) {
      if (i >= b.length) return null;
      const d = b[i++];
      len += (d & 0x7f) * mult;
      if ((d & 0x80) === 0) break;
      mult *= 128;
      if (mult > 128 * 128 * 128) throw new Error('Malformed remaining length');
    }
    if (b.length < i + len) return null;
    const body = b.subarray(i, i + len);
    const type = b[0] >> 4;
    const flags = b[0] & 0x0f;
    return { packet: decodeBody(type, flags, body), consumed: i + len };
  }
}

function readU16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

function decodeBody(type: number, flags: number, body: Uint8Array): Packet {
  switch (type) {
    case PacketType.CONNACK:
      return { type, sessionPresent: (body[0] & 1) === 1, returnCode: body[1] };
    case PacketType.PUBLISH: {
      const qos = (flags >> 1) & 0x03;
      const topicLen = readU16(body, 0);
      const topic = decodeUtf8(body.subarray(2, 2 + topicLen));
      let o = 2 + topicLen;
      let packetId: number | undefined;
      if (qos > 0) {
        packetId = readU16(body, o);
        o += 2;
      }
      return { type, topic, payload: body.subarray(o), qos, retain: (flags & 1) === 1, dup: (flags & 8) === 8, packetId };
    }
    case PacketType.PUBACK:
      return { type, packetId: readU16(body, 0) };
    case PacketType.SUBACK:
      return { type, packetId: readU16(body, 0), returnCodes: Array.from(body.subarray(2)) };
    case PacketType.UNSUBACK:
      return { type, packetId: readU16(body, 0) };
    case PacketType.PINGRESP:
      return { type };
    case PacketType.PINGREQ:
      return { type };
    case PacketType.DISCONNECT:
      return { type };
    default:
      throw new Error(`Unsupported MQTT packet type ${type}`);
  }
}

export function payloadToString(payload: Uint8Array): string {
  return decodeUtf8(payload);
}

export function stringToPayload(s: string): Uint8Array {
  return utf8(s);
}

/** MQTT topic filter matching with `+` and `#` wildcards. */
export function topicMatches(filter: string, topic: string): boolean {
  if (filter === topic) return true;
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

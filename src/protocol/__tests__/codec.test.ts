import { describe, expect, it } from 'vitest';

import {
  PacketParser,
  PacketType,
  encodeConnect,
  encodePingreq,
  encodePuback,
  encodePublish,
  encodeSubscribe,
  payloadToString,
  stringToPayload,
  topicMatches,
} from '../mqtt/codec';

describe('mqtt codec', () => {
  it('encodes CONNECT per MQTT 3.1.1', () => {
    const b = encodeConnect({ clientId: 'abc', keepalive: 60 });
    expect(b[0]).toBe(0x10);
    // remaining length: 10 (var header) + 2 + 3 (client id)
    expect(b[1]).toBe(15);
    expect(Array.from(b.subarray(2, 8))).toEqual([0, 4, 0x4d, 0x51, 0x54, 0x54]); // "MQTT"
    expect(b[8]).toBe(4); // level
    expect(b[9]).toBe(0x02); // clean session
    expect((b[10] << 8) | b[11]).toBe(60);
  });

  it('round-trips PUBLISH QoS1 and PUBACK', () => {
    const payload = stringToPayload(JSON.stringify({ command: 'find', time: 1, initiator: 'localApp' }));
    const bytes = encodePublish('v011/things/X/cmd', payload, 1, 42);
    const parser = new PacketParser();
    const packets = parser.feed(bytes);
    expect(packets).toHaveLength(1);
    const p = packets[0];
    expect(p.type).toBe(PacketType.PUBLISH);
    if (p.type === PacketType.PUBLISH) {
      expect(p.topic).toBe('v011/things/X/cmd');
      expect(p.qos).toBe(1);
      expect(p.packetId).toBe(42);
      expect(JSON.parse(payloadToString(p.payload)).command).toBe('find');
    }
    const ack = parser.feed(encodePuback(42));
    expect(ack[0]).toEqual({ type: PacketType.PUBACK, packetId: 42 });
  });

  it('handles fragmented and coalesced frames', () => {
    const a = encodePublish('t/a', stringToPayload('x'.repeat(300)), 0);
    const b = encodePingreq();
    const all = new Uint8Array(a.length + b.length);
    all.set(a, 0);
    all.set(b, a.length);
    const parser = new PacketParser();
    expect(parser.feed(all.subarray(0, 5))).toHaveLength(0);
    expect(parser.feed(all.subarray(5, 200))).toHaveLength(0);
    const rest = parser.feed(all.subarray(200));
    expect(rest.map((p) => p.type)).toEqual([PacketType.PUBLISH, PacketType.PINGREQ]);
  });

  it('encodes SUBSCRIBE with qos bytes', () => {
    const b = encodeSubscribe(7, [{ topic: 'a/b', qos: 0 }]);
    expect(b[0]).toBe(0x82);
    expect(Array.from(b.subarray(2))).toEqual([0, 7, 0, 3, 0x61, 0x2f, 0x62, 0]);
  });

  it('matches wildcards', () => {
    expect(topicMatches('p/things/X/dock/+/report', 'p/things/X/dock/paddry/report')).toBe(true);
    expect(topicMatches('p/things/X/dock/+/report', 'p/things/X/dock/paddry/other')).toBe(false);
    expect(topicMatches('#', '$aws/things/x/shadow/get/accepted')).toBe(true);
    expect(topicMatches('a/b', 'a/b/c')).toBe(false);
  });
});

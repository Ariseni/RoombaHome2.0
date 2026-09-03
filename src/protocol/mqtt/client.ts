import { MqttError } from '../errors';
import type { ConnectionToken, MqttMessage } from '../types';
import {
  PacketParser,
  PacketType,
  encodeConnect,
  encodeDisconnect,
  encodePingreq,
  encodePuback,
  encodePublish,
  encodeSubscribe,
  encodeUnsubscribe,
  payloadToString,
  stringToPayload,
  topicMatches,
} from './codec';

/** Subset of the WHATWG/RN/ws WebSocket surface this client uses. */
export interface WebSocketLike {
  binaryType: string;
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (
  url: string,
  protocols: string[],
  options: { headers: Record<string, string> },
) => WebSocketLike;

export type AuthMode = 'headers' | 'query';

export interface MqttClientOptions {
  endpoint: string; // e.g. a2uowfjvhio0fa-ats.iot.us-east-1.amazonaws.com
  token: ConnectionToken;
  createSocket: WebSocketFactory;
  /** Custom-authorizer values as WS upgrade headers (default) or query params. */
  authMode?: AuthMode;
  keepaliveSeconds?: number;
  connectTimeoutMs?: number;
  /** Optional extra WS header, e.g. a User-Agent. Off by default. */
  extraHeaders?: Record<string, string>;
  log?: (msg: string, ...args: unknown[]) => void;
}

type MessageHandler = (msg: MqttMessage) => void;

interface Pending<T> {
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CONNACK_ERRORS: Record<number, string> = {
  1: 'unacceptable protocol version',
  2: 'identifier rejected',
  3: 'server unavailable',
  4: 'bad user name or password',
  5: 'not authorized',
};

/**
 * MQTT 3.1.1 over WebSocket for AWS IoT Core with iRobot's custom
 * authorizer. One instance = one connection; the session manager creates
 * a fresh one whenever the token is refreshed.
 */
export class MqttClient {
  private ws: WebSocketLike | null = null;
  private parser = new PacketParser();
  private nextPacketId = 1;
  private pendingAcks = new Map<number, Pending<void>>();
  private pendingSubs = new Map<number, Pending<number[]>>();
  private handlers: { filter: string; handler: MessageHandler }[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingOutstanding = false;
  private connected = false;
  private closedByUs = false;
  private readonly keepalive: number;
  private readonly log: (msg: string, ...args: unknown[]) => void;

  onClose: ((reason: string, deliberate: boolean) => void) | null = null;
  onError: ((err: Error) => void) | null = null;

  constructor(private readonly opts: MqttClientOptions) {
    this.keepalive = opts.keepaliveSeconds ?? 60;
    this.log = opts.log ?? (() => {});
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get clientId(): string {
    return this.opts.token.clientId;
  }

  buildUrl(): string {
    const base = `wss://${this.opts.endpoint}:443/mqtt`;
    if ((this.opts.authMode ?? 'headers') === 'query') {
      const t = this.opts.token;
      const q = new URLSearchParams({
        'x-amz-customauthorizer-name': t.iotAuthorizerName,
        'x-amz-customauthorizer-signature': t.iotSignature,
        'x-irobot-auth': t.iotToken,
      });
      return `${base}?${q.toString()}`;
    }
    return base;
  }

  buildHeaders(): Record<string, string> {
    const t = this.opts.token;
    const headers: Record<string, string> = { ...(this.opts.extraHeaders ?? {}) };
    if ((this.opts.authMode ?? 'headers') === 'headers') {
      headers['X-Amz-CustomAuthorizer-Name'] = t.iotAuthorizerName;
      headers['X-Amz-CustomAuthorizer-Signature'] = t.iotSignature;
      headers['x-irobot-auth'] = t.iotToken;
    }
    return headers;
  }

  connect(): Promise<void> {
    if (this.ws) return Promise.reject(new MqttError('connect() called twice'));
    const timeoutMs = this.opts.connectTimeoutMs ?? 15000;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.teardown();
        reject(err);
      };
      const timer = setTimeout(() => fail(new MqttError(`MQTT connect timed out after ${timeoutMs}ms`)), timeoutMs);

      let ws: WebSocketLike;
      try {
        ws = this.opts.createSocket(this.buildUrl(), ['mqtt'], { headers: this.buildHeaders() });
      } catch (e) {
        fail(e instanceof Error ? e : new MqttError(String(e)));
        return;
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        this.log('ws open, sending CONNECT clientId=%s', this.opts.token.clientId);
        this.send(encodeConnect({ clientId: this.opts.token.clientId, keepalive: this.keepalive, cleanSession: true }));
      };
      ws.onerror = (ev) => {
        const msg = (ev as { message?: string })?.message ?? 'websocket error';
        this.log('ws error: %s', msg);
        if (!settled) fail(new MqttError(`WebSocket error: ${msg}`));
        else this.onError?.(new MqttError(msg));
      };
      ws.onclose = (ev) => {
        const reason = `ws closed code=${ev?.code ?? '?'} reason=${ev?.reason ?? ''}`;
        this.log(reason);
        const deliberate = this.closedByUs;
        const wasConnected = this.connected;
        this.teardown();
        if (!settled) fail(new MqttError(`Connection closed before CONNACK (${reason})`));
        else if (wasConnected || !deliberate) this.onClose?.(reason, deliberate);
      };
      ws.onmessage = (ev) => {
        let bytes: Uint8Array;
        const d = ev.data;
        if (d instanceof ArrayBuffer) bytes = new Uint8Array(d);
        else if (d instanceof Uint8Array) bytes = d;
        else if (ArrayBuffer.isView(d)) bytes = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
        else {
          this.log('ignoring non-binary ws frame');
          return;
        }
        let packets;
        try {
          packets = this.parser.feed(bytes);
        } catch (e) {
          this.onError?.(e instanceof Error ? e : new MqttError(String(e)));
          this.close();
          return;
        }
        for (const p of packets) {
          if (p.type === PacketType.CONNACK) {
            if (p.returnCode !== 0) {
              fail(new MqttError(`CONNACK refused: ${CONNACK_ERRORS[p.returnCode] ?? p.returnCode}`));
              return;
            }
            this.connected = true;
            settled = true;
            clearTimeout(timer);
            this.startPing();
            resolve();
          } else {
            this.handlePacket(p);
          }
        }
      };
    });
  }

  private handlePacket(p: ReturnType<PacketParser['feed']>[number]): void {
    switch (p.type) {
      case PacketType.PUBLISH: {
        if (p.qos === 1 && p.packetId !== undefined) this.send(encodePuback(p.packetId));
        let json: unknown | null = null;
        try {
          json = JSON.parse(payloadToString(p.payload));
        } catch {
          json = null;
        }
        const msg: MqttMessage = { topic: p.topic, json, raw: p.payload };
        for (const h of this.handlers) {
          if (topicMatches(h.filter, p.topic)) {
            try {
              h.handler(msg);
            } catch (e) {
              this.log('handler error on %s: %s', p.topic, e);
            }
          }
        }
        break;
      }
      case PacketType.PUBACK: {
        const pend = this.pendingAcks.get(p.packetId);
        if (pend) {
          this.pendingAcks.delete(p.packetId);
          clearTimeout(pend.timer);
          pend.resolve();
        }
        break;
      }
      case PacketType.SUBACK: {
        const pend = this.pendingSubs.get(p.packetId);
        if (pend) {
          this.pendingSubs.delete(p.packetId);
          clearTimeout(pend.timer);
          pend.resolve(p.returnCodes);
        }
        break;
      }
      case PacketType.UNSUBACK: {
        const pend = this.pendingAcks.get(p.packetId);
        if (pend) {
          this.pendingAcks.delete(p.packetId);
          clearTimeout(pend.timer);
          pend.resolve();
        }
        break;
      }
      case PacketType.PINGRESP:
        this.pingOutstanding = false;
        break;
      default:
        break;
    }
  }

  private startPing(): void {
    this.stopPing();
    const intervalMs = Math.max(5, Math.floor(this.keepalive * 0.75)) * 1000;
    this.pingTimer = setInterval(() => {
      if (this.pingOutstanding) {
        this.log('ping timeout, closing');
        this.onError?.(new MqttError('Keepalive timeout'));
        this.close(false);
        return;
      }
      this.pingOutstanding = true;
      this.send(encodePingreq());
    }, intervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.pingOutstanding = false;
  }

  private send(bytes: Uint8Array): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) throw new MqttError('Socket not open');
    // Copy into a standalone ArrayBuffer: RN WebSocket rejects views with offsets.
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    ws.send(ab);
  }

  private allocPacketId(): number {
    const id = this.nextPacketId;
    this.nextPacketId = this.nextPacketId >= 65535 ? 1 : this.nextPacketId + 1;
    return id;
  }

  private assertConnected(): void {
    if (!this.connected || !this.ws) throw new MqttError('Not connected');
  }

  /** Publish; QoS 1 resolves when the broker sends PUBACK. */
  publish(topic: string, payload: string | Uint8Array | object, qos: 0 | 1 = 1, timeoutMs = 8000): Promise<void> {
    this.assertConnected();
    const bytes =
      payload instanceof Uint8Array
        ? payload
        : stringToPayload(typeof payload === 'string' ? payload : JSON.stringify(payload));
    if (qos === 0) {
      this.send(encodePublish(topic, bytes, 0));
      return Promise.resolve();
    }
    const id = this.allocPacketId();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(id);
        reject(new MqttError(`No PUBACK for ${topic} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingAcks.set(id, { resolve, reject, timer });
      try {
        this.send(encodePublish(topic, bytes, 1, id));
      } catch (e) {
        clearTimeout(timer);
        this.pendingAcks.delete(id);
        reject(e as Error);
      }
    });
  }

  /** Subscribe to explicit topics; rejects if the broker refuses any of them. */
  subscribe(topics: string[], qos: 0 | 1 = 0, timeoutMs = 8000): Promise<void> {
    this.assertConnected();
    if (topics.length === 0) return Promise.resolve();
    const id = this.allocPacketId();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSubs.delete(id);
        reject(new MqttError(`No SUBACK for ${topics.join(',')} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingSubs.set(id, {
        resolve: (codes) => {
          const refused = topics.filter((_, i) => (codes[i] ?? 0x80) >= 0x80);
          if (refused.length) reject(new MqttError(`Subscription refused: ${refused.join(', ')}`));
          else resolve();
        },
        reject,
        timer,
      });
      try {
        this.send(encodeSubscribe(id, topics.map((t) => ({ topic: t, qos }))));
      } catch (e) {
        clearTimeout(timer);
        this.pendingSubs.delete(id);
        reject(e as Error);
      }
    });
  }

  unsubscribe(topics: string[], timeoutMs = 8000): Promise<void> {
    this.assertConnected();
    if (topics.length === 0) return Promise.resolve();
    const id = this.allocPacketId();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(id);
        reject(new MqttError('No UNSUBACK'));
      }, timeoutMs);
      this.pendingAcks.set(id, { resolve, reject, timer });
      this.send(encodeUnsubscribe(id, topics));
    });
  }

  /** Register a message handler for a topic filter. Returns an unregister fn. */
  on(filter: string, handler: MessageHandler): () => void {
    const entry = { filter, handler };
    this.handlers.push(entry);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== entry);
    };
  }

  close(deliberate = true): void {
    this.closedByUs = deliberate;
    const ws = this.ws;
    if (ws && ws.readyState === 1) {
      try {
        if (this.connected) this.send(encodeDisconnect());
      } catch {
        /* ignore */
      }
      try {
        ws.close(1000, 'client close');
      } catch {
        /* ignore */
      }
    }
    if (ws && ws.readyState !== 1) this.teardown();
  }

  private teardown(): void {
    this.stopPing();
    this.connected = false;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        if (ws.readyState === 0 || ws.readyState === 1) ws.close();
      } catch {
        /* ignore */
      }
    }
    const err = new MqttError('Connection closed');
    for (const p of this.pendingAcks.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    for (const p of this.pendingSubs.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pendingAcks.clear();
    this.pendingSubs.clear();
    this.parser = new PacketParser();
  }
}

import { ShadowError } from '../errors';
import type { JsonObject } from '../types';
import type { MqttClient } from './client';
import { shadowTopics } from './topics';

export interface ShadowDocument {
  state?: { reported?: JsonObject; desired?: JsonObject; delta?: JsonObject };
  metadata?: JsonObject;
  version?: number;
  timestamp?: number;
  clientToken?: string;
  [key: string]: unknown;
}

/**
 * Request/response helper for AWS IoT device shadows. Subscribes to the
 * accepted/rejected topics once per shadow and serialises GETs so a
 * response is always matched to its request.
 */
export class ShadowReader {
  private subscribed = new Set<string>();
  private queues = new Map<string, ((doc: ShadowDocument | Error) => void)[]>();
  private chain = Promise.resolve();

  constructor(
    private readonly client: MqttClient,
    private readonly blid: string,
  ) {
    client.on(`$aws/things/${blid}/shadow/get/accepted`, (m) => this.deliver(null, m.json));
    client.on(`$aws/things/${blid}/shadow/get/rejected`, (m) => this.deliver(null, new ShadowError(`GET rejected: ${JSON.stringify(m.json)}`)));
    client.on(`$aws/things/${blid}/shadow/name/+/get/accepted`, (m) => this.deliver(nameFromTopic(m.topic), m.json));
    client.on(`$aws/things/${blid}/shadow/name/+/get/rejected`, (m) =>
      this.deliver(nameFromTopic(m.topic), new ShadowError(`GET ${nameFromTopic(m.topic)} rejected: ${JSON.stringify(m.json)}`)),
    );
  }

  private key(named: string | null): string {
    return named ?? '';
  }

  private deliver(named: string | null, payload: unknown): void {
    const q = this.queues.get(this.key(named));
    const waiter = q?.shift();
    if (!waiter) return;
    waiter(payload instanceof Error ? payload : (payload as ShadowDocument));
  }

  private async ensureSubscribed(named: string | null): Promise<void> {
    const topics = [shadowTopics.getAccepted(this.blid, named), shadowTopics.getRejected(this.blid, named)].filter(
      (t) => !this.subscribed.has(t),
    );
    if (topics.length === 0) return;
    await this.client.subscribe(topics, 0);
    for (const t of topics) this.subscribed.add(t);
  }

  /** Resets subscription bookkeeping after a reconnect (new MQTT client). */
  reset(): void {
    this.subscribed.clear();
    for (const q of this.queues.values()) for (const w of q) w(new ShadowError('Connection replaced'));
    this.queues.clear();
  }

  get(named: string | null = null, timeoutMs = 8000): Promise<ShadowDocument> {
    const run = async (): Promise<ShadowDocument> => {
      await this.ensureSubscribed(named);
      const k = this.key(named);
      const result = new Promise<ShadowDocument>((resolve, reject) => {
        const q = this.queues.get(k) ?? [];
        this.queues.set(k, q);
        const timer = setTimeout(() => {
          const idx = q.indexOf(waiter);
          if (idx >= 0) q.splice(idx, 1);
          reject(new ShadowError(`No response to GET ${named ?? 'classic'} shadow within ${timeoutMs}ms`));
        }, timeoutMs);
        const waiter = (doc: ShadowDocument | Error) => {
          clearTimeout(timer);
          if (doc instanceof Error) reject(doc);
          else resolve(doc);
        };
        q.push(waiter);
      });
      await this.client.publish(shadowTopics.get(this.blid, named), '', 1);
      return result;
    };
    // Serialise per reader so responses match requests in order.
    const p = this.chain.then(run, run);
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  /** Writes state.desired to a named shadow (e.g. rw-settings). */
  async update(named: string | null, desired: JsonObject): Promise<void> {
    await this.client.publish(shadowTopics.update(this.blid, named), { state: { desired } }, 1);
  }
}

function nameFromTopic(topic: string): string | null {
  const m = /shadow\/name\/([^/]+)\//.exec(topic);
  return m ? m[1] : null;
}

export function reportedOf(doc: ShadowDocument | null | undefined): JsonObject {
  return (doc?.state?.reported as JsonObject) ?? {};
}

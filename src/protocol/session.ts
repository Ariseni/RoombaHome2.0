import { type CommandPayload, nowSeconds } from './commands';
import { Emitter } from './emitter';
import { AuthCredentialsError, MqttError } from './errors';
import { login, loginForRobot, tokenForRobot, tokenSecondsLeft } from './login';
import { type LiveMapMessage, parseLiveMapMessage } from './models/livemap';
import { type RobotState, emptyState, mergeReported } from './models/shadow';
import { type AuthMode, MqttClient, type WebSocketFactory } from './mqtt/client';
import { type ShadowDocument, ShadowReader, reportedOf } from './mqtt/shadow';
import { allDockReportTopics, irbtTopics, shadowTopics } from './mqtt/topics';
import { RestClient } from './rest';
import type { Credentials, JsonObject, LoginResult, MqttMessage, RobotLoginEntry } from './types';

export type ConnectionStatus = 'idle' | 'authenticating' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface SessionEvents extends Record<string, unknown> {
  status: { status: ConnectionStatus; error?: string };
  state: RobotState;
  message: MqttMessage;
  dockReport: { kind: string; payload: unknown };
  timeline: unknown;
  rejected: unknown;
  livemap: LiveMapMessage;
  login: LoginResult;
}

export interface SessionOptions {
  credentials: Credentials;
  /** Robot to control; defaults to the first robot on the account. */
  blid?: string;
  createSocket: WebSocketFactory;
  fetchImpl?: typeof fetch;
  authMode?: AuthMode;
  /** Refresh the token this many seconds before it expires. */
  refreshLeadSeconds?: number;
  log?: (msg: string, ...args: unknown[]) => void;
  /** Shadows to read on connect and watch for updates. */
  watchShadows?: (string | null)[];
}

const DEFAULT_WATCH: (string | null)[] = [null, 'ro-currentstate'];

/**
 * Owns one authenticated connection to one robot: login, MQTT, REST,
 * token refresh (re-login + seamless connection swap), reconnect with
 * backoff, and the state stream that the UI consumes.
 */
export class RobotSession extends Emitter<SessionEvents> {
  readonly blidHint: string | undefined;
  private loginResult: LoginResult | null = null;
  private deploymentId: string | null = null;
  private restBase: string | null = null;
  private robot: RobotLoginEntry | null = null;
  private client: MqttClient | null = null;
  private shadows: ShadowReader | null = null;
  private restClient: RestClient | null = null;
  private stateValue: RobotState = emptyState();
  private statusValue: ConnectionStatus = 'idle';
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private stopped = true;
  private liveMapTimer: ReturnType<typeof setInterval> | null = null;
  private liveMapUnsub: (() => void) | null = null;
  private readonly log: (msg: string, ...args: unknown[]) => void;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: SessionOptions) {
    super();
    this.blidHint = opts.blid;
    this.log = opts.log ?? (() => {});
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // --- public getters ------------------------------------------------------

  get state(): RobotState {
    return this.stateValue;
  }

  get status(): ConnectionStatus {
    return this.statusValue;
  }

  get robotInfo(): RobotLoginEntry | null {
    return this.robot;
  }

  get blid(): string {
    if (!this.robot) throw new Error('Not logged in');
    return this.robot.blid;
  }

  get rest(): RestClient {
    if (!this.restClient) throw new Error('Not logged in');
    return this.restClient;
  }

  get login(): LoginResult | null {
    return this.loginResult;
  }

  get irbtPrefix(): string {
    return this.loginResult?.irbtTopicPrefix ?? `${this.deploymentId ?? 'v011'}-irbthbu`;
  }

  get isConnected(): boolean {
    return this.client?.isConnected ?? false;
  }

  // --- lifecycle -------------------------------------------------------------

  async start(): Promise<void> {
    this.stopped = false;
    this.reconnectAttempt = 0;
    await this.establish(true);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.stopLiveMap();
    const c = this.client;
    this.client = null;
    c?.close(true);
    this.setStatus('idle');
  }

  private setStatus(status: ConnectionStatus, error?: string): void {
    this.statusValue = status;
    this.emit('status', { status, error });
  }

  private clearTimers(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.refreshTimer = null;
    this.reconnectTimer = null;
  }

  /** Login (if needed) and open a fresh MQTT connection, replacing any old one. */
  private async establish(initial: boolean): Promise<void> {
    if (this.stopped) return;
    try {
      this.setStatus(initial ? 'authenticating' : 'reconnecting');
      const { result, blid } = await loginForRobot(
        this.opts.credentials,
        this.blidHint,
        this.fetchImpl,
        this.deploymentId ?? undefined,
      );
      this.loginResult = result;
      this.deploymentId = result.deploymentId;
      this.emit('login', result);
      this.robot = result.robots[blid];

      if (!this.restClient || this.restBase !== result.httpBaseAuth) {
        this.restBase = result.httpBaseAuth;
        this.restClient = new RestClient(result.httpBaseAuth, result.credentials, this.fetchImpl, async () => {
          try {
            const r = await login(this.opts.credentials, this.fetchImpl, this.deploymentId ?? undefined);
            this.loginResult = r;
            return r.credentials;
          } catch {
            return null;
          }
        });
      } else {
        this.restClient.setCredentials(result.credentials);
      }

      this.setStatus('connecting');
      const token = tokenForRobot(result, blid);
      const client = new MqttClient({
        endpoint: result.mqttEndpoint,
        token,
        createSocket: this.opts.createSocket,
        authMode: this.opts.authMode,
        log: this.log,
      });
      await client.connect();
      if (this.stopped) {
        client.close(true);
        return;
      }

      // Swap in the new connection before tearing down the old one.
      const old = this.client;
      this.client = client;
      this.shadows = new ShadowReader(client, blid);
      this.wireHandlers(client, blid);
      client.onClose = (reason, deliberate) => {
        if (this.client !== client) return; // superseded connection
        if (deliberate || this.stopped) return;
        this.log('connection lost: %s', reason);
        this.scheduleReconnect();
      };
      client.onError = (err) => this.log('mqtt error: %s', err.message);
      old?.close(true);

      await this.subscribeAll(client, blid);
      this.setStatus('connected');
      this.reconnectAttempt = 0;
      this.scheduleRefresh(token);
      if (this.liveMapTimer) await this.subscribeLiveMap(client, blid);

      // Prime the state with a GET of each watched shadow.
      for (const named of this.opts.watchShadows ?? DEFAULT_WATCH) {
        this.shadows
          .get(named)
          .then((doc) => this.applyDocument(doc))
          .catch((e) => this.log('shadow get %s failed: %s', named ?? 'classic', (e as Error).message));
      }
    } catch (e) {
      const err = e as Error;
      this.log('establish failed: %s', err.message);
      if (err instanceof AuthCredentialsError) {
        this.setStatus('error', err.message);
        this.stopped = true;
        return;
      }
      this.setStatus('error', err.message);
      this.scheduleReconnect();
    }
  }

  private wireHandlers(client: MqttClient, blid: string): void {
    const prefix = this.irbtPrefix;
    client.on('#', (m) => this.emit('message', m));
    for (const named of this.opts.watchShadows ?? DEFAULT_WATCH) {
      client.on(shadowTopics.updateAccepted(blid, named), (m) => this.applyDocument(m.json as ShadowDocument));
      client.on(shadowTopics.updateDelta(blid, named), () => {
        // A delta means desired != reported; reported will follow on update/accepted.
      });
    }
    client.on(irbtTopics.missionTimelineReport(prefix, blid), (m) => this.emit('timeline', m.json));
    client.on(irbtTopics.rejectedReport(prefix, blid), (m) => this.emit('rejected', m.json));
    client.on(irbtTopics.evacReport(prefix, blid), (m) => this.emit('dockReport', { kind: 'evac', payload: m.json }));
    client.on(`${prefix}/things/${blid}/dock/+/report`, (m) => {
      const kind = m.topic.split('/').slice(-2)[0];
      this.emit('dockReport', { kind, payload: m.json });
    });
  }

  private async subscribeAll(client: MqttClient, blid: string): Promise<void> {
    const prefix = this.irbtPrefix;
    const topics: string[] = [];
    for (const named of this.opts.watchShadows ?? DEFAULT_WATCH) {
      topics.push(shadowTopics.updateAccepted(blid, named), shadowTopics.updateDelta(blid, named));
    }
    // Subscribe in small groups so one refused topic does not sink the rest.
    await this.subscribeTolerant(client, topics);
    await this.subscribeTolerant(client, [
      irbtTopics.missionTimelineReport(prefix, blid),
      irbtTopics.rejectedReport(prefix, blid),
    ]);
    await this.subscribeTolerant(client, allDockReportTopics(prefix, blid));
  }

  private async subscribeTolerant(client: MqttClient, topics: string[]): Promise<void> {
    try {
      await client.subscribe(topics, 0);
    } catch (e) {
      this.log('subscribe group failed (%s), retrying individually', (e as Error).message);
      for (const t of topics) {
        try {
          await client.subscribe([t], 0);
        } catch (e2) {
          this.log('subscribe %s refused: %s', t, (e2 as Error).message);
        }
      }
    }
  }

  private applyDocument(doc: ShadowDocument | null): void {
    const reported = reportedOf(doc);
    if (Object.keys(reported).length === 0) return;
    this.stateValue = mergeReported(this.stateValue, reported);
    this.emit('state', this.stateValue);
  }

  private scheduleRefresh(token: { expires: number | null }): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const lead = this.opts.refreshLeadSeconds ?? 60;
    const left = tokenSecondsLeft(token as never);
    // Token lifetime is ~5 min; if unknown, refresh every 4 min like the app.
    const delay = Math.max(15, (left ?? 300) - lead);
    this.log('token refresh in %ds', delay);
    this.refreshTimer = setTimeout(() => {
      this.establish(false).catch(() => undefined);
    }, delay * 1000);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(60000, 1000 * 2 ** Math.min(this.reconnectAttempt, 6));
    this.reconnectAttempt++;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.establish(false).catch(() => undefined);
    }, delay);
  }

  // --- robot operations --------------------------------------------------------

  private requireClient(): MqttClient {
    if (!this.client || !this.client.isConnected) throw new MqttError('Not connected to the robot');
    return this.client;
  }

  /** Publishes to the cmd topic; resolves when the broker ACKs. */
  async sendCommand(payload: CommandPayload): Promise<void> {
    const client = this.requireClient();
    const body = { ...payload, time: payload.time ?? nowSeconds() };
    this.log('cmd -> %s', JSON.stringify(body));
    await client.publish(irbtTopics.cmd(this.irbtPrefix, this.blid), body, 1);
  }

  getShadow(named: string | null = null, timeoutMs = 8000): Promise<ShadowDocument> {
    if (!this.shadows) throw new MqttError('Not connected');
    return this.shadows.get(named, timeoutMs);
  }

  async refreshState(): Promise<void> {
    for (const named of this.opts.watchShadows ?? DEFAULT_WATCH) {
      try {
        this.applyDocument(await this.getShadow(named));
      } catch (e) {
        this.log('refresh %s failed: %s', named ?? 'classic', (e as Error).message);
      }
    }
  }

  /** Writes a setting into rw-settings (one key, one value). */
  async setSetting(key: string, value: unknown): Promise<void> {
    if (!this.shadows) throw new MqttError('Not connected');
    const desired: JsonObject = {};
    if (key.includes('.')) {
      const [outer, inner] = key.split('.', 2);
      desired[outer] = { [inner]: value };
    } else desired[key] = value;
    await this.shadows.update('rw-settings', desired);
  }

  /** Subscribe to an arbitrary topic and forward messages. */
  async watchTopic(topic: string, handler: (m: MqttMessage) => void): Promise<() => void> {
    const client = this.requireClient();
    const off = client.on(topic, handler);
    await client.subscribe([topic], 0);
    return off;
  }

  // --- live map ---------------------------------------------------------------

  async startLiveMap(keepAliveMs = 10000): Promise<void> {
    if (this.liveMapTimer) return;
    const client = this.requireClient();
    await this.subscribeLiveMap(client, this.blid);
    const ping = async () => {
      try {
        await this.rest.getLiveMapStream(this.blid);
      } catch (e) {
        this.log('livemap keep-alive failed: %s', (e as Error).message);
      }
    };
    await ping();
    this.liveMapTimer = setInterval(ping, keepAliveMs);
  }

  private async subscribeLiveMap(client: MqttClient, blid: string): Promise<void> {
    const topic = irbtTopics.livemapUpdate(this.irbtPrefix, blid);
    this.liveMapUnsub?.();
    this.liveMapUnsub = client.on(topic, (m) => {
      if (m.json && typeof m.json === 'object') {
        const parsed = parseLiveMapMessage(m.json as JsonObject);
        if (parsed) this.emit('livemap', parsed);
      }
    });
    await this.subscribeTolerant(client, [topic]);
  }

  stopLiveMap(): void {
    if (this.liveMapTimer) clearInterval(this.liveMapTimer);
    this.liveMapTimer = null;
    this.liveMapUnsub?.();
    this.liveMapUnsub = null;
  }
}

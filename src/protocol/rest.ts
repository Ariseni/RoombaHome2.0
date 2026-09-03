import { RestError } from './errors';
import { buildQueryString, signRequest } from './sigv4';
import type { CloudCredentials, JsonObject } from './types';

export interface ActiveMapVersion {
  p2map_id: string;
  active_p2mapv_id: string;
  name?: string;
  state?: string;
  visible?: boolean;
  robot_id?: string;
  sku?: string;
  create_time?: number;
  last_p2mapv_ts?: number;
  rooms_metadata?: JsonObject[];
  [key: string]: unknown;
}

export interface LiveMapStreamInit {
  mqtt_topic: string;
  livemap_url?: string;
  [key: string]: unknown;
}

export interface MissionHistoryQuery {
  maxReports?: number;
  maxAge?: number;
  filterType?: string;
  exclusiveStartTimestamp?: number;
  supportedDoneCodes?: string[];
}

/**
 * SigV4-signed REST client for the authenticated API (`httpBaseAuth`).
 * Credentials are swapped in by the session manager after each re-login.
 */
export class RestClient {
  private creds: CloudCredentials;

  constructor(
    private readonly baseUrl: string,
    creds: CloudCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly onForbidden?: () => Promise<CloudCredentials | null>,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.creds = creds;
  }

  setCredentials(creds: CloudCredentials): void {
    this.creds = creds;
  }

  // --- Maps -------------------------------------------------------------

  /** GET /v1/p2maps?robotId=..&visible=true */
  async getActiveMapVersions(blid: string): Promise<ActiveMapVersion[]> {
    const data = await this.request('GET', '/v1/p2maps', { robotId: blid, visible: 'true' });
    if (Array.isArray(data)) return data as ActiveMapVersion[];
    if (data && typeof data === 'object') {
      const obj = data as JsonObject;
      for (const k of ['p2maps', 'maps', 'items']) {
        if (Array.isArray(obj[k])) return obj[k] as ActiveMapVersion[];
      }
    }
    return [];
  }

  /** GET /v1/p2maps/{id} */
  getMapMetadata(p2mapId: string): Promise<JsonObject> {
    return this.request('GET', `/v1/p2maps/${enc(p2mapId)}`) as Promise<JsonObject>;
  }

  /** GET /v1/p2maps/{id}/versions/{vid} — region names live in geojson_details.regions */
  getMapVersion(p2mapId: string, versionId: string): Promise<JsonObject> {
    return this.request('GET', `/v1/p2maps/${enc(p2mapId)}/versions/${enc(versionId)}`) as Promise<JsonObject>;
  }

  /** GET .../versions/{vid}/geojson?response_type=link -> { map_url } */
  async getMapBundleUrl(p2mapId: string, versionId: string): Promise<string> {
    const data = (await this.request(
      'GET',
      `/v1/p2maps/${enc(p2mapId)}/versions/${enc(versionId)}/geojson`,
      { response_type: 'link' },
    )) as JsonObject;
    const url = data.map_url ?? data.url ?? data.link;
    if (typeof url !== 'string') throw new RestError('No map_url in geojson link response', 200, JSON.stringify(data));
    return url;
  }

  /** Presigned URL: no signing, no auth headers. */
  async downloadBundle(url: string): Promise<Uint8Array> {
    const resp = await this.fetchImpl(url);
    if (!resp.ok) throw new RestError(`Bundle download failed: HTTP ${resp.status}`, resp.status, '');
    return new Uint8Array(await resp.arrayBuffer());
  }

  /** POST /v1/p2maps/{id}/settings  {name} */
  setMapName(p2mapId: string, name: string): Promise<unknown> {
    return this.request('POST', `/v1/p2maps/${enc(p2mapId)}/settings`, undefined, { name });
  }

  /** GET /v1/p2maps/livemap?robotId=.. — also acts as the stream keep-alive. */
  getLiveMapStream(blid: string): Promise<LiveMapStreamInit> {
    return this.request('GET', '/v1/p2maps/livemap', { robotId: blid }) as Promise<LiveMapStreamInit>;
  }

  // --- Favorites / history / misc ---------------------------------------

  getFavorites(appEdition = '1'): Promise<unknown> {
    return this.request('GET', '/v1/user/favorites', { app_edition: appEdition });
  }

  createFavorite(body: unknown): Promise<JsonObject> {
    return this.request('POST', '/v1/user/favorites', { app_edition: '1' }, body) as Promise<JsonObject>;
  }

  updateFavorite(favoriteId: string, body: unknown): Promise<JsonObject> {
    return this.request('PUT', `/v1/user/favorites/${enc(favoriteId)}`, { app_edition: '1' }, body) as Promise<JsonObject>;
  }

  deleteFavorite(favoriteId: string): Promise<unknown> {
    return this.request('DELETE', `/v1/user/favorites/${enc(favoriteId)}`, { app_edition: '1' });
  }

  getUserHouseholds(): Promise<unknown> {
    return this.request('GET', '/v1/user/households');
  }

  getSchedules(householdId: string): Promise<unknown> {
    return this.request('GET', `/v1/households/${enc(householdId)}/settings/schedule`);
  }

  createSchedules(householdId: string, body: unknown): Promise<JsonObject> {
    return this.request('POST', `/v1/households/${enc(householdId)}/settings/schedule`, undefined, body) as Promise<JsonObject>;
  }

  updateSchedules(householdId: string, householdScheduleId: string, body: unknown): Promise<JsonObject> {
    return this.request(
      'PUT',
      `/v1/households/${enc(householdId)}/settings/schedule/${enc(householdScheduleId)}`,
      undefined,
      body,
    ) as Promise<JsonObject>;
  }

  deleteScheduleContainer(householdId: string, householdScheduleId: string): Promise<unknown> {
    return this.request('DELETE', `/v1/households/${enc(householdId)}/settings/schedule/${enc(householdScheduleId)}`);
  }

  getDndSettings(householdId: string): Promise<unknown> {
    return this.request('GET', `/v1/households/${enc(householdId)}/settings/dnd`);
  }

  setDndSettings(householdId: string, body: JsonObject): Promise<unknown> {
    return this.request('PUT', `/v1/households/${enc(householdId)}/settings/dnd`, undefined, body);
  }

  getMissionHistory(blid: string, q: MissionHistoryQuery = {}): Promise<unknown> {
    const query: Record<string, string> = {};
    if (q.maxReports != null) query.maxReports = String(q.maxReports);
    if (q.maxAge != null) query.maxAge = String(q.maxAge);
    if (q.filterType) query.filterType = q.filterType;
    if (q.exclusiveStartTimestamp != null) query.exclusiveStartTimestamp = String(q.exclusiveStartTimestamp);
    if (q.supportedDoneCodes?.length) query.supportedDoneCodes = q.supportedDoneCodes.join(',');
    return this.request('GET', `/v1/${enc(blid)}/missionhistory`, query);
  }

  getRobotParts(blid: string): Promise<JsonObject> {
    return this.request('GET', `/v1/robots/${enc(blid)}/parts`) as Promise<JsonObject>;
  }

  // --- Core -------------------------------------------------------------

  async request(
    method: string,
    path: string,
    query?: Record<string, string>,
    body?: unknown,
    retry = true,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const bodyStr = body === undefined ? '' : JSON.stringify(body);
    const headers = signRequest(this.creds, { method, url, query, body: bodyStr });
    const resp = await this.fetchImpl(url + buildQueryString(query), {
      method,
      headers,
      body: body === undefined ? undefined : bodyStr,
    });
    if (resp.status === 403 && retry && this.onForbidden) {
      const fresh = await this.onForbidden();
      if (fresh) {
        this.creds = fresh;
        return this.request(method, path, query, body, false);
      }
    }
    const text = await resp.text();
    if (!resp.ok) throw new RestError(`HTTP ${resp.status} ${method} ${path}`, resp.status, text);
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new RestError(`Non-JSON response from ${path}`, resp.status, text);
    }
  }
}

function enc(seg: string): string {
  return encodeURIComponent(seg);
}

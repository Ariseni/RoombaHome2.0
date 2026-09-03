import { Buffer } from 'buffer';

import { currentDeployment, discover, invalidateDiscovery, mqttEndpointOf } from './discovery';
import { AuthCredentialsError, AuthError, AuthRateLimitedError } from './errors';
import { gigyaLogin } from './gigya';
import type {
  CloudCredentials,
  ConnectionToken,
  Credentials,
  GigyaIdentity,
  JsonObject,
  LoginResult,
  RobotLoginEntry,
} from './types';

export const APP_ID = 'roombahome2';

/** Best-effort decode of the base64 JSON inside iot_token. */
function decodeIotToken(token: string): { expires_ts?: number; devices?: Record<string, number> } | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const start = json.indexOf('{');
    if (start < 0) return null;
    return JSON.parse(json.slice(start)) as { expires_ts?: number; devices?: Record<string, number> };
  } catch {
    return null;
  }
}

function parseConnectionToken(t: JsonObject): ConnectionToken {
  const iotToken = String(t.iot_token ?? '');
  const decoded = decodeIotToken(iotToken);
  const devices = Array.isArray(t.devices)
    ? (t.devices as unknown[]).map(String)
    : decoded?.devices
      ? Object.keys(decoded.devices)
      : [];
  const expiresRaw = t.expires ?? decoded?.expires_ts ?? null;
  return {
    clientId: String(t.client_id ?? t.iot_clientid ?? ''),
    iotToken,
    iotSignature: String(t.iot_signature ?? ''),
    iotAuthorizerName: String(t.iot_authorizer_name ?? ''),
    expires: typeof expiresRaw === 'number' ? expiresRaw : expiresRaw ? Number(expiresRaw) : null,
    devices,
  };
}

function parseCredentials(c: JsonObject, fallbackRegion: string | undefined): CloudCredentials {
  for (const k of ['AccessKeyId', 'SecretKey', 'SessionToken', 'CognitoId']) {
    if (!(k in c)) throw new AuthError(`Missing '${k}' in iRobot credentials`, c);
  }
  const cognitoId = String(c.CognitoId);
  const regionFromCognito = cognitoId.includes(':') ? cognitoId.split(':')[0] : undefined;
  return {
    accessKeyId: String(c.AccessKeyId),
    secretKey: String(c.SecretKey),
    sessionToken: String(c.SessionToken),
    expiration: c.Expiration ? String(c.Expiration) : null,
    cognitoId,
    region: regionFromCognito || fallbackRegion || 'us-east-1',
  };
}

function parseRobot(blid: string, r: JsonObject): RobotLoginEntry {
  return {
    blid,
    name: String(r.name ?? blid),
    sku: String(r.sku ?? ''),
    softwareVer: String(r.softwareVer ?? ''),
    password: typeof r.password === 'string' ? r.password : undefined,
    svcDeplId: typeof r.svcDeplId === 'string' ? r.svcDeplId : undefined,
    cap: (r.cap as Record<string, number>) ?? {},
    digiCap: (r.digiCap as Record<string, number>) ?? {},
    raw: r,
  };
}

async function irobotLogin(
  httpBase: string,
  gigya: GigyaIdentity,
  fetchImpl: typeof fetch,
): Promise<JsonObject> {
  const payload = {
    app_id: APP_ID,
    app_info: {
      device_id: APP_ID,
      device_name: 'android',
      language: 'en_US',
      version: '7.16.2',
    },
    assume_robot_ownership: '0',
    authorizer_params: { devices_per_token: 5 },
    gigya: { signature: gigya.signature, timestamp: gigya.timestamp, uid: gigya.uid },
    // Required: without it the response carries no connection_tokens.
    multiple_authorizer_token_support: true,
    push_info: {
      platform: 'APNS',
      push_token: '0'.repeat(64),
      supported_push_types: ['cr', 'cse', 'bf', 'ae', 'pm', 'te', 'dt'],
    },
    skip_ownership_check: '0',
  };
  const resp = await fetchImpl(`${httpBase}/v2/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  let data: JsonObject;
  try {
    data = JSON.parse(text) as JsonObject;
  } catch {
    throw new AuthError(`iRobot login returned non-JSON (HTTP ${resp.status})`, text);
  }
  if (data.errorCode) {
    const msg = String(data.errorMessage ?? JSON.stringify(data));
    if (msg.toLowerCase().includes('mqtt slot')) {
      throw new AuthRateLimitedError(
        `Too many active sessions. Close the official Roomba app and retry. (${msg})`,
        data,
      );
    }
    throw new AuthCredentialsError(`iRobot cloud login failed: ${msg}`, data);
  }
  if (!resp.ok) throw new AuthError(`iRobot login failed: HTTP ${resp.status}`, data);
  return data;
}

/**
 * Full chain: discovery -> Gigya -> /v2/login. Returns everything the
 * MQTT and REST clients need. Tokens expire in about five minutes, so
 * callers re-run this before then (see session.ts).
 */
export async function login(
  creds: Credentials,
  fetchImpl: typeof fetch = fetch,
  /** Deployment id (e.g. "v011") to log in against; defaults to discovery's current_deployment. */
  deploymentId?: string,
): Promise<LoginResult> {
  const disc = await discover(creds.countryCode, fetchImpl);
  const dep = (deploymentId && disc.deployments[deploymentId]) || currentDeployment(disc);
  const mqttEndpoint = mqttEndpointOf(dep);
  if (!dep.httpBaseAuth) throw new AuthError('No httpBaseAuth in discovery deployment', dep);

  let gigya: GigyaIdentity;
  try {
    gigya = await gigyaLogin(disc.gigya, creds.username, creds.password, fetchImpl);
  } catch (e) {
    // A rotated API key looks like a credentials failure; drop the cache
    // so the next attempt refetches discovery.
    invalidateDiscovery(creds.countryCode);
    throw e;
  }
  const raw = await irobotLogin(dep.httpBase, gigya, fetchImpl);

  const tokensRaw = Array.isArray(raw.connection_tokens) ? (raw.connection_tokens as JsonObject[]) : [];
  let connectionTokens = tokensRaw.map(parseConnectionToken);
  if (connectionTokens.length === 0 && raw.iot_token) {
    // Older response shape: a single token at the top level.
    connectionTokens = [
      parseConnectionToken({
        client_id: raw.iot_clientid,
        iot_token: raw.iot_token,
        iot_signature: raw.iot_signature,
        iot_authorizer_name: raw.iot_authorizer_name,
      }),
    ];
  }
  if (connectionTokens.length === 0) {
    throw new AuthError('Login succeeded but no connection tokens were returned', raw);
  }

  const credsRaw = raw.credentials as JsonObject | undefined;
  if (!credsRaw) throw new AuthError('No credentials in iRobot login response', raw);
  const credentials = parseCredentials(credsRaw, dep.awsRegion);

  const robotsRaw = (raw.robots as Record<string, JsonObject> | undefined) ?? {};
  const robots: Record<string, RobotLoginEntry> = {};
  for (const [blid, r] of Object.entries(robotsRaw)) robots[blid] = parseRobot(blid, r);

  return {
    mqttEndpoint,
    httpBase: dep.httpBase,
    httpBaseAuth: dep.httpBaseAuth,
    irbtTopicPrefix: dep.irbtTopics ?? `${dep.svcDeplId ?? 'v011'}-irbthbu`,
    iotTopicPrefix: dep.iotTopics ?? '$aws',
    credentials,
    connectionTokens,
    robots,
    raw,
    deployment: dep,
    deploymentId: dep.svcDeplId ?? deploymentId ?? disc.current_deployment,
    availableDeployments: Object.keys(disc.deployments),
    issuedAt: Date.now(),
  };
}

/**
 * Logs in, then — if the chosen robot lives on a different deployment than
 * the one used (Prime robots are typically on v011 while discovery's
 * current_deployment is v007) — logs in again against the robot's own
 * deployment so the topic prefix and REST base match the robot.
 */
export async function loginForRobot(
  creds: Credentials,
  blid: string | undefined,
  fetchImpl: typeof fetch = fetch,
  knownDeploymentId?: string,
): Promise<{ result: LoginResult; blid: string }> {
  let result = await login(creds, fetchImpl, knownDeploymentId);
  const chosen = blid ?? Object.keys(result.robots)[0];
  if (!chosen) throw new AuthCredentialsError('No robots on this account', result.raw);
  const robot = result.robots[chosen];
  if (!robot) {
    throw new AuthCredentialsError(`Robot ${chosen} not found on account`, Object.keys(result.robots));
  }
  const want = robot.svcDeplId;
  if (want && want !== result.deploymentId && result.availableDeployments.includes(want)) {
    result = await login(creds, fetchImpl, want);
  }
  return { result, blid: chosen };
}

/** The connection token that covers `blid`, falling back to the first. */
export function tokenForRobot(result: LoginResult, blid: string): ConnectionToken {
  return result.connectionTokens.find((t) => t.devices.includes(blid)) ?? result.connectionTokens[0];
}

/** Seconds until the token expires, or null if unknown. */
export function tokenSecondsLeft(token: ConnectionToken, now = Date.now()): number | null {
  if (token.expires == null) return null;
  return token.expires - Math.floor(now / 1000);
}

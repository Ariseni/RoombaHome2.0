import { AuthCredentialsError, AuthError } from './errors';
import type { GigyaIdentity } from './types';

/** The Roomba Home app's own user agent; Gigya rejects some defaults. */
const USER_AGENT = 'iRobot/7.16.2.140449 CFNetwork/1568.100.1.2.1 Darwin/24.0.0';

export interface GigyaConfig {
  api_key: string;
  datacenter_domain: string;
}

function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Step 2 of the login chain: authenticate the iRobot account against
 * Gigya (SAP CDC). Returns the UID + signature that /v2/login expects.
 */
export async function gigyaLogin(
  cfg: GigyaConfig,
  username: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GigyaIdentity> {
  const url = `https://accounts.${cfg.datacenter_domain}/accounts.login`;
  const body = formEncode({
    loginMode: 'standard',
    loginID: username,
    password,
    include: 'profile,data,emails,subscriptions,preferences,',
    includeUserInfo: 'true',
    targetEnv: 'mobile',
    source: 'showScreenSet',
    sdk: 'ios_swift_1.3.0',
    sessionExpiration: '-2',
    apikey: cfg.api_key,
  });

  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body,
  });
  const text = await resp.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AuthError(`Gigya returned non-JSON (HTTP ${resp.status})`, text);
  }
  const errorCode = Number(data.errorCode ?? 0);
  if (errorCode !== 0) {
    const msg = String(data.errorMessage ?? data.errorDetails ?? errorCode);
    // 403042 = invalid loginID or password; 403041 = account disabled, etc.
    throw new AuthCredentialsError(`Gigya login failed: ${msg}`, data);
  }
  const uid = data.UID as string | undefined;
  const signature = data.UIDSignature as string | undefined;
  const timestamp = data.signatureTimestamp as string | number | undefined;
  if (!uid || !signature || timestamp === undefined) {
    throw new AuthError('Gigya login response missing UID/signature', data);
  }
  return { uid, signature, timestamp: String(timestamp) };
}

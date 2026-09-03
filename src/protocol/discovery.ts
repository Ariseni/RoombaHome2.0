import { AuthError } from './errors';
import type { DiscoveryDeployment, DiscoveryResponse } from './types';

const DISCOVERY_URL = 'https://disc-prod.iot.irobotapi.com/v1/discover/endpoints';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map<string, { at: number; value: DiscoveryResponse }>();

export function discoveryUrl(countryCode: string): string {
  return `${DISCOVERY_URL}?country_code=${encodeURIComponent(countryCode.toUpperCase())}`;
}

/**
 * Fetches the per-country service configuration: Gigya API key, the
 * current deployment's HTTP and MQTT endpoints, and the topic prefixes.
 * The response is cached per country for a few hours (the Gigya API key
 * rotates rarely; a login failure invalidates the cache).
 */
export async function discover(
  countryCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveryResponse> {
  const key = countryCode.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const resp = await fetchImpl(discoveryUrl(key), {
    headers: { accept: 'application/json' },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new AuthError(`Discovery failed: HTTP ${resp.status}`, text);
  }
  let data: DiscoveryResponse;
  try {
    data = JSON.parse(text) as DiscoveryResponse;
  } catch {
    throw new AuthError('Discovery returned non-JSON', text);
  }
  if (!data.deployments || !data.current_deployment || !data.gigya) {
    throw new AuthError('Unexpected discovery response shape', data);
  }
  cache.set(key, { at: Date.now(), value: data });
  return data;
}

export function invalidateDiscovery(countryCode?: string): void {
  if (countryCode) cache.delete(countryCode.toUpperCase());
  else cache.clear();
}

export function currentDeployment(disc: DiscoveryResponse): DiscoveryDeployment {
  const dep = disc.deployments[disc.current_deployment];
  if (!dep) throw new AuthError(`Discovery has no deployment ${disc.current_deployment}`, disc);
  return dep;
}

export function mqttEndpointOf(dep: DiscoveryDeployment): string {
  const ep = dep.mqtt || dep.mqttApp || dep.mqttAts;
  if (!ep) throw new AuthError('No mqtt endpoint in discovery deployment', dep);
  return ep;
}

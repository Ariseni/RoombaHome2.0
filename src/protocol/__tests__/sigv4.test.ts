import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { awsUriEncode, signRequest } from '../sigv4';

const creds = {
  accessKeyId: 'AKIDEXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  sessionToken: 'SESSION',
  expiration: null,
  cognitoId: 'us-east-1:abc',
  region: 'us-east-1',
};

/** Independent reference implementation with Node's crypto. */
function reference(method: string, url: string, query: Record<string, string>, body: string, now: Date) {
  const u = new URL(url);
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = iso.slice(0, 8);
  const qs = Object.keys(query)
    .sort()
    .map((k) => `${awsUriEncode(k)}=${awsUriEncode(query[k])}`)
    .join('&');
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    host: u.host,
    'user-agent': 'aws-sdk-iOS/2.27.6 iOS/18.0.1 en_US',
    'x-amz-date': iso,
  };
  const keys = Object.keys(headers).sort();
  const canon = [
    method,
    u.pathname,
    qs,
    keys.map((k) => `${k}:${headers[k]}\n`).join(''),
    keys.join(';'),
    createHash('sha256').update(body).digest('hex'),
  ].join('\n');
  const scope = `${date}/us-east-1/execute-api/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', iso, scope, createHash('sha256').update(canon).digest('hex')].join('\n');
  let k: Buffer = createHmac('sha256', `AWS4${creds.secretKey}`).update(date).digest();
  k = createHmac('sha256', k).update('us-east-1').digest();
  k = createHmac('sha256', k).update('execute-api').digest();
  k = createHmac('sha256', k).update('aws4_request').digest();
  return createHmac('sha256', k).update(sts).digest('hex');
}

describe('sigv4', () => {
  it('matches an independent implementation for GET with query', () => {
    const now = new Date('2026-09-03T20:48:00Z');
    const url = 'https://auth3.prod.iot.irobotapi.com/v1/p2maps';
    const query = { robotId: 'ABC123', visible: 'true' };
    const h = signRequest(creds, { method: 'GET', url, query, now });
    const sig = /Signature=([0-9a-f]+)/.exec(h.Authorization)![1];
    expect(sig).toBe(reference('GET', url, query, '', now));
    expect(h['x-amz-security-token']).toBe('SESSION');
    expect(h['x-amz-date']).toBe('20260903T204800Z');
    expect(h.Authorization).toContain('Credential=AKIDEXAMPLE/20260903/us-east-1/execute-api/aws4_request');
  });

  it('matches for POST with body', () => {
    const now = new Date('2026-01-02T03:04:05Z');
    const url = 'https://auth3.prod.iot.irobotapi.com/v1/p2maps/abc-1/settings';
    const body = JSON.stringify({ name: 'Home' });
    const h = signRequest(creds, { method: 'POST', url, body, now });
    const sig = /Signature=([0-9a-f]+)/.exec(h.Authorization)![1];
    expect(sig).toBe(reference('POST', url, {}, body, now));
  });

  it('uri-encodes per RFC 3986', () => {
    expect(awsUriEncode("a b!*'()")).toBe('a%20b%21%2A%27%28%29');
  });
});

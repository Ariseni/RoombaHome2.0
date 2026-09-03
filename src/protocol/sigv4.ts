import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { CloudCredentials } from './types';

const USER_AGENT = 'aws-sdk-iOS/2.27.6 iOS/18.0.1 en_US';

/** RFC 3986 percent-encoding as SigV4 requires (encodes !'()* too). */
export function awsUriEncode(value: string, encodeSlash = true): string {
  let out = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  if (!encodeSlash) out = out.replace(/%2F/g, '/');
  return out;
}

function hmacBytes(key: Uint8Array, data: string): Uint8Array {
  return hmac(sha256, key, utf8ToBytes(data));
}

function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20260903T204800Z
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export interface SignInput {
  method: string;
  url: string; // full URL incl. path, without query
  query?: Record<string, string>;
  body?: string;
  service?: string;
  now?: Date;
}

/**
 * Produces the headers for an AWS SigV4-signed request against API
 * Gateway (`execute-api`), using the Cognito session credentials returned
 * by /v2/login. The body string must be sent byte-identical.
 */
export function signRequest(creds: CloudCredentials, input: SignInput): Record<string, string> {
  const u = new URL(input.url);
  const service = input.service ?? 'execute-api';
  const { amzDate: date, dateStamp } = amzDate(input.now ?? new Date());
  const body = input.body ?? '';

  const canonicalUri = u.pathname
    .split('/')
    .map((seg) => awsUriEncode(decodeURIComponent(seg)))
    .join('/');
  const query = input.query ?? {};
  const canonicalQs = Object.keys(query)
    .sort()
    .map((k) => `${awsUriEncode(k)}=${awsUriEncode(String(query[k]))}`)
    .join('&');

  const baseHeaders: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    host: u.host,
    'user-agent': USER_AGENT,
    'x-amz-date': date,
  };
  const signedKeys = Object.keys(baseHeaders).sort();
  const canonicalHeaders = signedKeys.map((k) => `${k}:${baseHeaders[k]}\n`).join('');
  const signedHeaders = signedKeys.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQs,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join('\n');

  const scope = `${dateStamp}/${creds.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256Hex(canonicalRequest)].join('\n');

  let key = hmacBytes(utf8ToBytes(`AWS4${creds.secretKey}`), dateStamp);
  key = hmacBytes(key, creds.region);
  key = hmacBytes(key, service);
  key = hmacBytes(key, 'aws4_request');
  const signature = bytesToHex(hmacBytes(key, stringToSign));

  return {
    ...baseHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-security-token': creds.sessionToken,
  };
}

export function buildQueryString(query: Record<string, string> | undefined): string {
  if (!query || Object.keys(query).length === 0) return '';
  return (
    '?' +
    Object.keys(query)
      .sort()
      .map((k) => `${awsUriEncode(k)}=${awsUriEncode(String(query[k]))}`)
      .join('&')
  );
}

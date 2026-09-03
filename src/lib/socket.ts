import type { WebSocketFactory, WebSocketLike } from '@/protocol/mqtt/client';

/**
 * React Native's WebSocket accepts a third `options` argument with custom
 * headers, which is what carries the AWS custom-authorizer values.
 */
export const createRNSocket: WebSocketFactory = (url, protocols, options) => {
  const RNWebSocket = WebSocket as unknown as new (
    url: string,
    protocols?: string[] | null,
    options?: { headers?: Record<string, string> },
  ) => WebSocketLike;
  return new RNWebSocket(url, protocols, { headers: options.headers });
};

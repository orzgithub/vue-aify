// Environment-agnostic transport contract.
//
// The OperationPlane is platform-independent; only the LAST MILE differs:
//   - Web: a WebSocket client that connects to a local Bridge.
//   - Desktop: an in-process registration with the Bridge (no network).
//
// Both consume the exact same OperationPlane interface, so the Bridge (and the
// MCP tools it exposes) is identical across platforms. This is the crux of the
// "web == desktop" isomorphism.

import type { OperationPlane } from '../core/types.ts';

export interface TransportAdapter {
  start(plane: OperationPlane): void;
  stop(): void;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * A transport the page can connect on demand. Unlike a plain TransportAdapter,
 * the page does NOT auto-connect: it stays `idle` until the USER submits a
 * connection credential (a base64 string carrying the url + token) via
 * `connect()`. This is the security boundary — no client can silently read the
 * page's data, and the user may point the connection at any host/port.
 */
export interface ConnectController extends TransportAdapter {
  /** User-triggered connect. `credential` is the base64 string from the bridge. */
  connect(credential: string): void;
  /** Close the current socket (user may reconnect later). */
  disconnect(): void;
  /** Current connection state. */
  status(): ConnectionStatus;
  /** Subscribe to status changes; returns an unsubscribe fn. */
  onStatus(cb: (s: ConnectionStatus, detail?: { error?: string }) => void): () => void;
}

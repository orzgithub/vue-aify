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

// Why these terminal statuses instead of a single 'error':
//   - `disconnected` = the transport has STOPPED trying and needs a human
//     (repaste credential / click retry). Each `reason` tells the UI what to do.
//   - `reconnecting` = a live session dropped transiently; the transport is
//     retrying on its own (exponential backoff, capped attempts).
export type DisconnectReason =
  | 'invalid-ticket' // server rejected the token (wrong key / store removed it)
  | 'handshake-failed' // socket opened but never got the `registered` ack (wrong URL / not our server)
  | 'expired' // ticket ttl passed before a reconnect could happen
  | 'gave-up' // transient drops exhausted the retry budget
  | 'closed' // graceful close from the bridge (e.g. you stopped the host)
  | 'manual'; // user clicked disconnect

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface StatusDetail {
  error?: string;
  reason?: DisconnectReason;
}

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
  onStatus(cb: (s: ConnectionStatus, detail?: StatusDetail) => void): () => void;
}

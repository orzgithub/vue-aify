// Web transport: a thin WebSocket client that connects the page to a Bridge.
// The Bridge is the thing that actually speaks MCP to the AI; the page only
// knows "send request id X, get back a plane result". No MCP, no routing, no JS
// execution awareness lives in the page.
//
// SECURITY MODEL (user-initiated connection):
//   - The page does NOT auto-connect and must NOT pre-know any URL. Stays idle.
//   - Only when the USER submits a connection credential (a base64 string the
//     bridge printed for them) does a socket open to the url INSIDE the
//     credential, presenting the credential's token.
//   - This is the boundary that stops a rogue client from silently reading the
//     page, and lets the user point the connection at any host/port.
//
// RECONNECT POLICY (the thing this file fixes):
//   - A *SPA route change* (router.push / <a router-link>) does NOT drop the
//     socket, so it needs no reconnect at all — the WS stays alive because the
//     page module is never destroyed.
//   - Only a *full page navigation* (real <a href>, location change, reload) or
//     a *real disconnect* tears the socket down.
//   - The drop is split into FATAL vs TRANSIENT:
//       FATAL (stop, ask the human): invalid/expired ticket, handshake never
//         completed (opened but no `registered` ack), graceful close from the
//         bridge, or the user clicking disconnect.
//       TRANSIENT (retry with backoff): a live `connected` session dropped
//         unexpectedly (code 1006 / no code / timeout). We retry exponentially
//         (1s,2s,4s,8s,16s + jitter), cap at MAX_ATTEMPTS, then give up and ask
//         the human to click retry. We never retry forever, and we re-check the
//         ticket expiry before each attempt.
//   - The bridge cooperates by sending a Close frame with code 4000 ("invalid
//     ticket") on a rejected register, and a normal 1000 close on shutdown.

import type { OperationPlane } from '../core/types.ts';
import type { ConnectController, ConnectionStatus, StatusDetail, DisconnectReason } from './types.ts';
import {
  decodeConnectionTicket,
  isConnectionTicketExpired,
  type ConnectTicket,
} from '../bridge/ticket.ts';

export interface WebSocketTransportOptions {
  /** Optional kind tag presented to the bridge. */
  kind?: string;
  /** Max transient-reconnect attempts before giving up (default 5). */
  maxReconnectAttempts?: number;
  /** Base backoff in ms for transient reconnects (default 1000). */
  reconnectBaseDelayMs?: number;
}

const REGISTERED_ACK = 'registered';
const FATAL_CLOSE_CODE = 4000; // bridge: token rejected / not our server
const MAX_BACKOFF_MS = 16000;

interface BridgeRequest {
  type: 'snapshot' | 'act' | 'map' | 'routine' | 'wait';
  id: string;
  actionId?: string;
  value?: string;
  node?: string;
  timeoutMs?: number;
}

export function createWebSocketTransport(
  options: WebSocketTransportOptions = {},
): ConnectController {
  const maxAttempts = options.maxReconnectAttempts ?? 5;
  const baseDelay = options.reconnectBaseDelayMs ?? 1000;

  let plane: OperationPlane | null = null;
  let ws: WebSocket | null = null;
  let status: ConnectionStatus = 'idle';
  let lastError: string | undefined;
  let lastTicket: ConnectTicket | null = null;
  // Set when the user (or app) deliberately tears the socket down, so an
  // onclose from that is treated as graceful, not a transient drop.
  let manualClose = false;
  // Set the moment the `registered` ack arrives; distinguishes "handshake never
  // completed" (opened but no registered ack) from "live session dropped".
  let registered = false;
  // Incremented on each transient reconnect attempt.
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const statusCbs = new Set<(s: ConnectionStatus, d?: StatusDetail) => void>();

  const setStatus = (s: ConnectionStatus, d?: StatusDetail) => {
    status = s;
    if (d?.error) lastError = d.error;
    for (const cb of statusCbs) cb(s, d);
  };

  const fail = (reason: DisconnectReason, error?: string) => {
    lastTicket = null; // credential is no longer usable; the user must repaste
    setStatus('disconnected', { reason, error });
  };

  const giveUp = () => {
    lastTicket = null;
    setStatus('disconnected', { reason: 'gave-up', error: 'reconnect failed after several attempts' });
  };

  // Exponential backoff with full jitter, capped.
  const scheduleReconnect = () => {
    if (!lastTicket) return;
    if (attempt >= maxAttempts) {
      giveUp();
      return;
    }
    if (isConnectionTicketExpired(lastTicket)) {
      fail('expired', 'connection ticket expired');
      return;
    }
    const exp = Math.min(baseDelay * 2 ** attempt, MAX_BACKOFF_MS);
    const delay = Math.round(exp / 2 + Math.random() * (exp / 2));
    attempt += 1;
    setStatus('reconnecting', { error: `connection lost; retrying (${attempt}/${maxAttempts})…` });
    retryTimer = setTimeout(() => open(lastTicket!), delay);
  };

  const open = (ticket: ConnectTicket) => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    manualClose = false;
    registered = false;
    setStatus(attempt > 0 ? 'reconnecting' : 'connecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(ticket.url);
    } catch (e) {
      setStatus('error', { error: (e as Error).message });
      return;
    }
    ws = socket;

    socket.onopen = () => {
      // Announce ourselves. The bridge replies with a `registered` text message
      // (handled in onmessage) to confirm the token was accepted; until then we
      // are not a live session, so a drop in this window is a FATAL handshake
      // failure, not a transient drop.
      socket.send(
        JSON.stringify({ type: 'register', token: ticket.token, kind: options.kind ?? 'web' }),
      );
    };
    socket.onmessage = async (ev: MessageEvent) => {
      // The registered ack is not a request; swallow it and flip to live.
      if (typeof ev.data === 'string' && ev.data.includes(REGISTERED_ACK)) {
        if (!registered) {
          registered = true;
          attempt = 0; // a fresh live session resets the retry budget
          setStatus('connected');
        }
        return;
      }
      if (!plane) return;
      let msg: BridgeRequest;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (!msg || !msg.id) return;
      try {
        let result: unknown;
        switch (msg.type) {
          case 'map':
            result = await plane.map();
            break;
          case 'routine':
            result = await plane.routine(msg.node);
            break;
          case 'snapshot':
            result = await plane.snapshot();
            break;
          case 'act':
            result = await plane.act(msg.actionId!, msg.value !== undefined ? { value: msg.value } : undefined);
            break;
          case 'wait':
            result = await plane.waitForUI(msg.timeoutMs);
            break;
          default:
            result = { error: 'unknown request' };
        }
        socket.send(JSON.stringify({ id: msg.id, result }));
      } catch (e) {
        socket.send(JSON.stringify({ id: msg.id, error: (e as Error).message }));
      }
    };
    socket.onclose = (ev: CloseEvent) => {
      ws = null;
      if (manualClose) {
        setStatus('idle');
        return;
      }
      // Bridge explicitly rejected this credential / target.
      if (ev.code === FATAL_CLOSE_CODE) {
        fail('invalid-ticket', 'bridge rejected the connection (wrong key or not our server)');
        return;
      }
      // Graceful close from the bridge (e.g. you stopped the host).
      if (ev.code === 1000 || ev.code === 1001) {
        setStatus('disconnected', { reason: 'closed' });
        return;
      }
      // We were a live session that dropped → transient; retry with backoff.
      if (registered) {
        scheduleReconnect();
        return;
      }
      // Socket opened but the bridge never sent the registered ack → the URL is
      // wrong or it isn't our server. FATAL.
      fail('handshake-failed', 'connected but handshake was never completed');
    };
    socket.onerror = () => {
      // onerror precedes onclose; let onclose decide. Surface a transient hint
      // only if we have not already settled into a terminal state.
      if (status === 'connecting' || status === 'reconnecting') {
        lastError = lastError ?? 'connection error';
      }
    };
  };

  return {
    start(p: OperationPlane) {
      plane = p;
      // NOTE: intentionally does NOT open a socket. The user must call connect().
    },
    connect(credential: string) {
      let ticket: ConnectTicket;
      try {
        ticket = decodeConnectionTicket(credential.trim());
      } catch (e) {
        setStatus('error', { error: (e as Error).message });
        return;
      }
      if (isConnectionTicketExpired(ticket)) {
        setStatus('error', { error: 'connection ticket expired' });
        return;
      }
      attempt = 0;
      lastTicket = ticket;
      open(ticket);
    },
    disconnect() {
      manualClose = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      ws?.close();
      // manualClose makes onclose land on 'idle'; if it never fires, force it.
      setStatus('disconnected', { reason: 'manual' });
    },
    status: () => status,
    onStatus(cb) {
      statusCbs.add(cb);
      return () => statusCbs.delete(cb);
    },
    stop() {
      manualClose = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      ws?.close();
    },
  };
}

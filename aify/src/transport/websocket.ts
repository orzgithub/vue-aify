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

import type { OperationPlane } from '../core/types.ts';
import type { ConnectController, ConnectionStatus } from './types.ts';
import {
  decodeConnectionTicket,
  isConnectionTicketExpired,
  type ConnectTicket,
} from '../bridge/ticket.ts';

export interface WebSocketTransportOptions {
  /** Optional kind tag presented to the bridge. */
  kind?: string;
  /** Reconnect after a dropped socket? default true. */
  reconnect?: boolean;
}

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
  let plane: OperationPlane | null = null;
  let ws: WebSocket | null = null;
  let status: ConnectionStatus = 'idle';
  let lastError: string | undefined;
  let manualClose = false;
  const statusCbs = new Set<(s: ConnectionStatus, d?: { error?: string }) => void>();

  const setStatus = (s: ConnectionStatus, d?: { error?: string }) => {
    status = s;
    lastError = d?.error ?? lastError;
    for (const cb of statusCbs) cb(s, d);
  };

  const open = (ticket: ConnectTicket) => {
    manualClose = false;
    setStatus('connecting');
    try {
      ws = new WebSocket(ticket.url);
    } catch (e) {
      setStatus('error', { error: (e as Error).message });
      return;
    }
    ws.onopen = () => {
      ws!.send(
        JSON.stringify({ type: 'register', token: ticket.token, kind: options.kind ?? 'web' }),
      );
      setStatus('connected');
    };
    ws.onmessage = async (ev: MessageEvent) => {
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
        ws!.send(JSON.stringify({ id: msg.id, result }));
      } catch (e) {
        ws!.send(JSON.stringify({ id: msg.id, error: (e as Error).message }));
      }
    };
    ws.onclose = () => {
      if (!manualClose && options.reconnect !== false) {
        // Reconnect with the same last ticket after a brief pause.
        if (lastTicket) setTimeout(() => open(lastTicket!), 1000);
        else setStatus('idle');
      } else {
        setStatus('idle');
      }
    };
    ws.onerror = () => {
      ws?.close();
      setStatus('error', { error: lastError ?? 'connection error' });
    };
  };

  let lastTicket: ConnectTicket | null = null;

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
      lastTicket = ticket;
      open(ticket);
    },
    disconnect() {
      manualClose = true;
      ws?.close();
      setStatus('idle');
    },
    status: () => status,
    onStatus(cb) {
      statusCbs.add(cb);
      return () => statusCbs.delete(cb);
    },
    stop() {
      manualClose = true;
      ws?.close();
    },
  };
}

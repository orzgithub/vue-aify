// Browser-safe ticket codec.  !! NO node:crypto in this file !!
//
// The page only ever *decodes* a ticket it was handed out-of-band. The bridge
// (Node) is the only thing that *issues* one with a random token — see
// ticket.node.ts. Keeping the codec free of node:crypto means the page bundle
// never pulls in server-only code.
//
// The credential is a single base64 string: the JSON of
//   { url, token, kind?, issuedAt, expiresAt? }
// so the operator copies ONE value (paste anywhere). Both sides decode it; extra
// fields are forward-compatible.

export interface ConnectTicket {
  /** WebSocket endpoint the page should connect to, e.g. ws://127.0.0.1:7799. */
  url: string;
  /** Random, unguessable secret the page presents on register. */
  token: string;
  /** Optional kind tag forwarded to the bridge (web/desktop/...). */
  kind?: string;
  /** Epoch ms when issued. */
  issuedAt: number;
  /** Epoch ms when the ticket expires (if a ttl was given). */
  expiresAt?: number;
}

export interface IssueTicketOptions {
  host?: string; // default 127.0.0.1
  port?: number; // default 7799
  secure?: boolean; // ws vs wss — default false
  kind?: string;
  ttlMs?: number; // optional lifetime
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 7799;

/**
 * Build the ticket object. Randomness (`token`) is supplied by the caller so
 * this stays browser-safe — the Node issuer fills it with crypto randomness.
 */
export function buildConnectTicket(
  opts: IssueTicketOptions & { token: string },
): ConnectTicket {
  const host = opts.host ?? DEFAULT_HOST;
  const port = opts.port ?? DEFAULT_PORT;
  const secure = opts.secure ?? false;
  const issuedAt = Date.now();
  return {
    token: opts.token,
    url: `${secure ? 'wss' : 'ws'}://${host}:${port}`,
    kind: opts.kind,
    issuedAt,
    expiresAt: opts.ttlMs ? issuedAt + opts.ttlMs : undefined,
  };
}

/** True when the ticket carries an expiry and it is no longer valid. */
export function isConnectionTicketExpired(
  t: Pick<ConnectTicket, 'expiresAt'>,
  now = Date.now(),
): boolean {
  return typeof t.expiresAt === 'number' && t.expiresAt <= now;
}

/** Encode a ticket as a single base64 string (isomorphic: btoa in browser, Buffer in node). */
export function encodeConnectionTicket(t: ConnectTicket): string {
  const json = JSON.stringify(t);
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(json);
    return btoa(String.fromCharCode(...bytes));
  }
  return Buffer.from(json, 'utf8').toString('base64');
}

/** Decode a base64 ticket string back into a ConnectTicket (throws on malformed input). */
export function decodeConnectionTicket(s: string): ConnectTicket {
  let json: string;
  if (typeof atob === 'function') {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    json = new TextDecoder().decode(bytes);
  } else {
    json = Buffer.from(s, 'base64').toString('utf8');
  }
  let obj: Partial<ConnectTicket>;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('invalid connection ticket');
  }
  if (!obj || typeof obj.url !== 'string' || typeof obj.token !== 'string') {
    throw new Error('invalid connection ticket');
  }
  return obj as ConnectTicket;
}

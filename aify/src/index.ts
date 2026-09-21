// AIfy — the AI-native control layer.
//
// The library exposes:
//   - installAify(app, options): the Vue 3 plugin (registers v-aify:* directives +
//     bootstraps the transport). One call to wire up a Web app.
//   - createWebPlane / OperationPlaneImpl / Registry: the framework-agnostic core
//     (reusable on desktop with a native binding).
//   - createWebSocketTransport / TransportAdapter / ConnectController: how a page
//     reaches the MCP bridge.
//   - encode/decodeConnectionTicket: the browser-safe ticket codec.
//
// The MCP bridge itself is a separate subproject in ../mcp. Keeping it outside the
// library means `aify` never depends on ws / node:crypto / an MCP SDK.
//
// DEMO code lives in ../demo and consumes THIS library as a package.

import type { App } from 'vue';
import { OperationPlaneImpl } from './core/operationPlane.ts';
import { extractA11y, findParentContainerEl, createAifyPlugin, type AifyPluginOptions } from './vue/directives.ts';

export { OperationPlaneImpl } from './core/operationPlane.ts';
export { Registry, type RegistryDeps } from './core/registry.ts';

// Browser-safe ticket codec only — no node:crypto. The Node issuer lives in the
// `mcp` subproject and imports these helpers; it never enters the page bundle.
export {
  buildConnectTicket,
  encodeConnectionTicket,
  decodeConnectionTicket,
  isConnectionTicketExpired,
  type ConnectTicket,
  type IssueTicketOptions,
} from './bridge/ticket.ts';
export { createWebSocketTransport, type WebSocketTransportOptions } from './transport/websocket.ts';
export type { ConnectController, ConnectionStatus, TransportAdapter } from './transport/types.ts';
export * from './core/types.ts';

// Build the core OperationPlane wired to the DOM deps (Web binding).
export function createWebPlane(options?: {
  kind?: string;
  getTitle?: () => string;
  graph?: import('./core/types.ts').AifyGraph;
}): OperationPlaneImpl {
  return new OperationPlaneImpl({
    kind: options?.kind ?? 'web',
    getTitle: options?.getTitle,
    graph: options?.graph,
    findParentContainerEl,
    extractA11y,
  });
}

// Convenience: one call to wire up the Vue plugin with a fresh Web plane,
// returning the plane AND the transport so callers can register/connect later.
export interface InstallResult {
  plane: OperationPlaneImpl;
  transport: import('./transport/types.ts').TransportAdapter | undefined;
}
export function installAify(app: App, options?: AifyPluginOptions): InstallResult {
  const plane = createWebPlane({
    kind: options?.kind,
    getTitle: options?.getTitle,
    graph: options?.graph,
  });
  const plugin = createAifyPlugin(plane);
  app.use(plugin, options);
  return { plane, transport: options?.transport };
}

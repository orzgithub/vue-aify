// Core, framework-agnostic types for the AIfy control layer.
//
// Design constraints (the "window manager" model):
//  - The UI is a directed graph: nodes are `page`s, edges are `action`s that
//    declare a `transitionsTo` target page.
//  - Exactly one page is `focused` at any time. Other pages may EXIST but are
//    not focusable (e.g. a page hidden behind a modal).
//  - `act` can ONLY invoke a pre-registered, fixed handler. It never executes
//    arbitrary JS / never manages focus or routing itself.
//  - `loading`/`focused` are supplied as plain accessors (() => boolean) so the
//    core has zero dependency on Vue or any other framework.

export type ActionType = 'click' | 'input';

export interface ActionMeta {
  description: string;
  sideEffects?: string;
  transitionsTo?: string; // id of the page this action leads to (an edge)
  required?: boolean; // input-only hint; the live DOM/control state still wins
}

export interface ModuleMeta {
  name?: string;
  description?: string;
}

export interface PageMeta {
  id: string;
  title?: string;
  description?: string;
  // Accessors (framework binding wraps a Ref -> () => boolean).
  loading?: () => boolean; // when true, the page is not yet ready
  focused?: () => boolean; // when false, the page exists but is not focusable
}

// ---- Static graph declarations (known at build time) ----
// `map`/`routine` are planning tools. Pages declared here stay in the graph even
// when their component is not mounted (e.g. behind `v-if`). A live page with the
// same id overrides the static entry while it is mounted.
export interface StaticPageDef {
  id: string;
  title?: string;
  description?: string;
}

export interface StaticEdgeDef {
  from: string; // source page id
  to: string; // destination page id
  via?: string; // optional action id; live actions bind this automatically
  label?: string;
  sideEffects?: string;
}

export interface AifyGraph {
  pages?: StaticPageDef[];
  edges?: StaticEdgeDef[];
}

// ---- Runtime nodes (hold real elements/handlers; never serialized) ----
export interface ActionNode {
  kind: 'action';
  id: string;
  type: ActionType;
  meta: ActionMeta;
  el: Element;
  // Fixed operation. Provided by the binding (Vue default = dispatch DOM events,
  // desktop native = invoke native control). Never supplied by the AI side.
  handler: (params?: { value?: string }) => void | Promise<void>;
}

export interface ModuleNode {
  kind: 'module';
  id: string;
  meta: ModuleMeta;
  el: Element;
}

export interface PageNode {
  kind: 'page';
  id: string;
  meta: PageMeta;
  el: Element;
}

export type ContainerNode = PageNode | ModuleNode;
export type AnyNode = ActionNode | ModuleNode | PageNode;

// ---- Serialized shapes (pure data handed to the AI) ----
export interface SerializedAction {
  id: string;
  kind: 'action';
  type: ActionType;
  description: string;
  sideEffects?: string;
  transitionsTo?: string;
  enabled: boolean;
  // Reused from existing a11y surfaces (no second labeling system):
  label?: string;
  role?: string;
  placeholder?: string;
  value?: string;
  required?: boolean;
}

export interface SerializedModule {
  id: string;
  kind: 'module';
  name?: string;
  description?: string;
  label?: string;
  children: SerializedNode[];
}

export interface SerializedPage {
  id: string;
  kind: 'page';
  title?: string;
  description?: string;
  label?: string;
  ready: boolean;
  children: SerializedNode[];
}

export type SerializedNode = SerializedAction | SerializedModule | SerializedPage;

// ---- Tool outputs ----
export interface PageSummary {
  id: string;
  title?: string;
  description?: string;
  focused: boolean;
  ready: boolean;
}

export interface RoutineEdge {
  from: string; // source page id
  to: string; // destination page id
  via: string; // triggering action id
  label?: string;
  sideEffects?: string;
}

export interface SnapshotResult {
  focused: string | null;
  page: SerializedPage | null;
}

export interface ActResult {
  ok: boolean;
  error?: 'unknown' | 'not focused' | 'disabled' | 'missing value' | string;
  transitionsTo?: string;
}

export interface WaitResult {
  ready: boolean;
  reason?: string;
}

// ---- The environment-agnostic contract. ----
// Identical for Web (Vue binding) and Desktop (native binding). The only thing
// that differs between platforms is how nodes/handlers are registered and how
// the plane reaches the Bridge (WebSocket vs in-process IPC).
export interface OperationPlane {
  meta(): { kind: string; title?: string } | Promise<{ kind: string; title?: string }>;
  map(): PageSummary[] | Promise<PageSummary[]>;
  routine(node?: string): RoutineEdge[] | Promise<RoutineEdge[]>;
  snapshot(): SnapshotResult | Promise<SnapshotResult>;
  act(
    actionId: string,
    params?: { value?: string },
  ): ActResult | Promise<ActResult>;
  waitForUI(timeoutMs?: number): Promise<WaitResult>;
}

export interface OperationPlaneOptions {
  kind?: string;
  getTitle?: () => string;
}

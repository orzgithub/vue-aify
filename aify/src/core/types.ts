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

/** The two branches an action can end in. */
export type ActionOutcome = 'success' | 'failure';

/**
 * Per-branch metadata. `success`/`failure` let one action describe different
 * side effects, copy and destination depending on how it ended.
 */
export interface ActionOutcomeMeta {
  description?: string;
  // Human-readable condition for when this branch happens, e.g.
  // "credentials are valid" / "the server rejects the login".
  when?: string;
  sideEffects?: string;
  transitionsTo?: string; // id of the page this branch leads to (an edge)
}

/**
 * Runtime signal returned by a fixed handler (or by `resolveOutcome` when the
 * handler's return value is swallowed, e.g. a Vue `@click` listener). Anything
 * that is not an explicit failure is treated as success, so old handlers that
 * return nothing keep working unchanged.
 */
export type ActionOutcomeSignal =
  | void
  | boolean
  | ActionOutcome
  | {
      ok?: boolean;
      outcome?: ActionOutcome;
      error?: string;
      transitionsTo?: string;
    };

export type ActionHandler = (
  params?: { value?: string },
) => ActionOutcomeSignal | Promise<ActionOutcomeSignal>;

export interface ActionMeta {
  description: string;
  // Legacy flat fields. They describe the SUCCESS branch and stay fully
  // supported; explicit `success` fields win when both are present.
  sideEffects?: string;
  transitionsTo?: string; // id of the page this action leads to (an edge)
  required?: boolean; // input-only hint; the live DOM/control state still wins

  // Explicit success/failure branches (backward compatible: omitting them
  // makes the flat fields above the success branch).
  success?: ActionOutcomeMeta;
  failure?: ActionOutcomeMeta;

  // Optional runtime resolver. Called after the fixed handler only when the
  // handler returned no signal (DOM click listeners always return undefined).
  resolveOutcome?: () => ActionOutcomeSignal | Promise<ActionOutcomeSignal>;
}

export interface ModuleMeta {
  name?: string;
  description?: string;
}

// Read-only text material explicitly exposed to the agent. The text itself is
// read live from the element at snapshot time unless `text` overrides it, so
// dynamic status/error copy works without re-registering the directive.
export interface TextMeta {
  description?: string;
  text?: string | (() => string);
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
  when?: string; // condition for this branch, e.g. "credentials valid"
  sideEffects?: string;
  outcome?: ActionOutcome; // defaults to 'success' for legacy declarations
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
  handler: ActionHandler;
}

export interface ModuleNode {
  kind: 'module';
  id: string;
  meta: ModuleMeta;
  el: Element;
}

export interface TextNode {
  kind: 'text';
  id: string;
  meta: TextMeta;
  el: Element;
}

export interface PageNode {
  kind: 'page';
  id: string;
  meta: PageMeta;
  el: Element;
}

export type ContainerNode = PageNode | ModuleNode;
export type AnyNode = ActionNode | ModuleNode | PageNode | TextNode;

// ---- Serialized shapes (pure data handed to the AI) ----
export interface SerializedAction {
  id: string;
  kind: 'action';
  type: ActionType;
  description: string;
  // Legacy flat fields: the success branch, kept for compatibility.
  sideEffects?: string;
  transitionsTo?: string;
  // Explicit branches when the action declares them.
  success?: ActionOutcomeMeta;
  failure?: ActionOutcomeMeta;
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

export interface SerializedText {
  id: string;
  kind: 'text';
  text: string;
  description?: string;
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

export type SerializedNode =
  | SerializedAction
  | SerializedModule
  | SerializedPage
  | SerializedText;

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
  via: string; // triggering action id (or a static placeholder before binding)
  label?: string;
  when?: string; // condition for this branch, when the action declares one
  sideEffects?: string;
  outcome?: ActionOutcome; // defaults to 'success' for legacy edges
  // Provenance flags. An edge may be static AND observed AND bound at once.
  declared?: boolean; // present in the compile-time graph declaration
  observed?: boolean; // appended after an actual act() traversal
  bound?: boolean; // `via` currently points at a mounted live action id
}

export interface SnapshotResult {
  focused: string | null;
  page: SerializedPage | null;
}

export interface ActResult {
  ok: boolean;
  outcome?: ActionOutcome; // which branch ran (only set once a handler ran)
  error?: 'unknown' | 'not focused' | 'disabled' | 'missing value' | string;
  transitionsTo?: string;
  sideEffects?: string;
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

// The OperationPlane: implements the 5-tool contract on top of the Registry.
// This is the single environment-agnostic surface the Bridge exposes to the AI.
// It never executes arbitrary code and never decides focus/routing itself.

import { Registry, type RegistryDeps } from './registry.ts';
import type {
  ActionOutcome,
  ActionOutcomeMeta,
  ActionOutcomeSignal,
  ActResult,
  OperationPlane,
  OperationPlaneOptions,
  PageSummary,
  RoutineEdge,
  SerializedPage,
  SnapshotResult,
  WaitResult,
} from './types.ts';

/**
 * Interpret a handler/resolver signal. Anything that is not an explicit
 * failure is success, so legacy handlers that return nothing keep working.
 */
function resolveOutcomeSignal(signal: ActionOutcomeSignal): {
  outcome: ActionOutcome;
  error?: string;
  transitionsTo?: string;
} {
  if (signal === false || signal === 'failure') return { outcome: 'failure' };
  if (typeof signal === 'object' && signal !== null) {
    const explicit = signal.outcome;
    const outcome: ActionOutcome =
      explicit ??
      (signal.ok === false
        ? 'failure'
        : signal.ok === true
          ? 'success'
          : signal.error
            ? 'failure'
            : 'success');
    return {
      outcome,
      error: signal.error,
      transitionsTo: signal.transitionsTo,
    };
  }
  return { outcome: 'success' };
}

export interface OperationPlaneConfig extends RegistryDeps, OperationPlaneOptions {}

export class OperationPlaneImpl implements OperationPlane {
  private registry: Registry;
  private options: OperationPlaneOptions;

  constructor(deps: OperationPlaneConfig) {
    this.registry = new Registry(deps);
    this.options = { kind: deps.kind ?? 'web', getTitle: deps.getTitle };
  }

  // Exposed so bindings (e.g. Vue directives) can register nodes/handlers.
  get reg() {
    return this.registry;
  }

  async meta() {
    return { kind: this.options.kind ?? 'web', title: this.options.getTitle?.() };
  }

  async map(): Promise<PageSummary[]> {
    const focused = this.registry.findFocusedPage();
    const summaries = new Map<string, PageSummary>();

    // Compile-time pages are always part of the graph.
    for (const page of this.registry.listStaticPages()) {
      summaries.set(page.id, {
        id: page.id,
        title: page.title,
        description: page.description,
        focused: false,
        ready: true,
      });
    }

    // Live/mounted pages override static metadata and add dynamic pages.
    for (const page of this.registry.listPages()) {
      summaries.set(page.id, {
        id: page.id,
        title: page.meta.title,
        description: page.meta.description,
        focused: false,
        ready: this.registry.pageReady(page),
      });
    }

    // Dynamic pages are appended once they have been observed/traversed.
    for (const id of this.registry.listObservedPageIds()) {
      if (!summaries.has(id)) {
        summaries.set(id, { id, focused: false, ready: true });
      }
    }

    return [...summaries.values()].map((summary) => ({
      ...summary,
      // Exactly one page is reported focused, matching snapshot/act discipline.
      focused: focused?.id === summary.id,
    }));
  }

  async routine(node?: string): Promise<RoutineEdge[]> {
    return this.registry.edgesFor(node);
  }

  async snapshot(): Promise<SnapshotResult> {
    const focused = this.registry.findFocusedPage();
    if (!focused) return { focused: null, page: null };
    const page: SerializedPage = this.registry.buildPageTree(focused);
    return { focused: focused.id, page };
  }

  async act(
    actionId: string,
    params?: { value?: string },
  ): Promise<ActResult> {
    const node = this.registry.getNode(actionId);
    if (!node || node.kind !== 'action')
      return { ok: false, error: 'unknown' };

    // Focus discipline: only actions on the focused page are operable.
    // (Other pages may EXIST but are not focusable, like a background window.)
    const focused = this.registry.findFocusedPage();
    const actionPageId = this.registry.pageIdOf(node.el);
    if (!focused || actionPageId !== focused.id)
      return { ok: false, error: 'not focused' };

    if (this.registry.isActionDisabled(node.el))
      return { ok: false, error: 'disabled' };

    if (node.type === 'input' && params?.value === undefined)
      return { ok: false, error: 'missing value' };

    // Explicit branches; the success branch falls back to the legacy flat
    // fields so actions that never declare success/failure keep old behavior,
    // and a partial `success` object still inherits missing legacy fields.
    const successBranch: ActionOutcomeMeta = {
      sideEffects: node.meta.sideEffects,
      transitionsTo: node.meta.transitionsTo,
      ...node.meta.success,
    };
    const branchFor = (outcome: ActionOutcome): ActionOutcomeMeta =>
      outcome === 'failure' ? (node.meta.failure ?? {}) : successBranch;

    // Strict: invoke ONLY the pre-registered fixed handler. No JS execution
    // crosses the wire; the handler was registered by the binding at compile time.
    let signal: ActionOutcomeSignal;
    try {
      signal = await node.handler(params);
    } catch (e) {
      // Unexpected throw: preserve the legacy error shape and do NOT claim a
      // branch transition, because the handler may have failed before routing.
      return {
        ok: false,
        outcome: 'failure',
        error: `handler: ${(e as Error).message}`,
      };
    }

    // DOM click listeners cannot return a value, so an action may provide an
    // optional resolver that inspects app state after the handler ran.
    if (signal === undefined && node.meta.resolveOutcome) {
      try {
        signal = await node.meta.resolveOutcome();
      } catch (e) {
        return {
          ok: false,
          outcome: 'failure',
          error: `outcome: ${(e as Error).message}`,
        };
      }
    }

    const resolved = resolveOutcomeSignal(signal);
    const outcome = resolved.outcome;
    const branch = branchFor(outcome);
    const transitionsTo = resolved.transitionsTo ?? branch.transitionsTo;
    const sideEffects = branch.sideEffects;

    // Passive graph recording: an actual traversal appends/updates the edge,
    // keyed by branch so success and failure destinations can differ.
    if (transitionsTo) {
      this.registry.recordTraversal(
        node.id,
        actionPageId,
        transitionsTo,
        branch.description ?? node.meta.description,
        sideEffects,
        outcome,
        branch.when,
      );
    }

    if (outcome === 'failure') {
      return {
        ok: false,
        outcome,
        error: resolved.error ?? 'action failed',
        transitionsTo,
        sideEffects,
      };
    }

    return { ok: true, outcome, transitionsTo, sideEffects };
  }

  async waitForUI(timeoutMs = 5000): Promise<WaitResult> {
    const deadline = Date.now() + timeoutMs;
    const tick = 60;
    // Poll ONLY the focused page's `ready`. Never waits for individual elements.
    while (Date.now() < deadline) {
      const focused = this.registry.findFocusedPage();
      if (focused && this.registry.pageReady(focused)) return { ready: true };
      await new Promise((r) => setTimeout(r, tick));
    }
    return { ready: false, reason: 'timeout' };
  }
}

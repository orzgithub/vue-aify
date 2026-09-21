// The OperationPlane: implements the 5-tool contract on top of the Registry.
// This is the single environment-agnostic surface the Bridge exposes to the AI.
// It never executes arbitrary code and never decides focus/routing itself.

import { Registry, type RegistryDeps } from './registry.ts';
import type {
  ActResult,
  OperationPlane,
  OperationPlaneOptions,
  PageSummary,
  RoutineEdge,
  SerializedPage,
  SnapshotResult,
  WaitResult,
} from './types.ts';

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

    // Strict: invoke ONLY the pre-registered fixed handler. No JS execution
    // crosses the wire; the handler was registered by the binding at compile time.
    try {
      await node.handler(params);
    } catch (e) {
      return { ok: false, error: `handler: ${(e as Error).message}` };
    }

    // Passive graph recording: an actual traversal appends/updates the edge.
    if (node.meta.transitionsTo) {
      this.registry.recordTraversal(
        node.id,
        actionPageId,
        node.meta.transitionsTo,
        node.meta.description,
        node.meta.sideEffects,
      );
    }

    return { ok: true, transitionsTo: node.meta.transitionsTo };
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

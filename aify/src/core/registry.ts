// Framework-agnostic node registry + tree/edge builder.
//
// The registry knows nothing about Vue or the DOM. Parent-child relationships
// are resolved through an injected `findParentContainerEl`, so the same core
// serves both Web (DOM ancestry) and desktop (native hierarchy) bindings.
//
// Parent resolution happens at SNAPSHOT / EDGE time (walking up the ancestry),
// never at registration time. This sidesteps child-before-parent mount-order
// problems entirely: by the time anyone asks, the whole tree is mounted.

import type {
  ActionMeta,
  ActionNode,
  ActionType,
  AifyGraph,
  ModuleMeta,
  ModuleNode,
  PageMeta,
  PageNode,
  RoutineEdge,
  SerializedAction,
  SerializedModule,
  SerializedNode,
  SerializedPage,
  StaticEdgeDef,
  StaticPageDef,
} from './types.ts';

export interface RegistryDeps {
  // Given a node element, return the element of its nearest container ancestor
  // (page or module), or null if it hangs off the root.
  findParentContainerEl: (el: Element) => Element | null;
  // Pull a11y-style info from an element (DOM props on Web, control props native).
  extractA11y: (el: Element) => {
    label?: string;
    role?: string;
    placeholder?: string;
    value?: string;
    required?: boolean;
  };
  // Compile-time graph declarations. These survive component unmounts.
  graph?: AifyGraph;
}

let counter = 0;
const nextId = (p: string) => `${p}${(++counter).toString(36)}`;

export class Registry {
  private nodes = new Map<string, ContainerNode | ActionNode>();
  private elToNode = new WeakMap<Element, ContainerNode | ActionNode>();
  private deps: RegistryDeps;

  // Static graph + dynamically observed graph. Both survive unmounts.
  private staticPages = new Map<string, StaticPageDef>();
  private staticEdges: StaticEdgeDef[] = [];
  private observedEdges = new Map<string, RoutineEdge>();
  private observedPageIds = new Set<string>();

  constructor(deps: RegistryDeps) {
    this.deps = deps;
    for (const page of deps.graph?.pages ?? []) {
      this.staticPages.set(page.id, page);
    }
    this.staticEdges = [...(deps.graph?.edges ?? [])];
  }

  registerPage(el: Element, meta: PageMeta): PageNode {
    const node: PageNode = { kind: 'page', id: meta.id, meta, el };
    this.nodes.set(meta.id, node);
    this.elToNode.set(el, node);
    // Dynamic pages are appended to the known graph once they are reached.
    this.observedPageIds.add(meta.id);
    return node;
  }

  registerModule(el: Element, meta: ModuleMeta): ModuleNode {
    const node: ModuleNode = { kind: 'module', id: nextId('m'), meta, el };
    this.nodes.set(node.id, node);
    this.elToNode.set(el, node);
    return node;
  }

  registerAction(
    el: Element,
    type: ActionType,
    meta: ActionMeta,
    handler: (params?: { value?: string }) => void | Promise<void>,
  ): ActionNode {
    const node: ActionNode = {
      kind: 'action',
      id: nextId('a'),
      type,
      meta,
      el,
      handler,
    };
    this.nodes.set(node.id, node);
    this.elToNode.set(el, node);
    return node;
  }

  unregister(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    this.nodes.delete(id);
    this.elToNode.delete(node.el);
  }

  getNode(id: string) {
    return this.nodes.get(id);
  }

  getNodeByEl(el: Element) {
    return this.elToNode.get(el);
  }

  // Walk up the container chain from an element to the owning page id.
  // Unregistered intermediate elements (DOM nodes that aren't a page/module)
  // are transparently skipped, so we always reach the nearest registered page.
  pageIdOf(el: Element): string | null {
    let cur = this.deps.findParentContainerEl(el);
    while (cur) {
      const n = this.elToNode.get(cur);
      if (n?.kind === 'page') return n.id;
      cur = this.deps.findParentContainerEl(cur);
    }
    return null;
  }

  // ---- Page / focus / ready queries ----
  listPages(): PageNode[] {
    return [...this.nodes.values()].filter(
      (n): n is PageNode => n.kind === 'page',
    );
  }

  listStaticPages(): StaticPageDef[] {
    return [...this.staticPages.values()];
  }

  listObservedPageIds(): string[] {
    return [...this.observedPageIds];
  }

  pageReady(page: PageNode): boolean {
    const fn = page.meta.loading;
    return fn ? !fn() : true;
  }

  findFocusedPage(): PageNode | null {
    const pages = this.listPages();
    const focusAware = pages.filter((p) => p.meta.focused);
    if (focusAware.length > 0) {
      // Single-window rule: trust explicit focus metadata and return at most one.
      return focusAware.find((p) => p.meta.focused!()) ?? null;
    }
    // Backward-compatible convenience for a single page that omits `focused`.
    return pages[0] ?? null;
  }

  // ---- Routine edges ----
  // The graph is the union of:
  //   - compile-time static edges;
  //   - edges observed when the agent actually traverses a transition;
  //   - live action edges for pages currently mounted.
  // Static edges bind to a live action id whenever the source page is mounted.
  edgesFor(nodeId?: string): RoutineEdge[] {
    const byTarget = new Map<string, RoutineEdge>();
    const key = (from: string, to: string) => `${from}\u0000${to}`;

    for (const edge of this.staticEdges) {
      byTarget.set(key(edge.from, edge.to), this.resolveStaticEdge(edge));
    }

    for (const edge of this.observedEdges.values()) {
      byTarget.set(key(edge.from, edge.to), edge);
    }

    const actions = [...this.nodes.values()].filter(
      (n): n is ActionNode => n.kind === 'action' && !!n.meta.transitionsTo,
    );
    for (const action of actions) {
      const fromId = this.pageIdOf(action.el);
      if (!fromId) continue;
      const toId = action.meta.transitionsTo!;
      byTarget.set(key(fromId, toId), {
        from: fromId,
        to: toId,
        via: action.id,
        label: action.meta.description,
        sideEffects: action.meta.sideEffects,
      });
    }

    let edges = [...byTarget.values()];
    if (nodeId) {
      const scopedAction = this.nodes.get(nodeId);
      if (scopedAction?.kind === 'action') {
        edges = edges.filter((edge) => edge.via === nodeId);
      } else {
        edges = edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
      }
    }
    return edges;
  }

  private resolveStaticEdge(edge: StaticEdgeDef): RoutineEdge {
    const live = [...this.nodes.values()].find(
      (node): node is ActionNode =>
        node.kind === 'action' &&
        node.meta.transitionsTo === edge.to &&
        this.pageIdOf(node.el) === edge.from,
    );
    if (!live) {
      return {
        from: edge.from,
        to: edge.to,
        via: edge.via ?? `static:${edge.from}->${edge.to}`,
        label: edge.label,
        sideEffects: edge.sideEffects,
      };
    }
    return {
      from: edge.from,
      to: edge.to,
      via: live.id,
      label: live.meta.description ?? edge.label,
      sideEffects: live.meta.sideEffects ?? edge.sideEffects,
    };
  }

  // Called after `act` successfully invokes a transition action.
  recordTraversal(
    actionId: string,
    fromPageId: string | null,
    toPageId: string,
    label?: string,
    sideEffects?: string,
  ): void {
    if (!fromPageId) return;
    this.observedEdges.set(`${fromPageId}\u0000${toPageId}`, {
      from: fromPageId,
      to: toPageId,
      via: actionId,
      label,
      sideEffects,
    });
    this.observedPageIds.add(fromPageId);
    this.observedPageIds.add(toPageId);
  }

  // Live disabled state, shared by serialization and `act` enforcement.
  isActionDisabled(el: Element): boolean {
    const target = el as HTMLElement & { disabled?: boolean };
    return !!target.hasAttribute?.('disabled') || target.disabled === true;
  }

  // ---- Tree building (serialized, reads live element state) ----
  buildPageTree(page: PageNode): SerializedPage {
    return {
      id: page.id,
      kind: 'page',
      title: page.meta.title,
      description: page.meta.description,
      label: this.deps.extractA11y(page.el).label,
      ready: this.pageReady(page),
      children: this.childrenOf(page.el),
    };
  }

  private childrenOf(parentEl: Element): SerializedNode[] {
    const out: SerializedNode[] = [];
    for (const node of this.nodes.values()) {
      if (this.deps.findParentContainerEl(node.el) !== parentEl) continue;
      if (node.kind === 'action') out.push(this.serializeAction(node));
      else if (node.kind === 'module') out.push(this.serializeContainer(node));
    }
    return out;
  }

  private serializeContainer(node: ModuleNode): SerializedModule {
    return {
      id: node.id,
      kind: 'module',
      name: node.meta.name,
      description: node.meta.description,
      label: this.deps.extractA11y(node.el).label,
      children: this.childrenOf(node.el),
    };
  }

  private serializeAction(node: ActionNode): SerializedAction {
    const a11y = this.deps.extractA11y(node.el);
    return {
      id: node.id,
      kind: 'action',
      type: node.type,
      description: node.meta.description,
      sideEffects: node.meta.sideEffects,
      transitionsTo: node.meta.transitionsTo,
      enabled: !this.isActionDisabled(node.el),
      label: a11y.label,
      role: a11y.role,
      placeholder: a11y.placeholder,
      value: a11y.value,
      required: node.meta.required ?? a11y.required,
    };
  }
}

type ContainerNode = PageNode | ModuleNode;

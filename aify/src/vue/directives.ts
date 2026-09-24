// Vue 3 binding for AIfy. Provides the `v-aify:page|module|click|input|text` directive.
//
// This is the ONLY layer that knows about Vue / the DOM. It registers nodes into
// the OperationPlane's registry and supplies the FIXED handlers that `act` will
// later invoke. The handlers are ordinary DOM event dispatches registered here at
// directive-apply time (i.e. bundled into the app) -- never sent across the wire.

import type { Directive, DirectiveBinding, App } from 'vue';
import type { OperationPlaneImpl } from '../core/operationPlane.ts';
import type { ActionMeta, ActionType } from '../core/types.ts';
import { extractA11y } from '../core/a11y.ts';
import { setNativeValue } from '../core/setNativeValue.ts';

// Elements that act as a container (page or module) for ancestry walks.
const containers = new WeakSet<Element>();

// Normalize a focus/loading source to a () => boolean accessor.
//
// IMPORTANT: in a Vue template, refs used inside a directive binding expression
// are auto-unwrapped to their *current* value. So `v-aify:page="{ focused: myRef }"`
// reaches us as a static boolean, NOT a live ref — focus would freeze at mount
// time. The demo therefore passes an arrow function `() => route===...`, which
// we detect here and call on each read, keeping focus live.
function toBooleanAccessor(v: unknown): () => boolean {
  if (typeof v === 'function') return () => !!v();
  if (v && typeof (v as { value?: unknown }).value !== 'undefined') {
    return () => !!((v as { value?: unknown }).value as boolean);
  }
  return () => !!v;
}

function findParentContainerEl(el: Element): Element | null {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (containers.has(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

export function createAify(plane: OperationPlaneImpl) {
  const reg = plane.reg;

  // Default fixed handler for a click action: dispatch a bubbling click so any
  // @click / addEventListener on the element or an ancestor runs.
  function clickHandler(el: Element) {
    return () => (el as HTMLElement).click();
  }

  // Default fixed handler for an input action: set value (via prototype setter so
  // v-model detects it) then dispatch input+change. Only the value param is used.
  function inputHandler(el: Element) {
    return (params?: { value?: string }) => {
      if (params?.value === undefined) return;
      setNativeValue(el, params.value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
  }

  const directive: Directive<HTMLElement, any> = {
    mounted(el: HTMLElement, binding: DirectiveBinding) {
      const arg = binding.arg as string | undefined;
      const raw = binding.value as unknown;
      const value: Record<string, any> =
        typeof raw === 'string' ? { text: raw } : ((raw as Record<string, any>) ?? {});

      if (arg === 'page') {
        containers.add(el);
        reg.registerPage(el, {
          id: value.id,
          title: value.title,
          description: value.description,
          loading:
            value.loading !== undefined ? toBooleanAccessor(value.loading) : undefined,
          focused:
            value.focused !== undefined ? toBooleanAccessor(value.focused) : undefined,
        });
      } else if (arg === 'module') {
        containers.add(el);
        reg.registerModule(el, { name: value.name, description: value.description });
      } else if (arg === 'text') {
        // Read-only material. The text is read live from `el` at snapshot time
        // unless an explicit string/function override is supplied.
        reg.registerText(el, {
          description: value.description,
          text: value.text,
        });
      } else if (arg === 'click' || arg === 'input') {
        const type: ActionType = arg;
        const meta: ActionMeta = {
          description: value.description,
          // Legacy flat fields remain the success branch.
          sideEffects: value.sideEffects,
          transitionsTo: value.transitionsTo,
          required: value.required,
          success: value.success,
          failure: value.failure,
          // `resolveOutcome` (or a function passed as `outcome`) inspects app
          // state after the fixed DOM handler ran, because click listeners
          // cannot return a value.
          resolveOutcome:
            typeof value.resolveOutcome === 'function'
              ? value.resolveOutcome
              : typeof value.outcome === 'function'
                ? value.outcome
                : undefined,
        };
        const handler = type === 'click' ? clickHandler(el) : inputHandler(el);
        reg.registerAction(el, type, meta, handler);
      }
    },
    unmounted(el: HTMLElement, binding: DirectiveBinding) {
      const arg = binding.arg as string | undefined;
      if (
        arg === 'page' ||
        arg === 'module' ||
        arg === 'text' ||
        arg === 'click' ||
        arg === 'input'
      ) {
        const node = reg.getNodeByEl(el);
        if (node) reg.unregister(node.id);
      }
    },
  };

  return directive;
}

export interface AifyPluginOptions {
  directiveName?: string; // default 'aify' -> v-aify:*
  transport?: import('../transport/types').TransportAdapter;
  kind?: string;
  getTitle?: () => string;
  // Compile-time page/edge declarations. They keep map/routine complete even
  // when a page component is not currently mounted.
  graph?: import('../core/types.ts').AifyGraph;
}

export function createAifyPlugin(plane: OperationPlaneImpl): {
  install(app: App, options?: AifyPluginOptions): void;
} {
  return {
    install(app: App, options?: AifyPluginOptions) {
      const name = options?.directiveName ?? 'aify';
      app.directive(name, createAify(plane));
      options?.transport?.start(plane);
    },
  };
}

// Re-export the DOM a11y extractor + ancestry walker so the entrypoint can wire
// the OperationPlane's deps in one place.
export { extractA11y, findParentContainerEl };

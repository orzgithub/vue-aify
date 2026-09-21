// Reuses the EXISTING accessibility surface instead of reinventing labels.
// On Web this reads DOM/ARIA props; on desktop a native binding supplies an
// equivalent extractor. No second labeling system is introduced.

export interface A11yInfo {
  label?: string;
  role?: string;
  placeholder?: string;
  value?: string;
  required?: boolean;
}

export function extractA11y(el: Element): A11yInfo {
  const html = el as HTMLElement;
  const input = el as HTMLInputElement;

  const label =
    html.getAttribute?.('aria-label') ||
    input.placeholder ||
    (html as HTMLImageElement).alt ||
    html.getAttribute?.('title') ||
    html.textContent?.trim().slice(0, 80) ||
    undefined;

  const role =
    html.getAttribute?.('role') ||
    (html.tagName ? html.tagName.toLowerCase() : undefined);

  return {
    label,
    role,
    placeholder: input.placeholder,
    value: input.value,
    required: input.required,
  };
}

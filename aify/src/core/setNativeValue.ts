// Sets an input's value using the prototype setter so frameworks that patch the
// value setter (Vue's v-model, React controlled inputs) detect the change and
// fire their input/change handlers. Plain `.value = x` can be silently ignored.

export function setNativeValue(el: Element, value: string): void {
  const target = el as HTMLInputElement;
  const proto = Object.getPrototypeOf(target);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) {
    desc.set.call(target, value);
  } else {
    target.value = value;
  }
}

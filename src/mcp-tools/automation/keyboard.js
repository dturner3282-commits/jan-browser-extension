/**
 * Keyboard event utilities for typing and key pressing
 */

/**
 * Dispatch keyboard event on an element
 */
export function dispatchKey(element, type, char) {
  const keyCode = char.charCodeAt(0);
  const code = char.length === 1 && char.match(/[a-zA-Z]/) ? `Key${char.toUpperCase()}` : char;

  element.dispatchEvent(new KeyboardEvent(type, {
    key: char,
    code,
    keyCode,
    which: keyCode,
    charCode: type === 'keypress' ? keyCode : 0,
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  }));
}

/**
 * Detect if an element is a React component
 */
export function isReactElement(el) {
  return Object.keys(el).some(key =>
    key.startsWith('__reactFiber') ||
    key.startsWith('__reactProps') ||
    key.startsWith('__reactInternalInstance')
  );
}

/**
 * Detect if an element is a Vue component
 */
export function isVueElement(el) {
  return el.__vue__ || el.__vueParentComponent || el._value !== undefined;
}

/**
 * Get native value setter for input/textarea
 */
export function getNativeValueSetter(el) {
  return Object.getOwnPropertyDescriptor(
    el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
    'value',
  )?.set;
}

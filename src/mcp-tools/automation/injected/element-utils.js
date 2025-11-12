/**
 * Element utilities for injected scripts
 * These functions are serialized and executed in the page context
 */

/**
 * Resolve element from reference (CSS selector or Shadow DOM reference)
 * This is used in all injected scripts
 */
export function resolveElementFromRef(reference) {
  if (typeof reference !== 'string' || reference.length === 0) {
    return null;
  }

  // Handle Shadow DOM references (format: css:host##shadow-selector##nested)
  if (reference.includes('##')) {
    const parts = reference.split('##');
    let current = null;

    if (parts[0].startsWith('css:')) {
      const hostSelector = parts[0].slice(4);
      try {
        current = document.querySelector(hostSelector);
      } catch (_) {
        return null;
      }
    }

    if (!current) return null;

    // Traverse through shadow DOMs
    for (let i = 1; i < parts.length; i++) {
      if (!current.shadowRoot) return null;
      try {
        current = current.shadowRoot.querySelector(parts[i]);
      } catch (_) {
        return null;
      }
      if (!current) return null;
    }

    return current;
  }

  // Regular CSS selector
  if (reference.startsWith('css:')) {
    const selectorText = reference.slice(4);
    if (!selectorText) return null;
    try {
      return document.querySelector(selectorText);
    } catch (_) {
      return null;
    }
  }

  // Fallback: Try various reference formats
  try {
    let element = document.querySelector(`[data-aria-id="${reference}"]`);
    if (element) return element;

    element = document.getElementById(reference);
    if (element) return element;

    element = document.querySelector(reference);
    if (element) return element;
  } catch (_) {
    // Ignore
  }

  return null;
}

/**
 * Find the actual clickable element within a wrapper
 */
export function findClickableElement(element) {
  if (!element) return null;

  // If element is already a known clickable type, return it
  const clickableTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'];
  if (clickableTags.includes(element.tagName)) return element;

  // Check if element has click-related attributes/roles
  const role = element.getAttribute('role');
  const hasClickRole = role === 'button' || role === 'link' || role === 'menuitem' ||
                       role === 'tab' || role === 'checkbox' || role === 'radio' || role === 'href';

  const hasClickable = element.hasAttribute('onclick') || element.style.cursor === 'pointer' ||
                      element.hasAttribute('data-action') || element.hasAttribute('data-click');

  if (hasClickRole || hasClickable) return element;

  // Check for framework-specific event handlers
  const elementKeys = Object.keys(element);
  const hasReactProps = elementKeys.some(key =>
    key.startsWith('__reactProps') || key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
  );
  const hasVueProps = element.__vue__ || element.__vueParentComponent;
  const hasAngular = element.hasAttribute('ng-click') || element.hasAttribute('(click)');

  if (hasReactProps || hasVueProps || hasAngular) return element;

  // Search for clickable child elements
  const clickableChild = element.querySelector('button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]');
  if (clickableChild) return clickableChild;

  return element;
}

/**
 * Scroll element into view smoothly
 */
export function scrollIntoView(element) {
  element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
}

/**
 * Get element center coordinates
 */
export function getElementCenter(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/**
 * Dispatch mouse event on element
 */
export function dispatchMouseEvent(element, eventType, x, y) {
  element.dispatchEvent(new MouseEvent(eventType, {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
  }));
}

/**
 * Click element implementation script
 * This is injected into the page and executed
 */

export function clickElementScript({ sel, ref }) {
  // Import utility functions (these will be inlined by the handler)
  const resolveElementFromRef = __RESOLVE_ELEMENT_FROM_REF__;
  const findClickableElement = __FIND_CLICKABLE_ELEMENT__;
  const scrollIntoView = __SCROLL_INTO_VIEW__;
  const getElementCenter = __GET_ELEMENT_CENTER__;
  const dispatchMouseEvent = __DISPATCH_MOUSE_EVENT__;

  let el = resolveElementFromRef(ref) || (sel ? document.querySelector(sel) : null);
  if (!el) return { success: false, error: 'Element not found' };

  // Find the actual clickable element
  el = findClickableElement(el);
  if (!el) return { success: false, error: 'No clickable element found' };

  // Scroll into view
  scrollIntoView(el);

  // Get center coordinates
  const { x, y } = getElementCenter(el);

  // Comprehensive mouse event simulation
  dispatchMouseEvent(el, 'mouseenter', x, y);
  dispatchMouseEvent(el, 'mouseover', x, y);
  dispatchMouseEvent(el, 'mousemove', x, y);
  dispatchMouseEvent(el, 'mousedown', x, y);

  // Focus if focusable
  if (typeof el.focus === 'function') {
    try {
      el.focus();
    } catch (e) {
      // Ignore focus errors
    }
  }

  dispatchMouseEvent(el, 'mouseup', x, y);

  // Main click event
  el.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
  }));

  dispatchMouseEvent(el, 'mouseout', x, y);
  dispatchMouseEvent(el, 'mouseleave', x, y);

  return { success: true };
}

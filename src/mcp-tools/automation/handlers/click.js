/**
 * Click element handler
 */

import { selectTabForTool, createErrorResult } from '../utils.js';
import { resolveAccessibilityRef } from '../element-resolver.js';
import { TAB_REGISTRATION_DELAY } from '../../../constants.js';

export async function handleClickElement(params) {
  const ref = typeof params?.ref === 'string' ? params.ref.trim() : '';
  let selector = String(params?.selector || '').trim();

  if (!ref && !selector) {
    return createErrorResult('Click failed', 'Missing element ref or selector parameter');
  }

  const waitForNavigation = params?.waitForNavigation !== false; // default true

  console.log('[MCP Tools] click_element', { ref, selector, waitForNavigation });

  try {
    const selection = await selectTabForTool('click_element');
    if (!selection.ok) {
      return createErrorResult('Click failed', selection.error);
    }

    const { tabId } = selection;

    // Resolve accessibility refs to CSS selectors
    const resolvedRef = resolveAccessibilityRef(ref, tabId);

    const beforeTab = await chrome.tabs.get(tabId);
    const originalUrl = beforeTab.url;

    const [{ result: clicked }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: clickElementScript,
      args: [{ sel: selector, ref: resolvedRef }],
    });

    if (!clicked.success) {
      return createErrorResult('Click failed', clicked.error || 'Click failed');
    }

    if (waitForNavigation) {
      await new Promise((resolve) => setTimeout(resolve, TAB_REGISTRATION_DELAY));
    }

    const afterTab = await chrome.tabs.get(tabId);
    const finalUrl = afterTab.url;

    if (clicked.smartDetection) {
      console.log('[MCP Tools] element clicked (smart detection used)', {
        originalUrl,
        finalUrl,
        selector,
        detectedElement: clicked.detectedElement
      });
    } else {
      console.log('[MCP Tools] element clicked', { originalUrl, finalUrl, selector });
    }

    const meta = {};
    if (finalUrl) meta.urls = [finalUrl];
    if (typeof tabId === 'number') meta.tabId = tabId;

    return {
      ok: true,
      content: [
        {
          type: 'text',
          text: `Clicked "${params?.element || selector || ref || 'target element'}"`,
        },
      ],
      _meta: Object.keys(meta).length ? meta : undefined,
      data: {
        originalUrl,
        finalUrl,
        selector,
        ref,
        clicked: true,
        smartDetection: clicked.smartDetection || false,
        detectedElement: clicked.detectedElement || null,
        timestamp: new Date().toISOString(),
        tabId,
      },
    };
  } catch (e) {
    console.error('[MCP Tools] click_element error:', e);
    return createErrorResult('Click failed', e);
  }
}

/**
 * Injected script for clicking elements
 */
function clickElementScript({ sel, ref }) {
  const resolveElementFromRef = (reference) => {
    if (typeof reference !== 'string' || reference.length === 0) {
      return null;
    }

    // Handle Shadow DOM references
    if (reference.includes('##')) {
      const parts = reference.split('##');
      let current = null;
      if (parts[0].startsWith('css:')) {
        const hostSelector = parts[0].slice(4);
        try {
          current = document.querySelector(hostSelector);
        } catch (err) {
          return null;
        }
      }
      if (!current) return null;

      for (let i = 1; i < parts.length; i++) {
        if (!current.shadowRoot) return null;
        try {
          current = current.shadowRoot.querySelector(parts[i]);
        } catch (err) {
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
      } catch (err) {
        return null;
      }
    }

    // Fallback
    try {
      let element = document.querySelector(`[data-aria-id="${reference}"]`);
      if (element) return element;
      element = document.getElementById(reference);
      if (element) return element;
      element = document.querySelector(reference);
      if (element) return element;
    } catch (err) {
      // Ignore
    }

    return null;
  };

  const findClickableElement = (element) => {
    if (!element) return null;

    const clickableTags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'];
    if (clickableTags.includes(element.tagName)) return element;

    const role = element.getAttribute('role');
    const hasClickRole = role === 'button' || role === 'link' || role === 'menuitem' ||
                         role === 'tab' || role === 'checkbox' || role === 'radio' || role === 'href';

    const hasClickable = element.hasAttribute('onclick') || element.style.cursor === 'pointer' ||
                        element.hasAttribute('data-action') || element.hasAttribute('data-click');

    if (hasClickRole || hasClickable) return element;

    const elementKeys = Object.keys(element);
    const hasReactProps = elementKeys.some(key =>
      key.startsWith('__reactProps') || key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
    );
    const hasVueProps = element.__vue__ || element.__vueParentComponent;
    const hasAngular = element.hasAttribute('ng-click') || element.hasAttribute('(click)');

    if (hasReactProps || hasVueProps || hasAngular) return element;

    const clickableChild = element.querySelector('button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]');
    if (clickableChild) return clickableChild;

    if (element.shadowRoot) {
      const shadowClickable = element.shadowRoot.querySelector('button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]');
      if (shadowClickable) return shadowClickable;
    }

    if (element.tagName === 'IFRAME') {
      try {
        const iframeDoc = element.contentDocument || element.contentWindow?.document;
        if (iframeDoc) return iframeDoc.body;
      } catch (err) {
        // Ignore cross-origin errors
      }
    }

    const children = Array.from(element.children);
    if (children.length === 1) {
      const childResult = findClickableElement(children[0]);
      if (childResult && childResult !== children[0]) return childResult;
    }

    return element;
  };

  let el = ref ? resolveElementFromRef(ref) : null;

  if (!el && sel) {
    try {
      el = document.querySelector(sel);
    } catch (err) {
      // Ignore
    }
  }

  if (!el) {
    return { success: false, error: 'Element not found' };
  }

  const originalEl = el;
  el = findClickableElement(el);

  if (!el) {
    return { success: false, error: 'Could not find clickable element' };
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const mouseEventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons: 1,
    composed: true,
  };

  el.dispatchEvent(new MouseEvent('mouseover', mouseEventOptions));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...mouseEventOptions, bubbles: false }));
  el.dispatchEvent(new MouseEvent('mousemove', mouseEventOptions));
  el.dispatchEvent(new MouseEvent('mousedown', mouseEventOptions));

  if (el.focus) el.focus();

  el.dispatchEvent(new MouseEvent('mouseup', mouseEventOptions));
  el.dispatchEvent(new MouseEvent('click', { ...mouseEventOptions, detail: 1 }));

  try {
    el.click();
  } catch (e) {
    // Ignore
  }

  el.dispatchEvent(new PointerEvent('pointerdown', mouseEventOptions));
  el.dispatchEvent(new PointerEvent('pointerup', mouseEventOptions));

  const smartDetectionUsed = originalEl !== el;
  return {
    success: true,
    element: el.tagName,
    focused: document.activeElement === el,
    smartDetection: smartDetectionUsed,
    detectedElement: smartDetectionUsed ? `${el.tagName}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ')[0] : ''}` : null
  };
}

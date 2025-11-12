/**
 * Element resolution and finding utilities
 */

import { getElementSelector } from '../../lib/element-ref-map.js';

/**
 * Helper function to resolve accessibility refs to CSS selectors
 * @param {string} ref - The reference ID (e.g., "s1e14")
 * @param {number} tabId - The tab ID
 * @returns {string} The resolved reference (CSS selector if found, original ref otherwise)
 */
export function resolveAccessibilityRef(ref, tabId) {
  if (!ref || !/^s\d+e\d+$/i.test(ref)) {
    return ref; // Not an accessibility ref, return as-is
  }

  const mappedSelector = getElementSelector(tabId, ref);

  if (mappedSelector) {
    return mappedSelector;
  } else {
    console.warn('[MCP Tools] Could not resolve accessibility ref:', ref);
    console.warn('[MCP Tools] Try capturing a fresh snapshot first');
    return ref; // Return original ref as fallback
  }
}

/**
 * Resolve element from reference (injected script version)
 * Handles regular CSS selectors and Shadow DOM references
 */
export function resolveElementFromRef(reference) {
  if (typeof reference !== 'string' || reference.length === 0) return null;

  // Handle Shadow DOM references (format: css:host##shadow-selector##nested)
  if (reference.includes('##')) {
    const parts = reference.split('##');

    // First part should be the host element (css:...)
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

  return null;
}

/**
 * Find the actual input element within a wrapper
 * Some divs with role="textbox" contain an actual input inside
 */
export function findActualInputElement(el) {
  const actualInput = el.querySelector('input, textarea, [contenteditable="true"]');
  if (actualInput && (actualInput.tagName === 'INPUT' || actualInput.tagName === 'TEXTAREA' || actualInput.contentEditable === 'true')) {
    return actualInput;
  }
  return el;
}

/**
 * Find submit button near an input element
 * Used for typing with submit option
 */
export function findSubmitButton(el) {
  let submitButton = null;

  // Strategy 1: Look in broader parent container (for Slack, Discord, etc.)
  const grandParent = el.closest('[role="group"]') ||
                      el.closest('.p-workspace__input') ||
                      el.closest('[class*="message_input"]');

  if (grandParent) {
    // Try direct aria-label match first
    submitButton = grandParent.querySelector('button[aria-label="Send now"]');

    // Search in toolbars
    if (!submitButton) {
      const toolbars = grandParent.querySelectorAll('[role="toolbar"]');
      for (const toolbar of toolbars) {
        // Skip formatting toolbars
        if (toolbar.getAttribute('aria-label')?.includes('Formatting')) continue;

        const buttons = toolbar.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim().toLowerCase() || '';
          const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
          if ((text.includes('send') || ariaLabel.includes('send')) &&
              !text.includes('schedule') && !ariaLabel.includes('schedule')) {
            submitButton = btn;
            break;
          }
        }
        if (submitButton) break;
      }
    }
  }

  // Strategy 2: Fallback to common form patterns
  if (!submitButton) {
    const parent = el.closest('form, [role="form"], .chat-input-container, .message-input, .input-wrapper, [class*="composer"]');
    if (parent) {
      submitButton = parent.querySelector(
        'button[type="submit"], ' +
        'button[aria-label*="send" i]:not([aria-label*="schedule" i]), ' +
        'button[data-testid*="send" i], ' +
        'button.send-button, ' +
        '[role="button"][aria-label*="send" i]'
      );
    }
  }

  return submitButton;
}

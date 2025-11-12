/**
 * Hover element handler
 */

import { selectTabForTool, createErrorResult } from '../utils.js';
import { resolveAccessibilityRef } from '../element-resolver.js';
import { TAB_REGISTRATION_DELAY } from '../../../constants.js';

export async function handleHoverElement(params) {
  const ref = typeof params?.ref === 'string' ? params.ref.trim() : '';
  const selector = String(params?.selector || '').trim();

  if (!ref && !selector) {
    return createErrorResult('Hover failed', 'Missing element ref or selector parameter');
  }

  try {
    const selection = await selectTabForTool('hover_element');
    if (!selection.ok) {
      return createErrorResult('Hover failed', selection.error);
    }

    const { tabId, tab } = selection;

    // Resolve accessibility refs to CSS selectors
    const resolvedRef = resolveAccessibilityRef(ref, tabId);

    const [{ result: hovered }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: ({ sel, ref }) => {
        const resolveElementFromRef = (reference) => {
          if (typeof reference !== 'string' || reference.length === 0) return null;

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
        };

        const el = resolveElementFromRef(ref) || (sel ? document.querySelector(sel) : null);
        if (!el) return { success: false, error: 'Element not found' };
        const event = new MouseEvent('mouseover', { bubbles: true, cancelable: true });
        el.dispatchEvent(event);
        return { success: true };
      },
      args: [{ sel: selector, ref: resolvedRef }],
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    if (!hovered.success) {
      return createErrorResult('Hover failed', hovered.error || 'Hover failed');
    }

    const meta = {};
    if (tab?.url) meta.urls = [tab.url];
    if (typeof tabId === 'number') meta.tabId = tabId;

    return {
      ok: true,
      content: [
        {
          type: 'text',
      text: `Hovered over "${params?.element || selector || ref || 'target element'}"`,
        },
      ],
      _meta: Object.keys(meta).length ? meta : undefined,
      data: {
        url: tab.url,
        selector,
        ref,
        timestamp: new Date().toISOString(),
        tabId,
      },
    };
  } catch (e) {
    console.error('[MCP Tools] hover_element error:', e);
    return createErrorResult('Hover failed', e);
  }
}

/**
 * Selects an option from a dropdown
 */

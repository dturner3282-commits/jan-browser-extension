/**
 * Select option handler
 */

import { selectTabForTool, createErrorResult } from '../utils.js';
import { resolveAccessibilityRef } from '../element-resolver.js';

export async function handleSelectOption(params) {
  const ref = typeof params?.ref === 'string' ? params.ref.trim() : '';
  const selector = String(params?.selector || '').trim();
  const values = Array.isArray(params?.values) && params.values.length > 0
    ? params.values.map((val) => String(val))
    : (params?.value ? [String(params.value)] : []);

  if ((!ref && !selector) || values.length === 0) {
    return createErrorResult('Select option failed', 'Missing element ref/selector or values parameter');
  }

  try {
    const selection = await selectTabForTool('select_option');
    if (!selection.ok) {
      return createErrorResult('Select option failed', selection.error);
    }

    const { tabId, tab } = selection;

    // Resolve accessibility refs to CSS selectors
    const resolvedRef = resolveAccessibilityRef(ref, tabId);

    const [{ result: selected }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: ({ sel, ref, vals }) => {
        const resolveElementFromRef = (reference) => {
          if (typeof reference !== 'string' || reference.length === 0) return null;

          // Handle Shadow DOM references
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
        if (!el || el.tagName !== 'SELECT') return { success: false, error: 'Select element not found' };

        const normalizedValues = Array.isArray(vals) && vals.length ? vals : [];
        if (el.multiple) {
          const valueSet = new Set(normalizedValues);
          Array.from(el.options).forEach((option) => {
            option.selected = valueSet.has(option.value) || valueSet.has(option.textContent || '');
          });
        } else if (normalizedValues.length) {
          el.value = normalizedValues[0];
        }

        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, selectedValues: normalizedValues, finalValue: el.value };
      },
      args: [{ sel: selector, ref, vals: values }],
    });

    if (!selected.success) {
      return createErrorResult('Select option failed', selected.error || 'Selection failed');
    }

    const meta = {};
    if (tab?.url) meta.urls = [tab.url];
    if (typeof tabId === 'number') meta.tabId = tabId;

    return {
      ok: true,
      content: [
        {
          type: 'text',
          text: `Selected option in "${params?.element || selector || ref || 'target element'}"`,
        },
      ],
      _meta: Object.keys(meta).length ? meta : undefined,
      data: {
        url: tab.url,
        selector,
        ref,
        values,
        result: selected,
        timestamp: new Date().toISOString(),
        tabId,
      },
    };
  } catch (e) {
    console.error('[MCP Tools] select_option error:', e);
    return createErrorResult('Select option failed', e);
  }
}

/**
 * Press a keyboard key on the active element (or document body)
 */

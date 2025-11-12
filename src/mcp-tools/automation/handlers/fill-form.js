/**
 * Fill form handler
 */

import { selectTabForTool, createErrorResult } from '../utils.js';
import { resolveAccessibilityRef } from '../element-resolver.js';

export async function handleBrowserFillForm(params) {
  const fields = Array.isArray(params?.fields) ? params.fields : [];

  if (fields.length === 0) {
    return createErrorResult('Fill form failed', 'Missing or empty fields array');
  }

  console.log('[MCP Tools] browser_fill_form', { fieldCount: fields.length });

  try {
    const selection = await selectTabForTool('browser_fill_form');
    if (!selection.ok) {
      return createErrorResult('Fill form failed', selection.error);
    }

    const { tabId, tab } = selection;

    // Resolve accessibility refs to CSS selectors for each field
    const resolvedFields = fields.map(field => ({
      ...field,
      ref: field.ref ? resolveAccessibilityRef(field.ref, tabId) : field.ref,
    }));

    const [{ result: fillResult }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (fieldsToFill) => {
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

        const results = [];
        for (const field of fieldsToFill) {
          const el = resolveElementFromRef(field.ref) || (field.selector ? document.querySelector(field.selector) : null);
          if (!el) {
            results.push({ selector: field.selector, ref: field.ref, success: false, error: 'Element not found' });
            continue;
          }

          if (el.tagName === 'SELECT') {
            el.value = field.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = field.value === 'true' || field.value === true;
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            el.value = field.value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }

          results.push({ selector: field.selector, ref: field.ref, success: true, value: field.value });
        }
        return results;
      },
      args: [resolvedFields],
    });

    const failedFields = fillResult.filter((r) => !r.success);
    const successCount = fillResult.length - failedFields.length;

    console.log('[MCP Tools] form filled', { url: tab.url, successCount, failedCount: failedFields.length });

    const success = failedFields.length === 0;
    const status = success
      ? `Filled ${successCount} form fields`
      : `Filled ${successCount} of ${fields.length} form fields (some failed)`;

    const details = [];
    if (failedFields.length > 0) {
      const failedList = failedFields.map((f) => f.selector).join(', ');
      details.push(`Failed selectors: ${failedList.slice(0, 200)}`);
    }

    const meta = {};
    if (tab?.url) meta.urls = [tab.url];
    if (typeof tabId === 'number') meta.tabId = tabId;

    const response = {
      ok: success,
      content: [
        {
          type: 'text',
          text: status,
        },
      ],
      _meta: Object.keys(meta).length ? meta : undefined,
      data: {
        url: tab.url,
        totalFields: fields.length,
        successfulFields: successCount,
        failedFields,
        results: fillResult,
        timestamp: new Date().toISOString(),
        tabId,
      },
    };

    if (!success) {
      response.isError = true;
    }

    return response;
  } catch (e) {
    console.error('[MCP Tools] browser_fill_form error:', e);
    return createErrorResult('Fill form failed', e);
  }
}

/**
 * Types text into an element (supports input, textarea, and contenteditable)
 */

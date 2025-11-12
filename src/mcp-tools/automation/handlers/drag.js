/**
 * Drag element handler
 */

import { selectTabForTool, createErrorResult } from '../utils.js';
import { resolveAccessibilityRef } from '../element-resolver.js';

export async function handleDragElement(params = {}) {
  const startRef = typeof params?.startRef === 'string' ? params.startRef.trim() : '';
  const endRef = typeof params?.endRef === 'string' ? params.endRef.trim() : '';
  const fromSelector = String(params?.fromSelector || params?.startSelector || '').trim();
  const toSelector = String(params?.toSelector || params?.endSelector || '').trim();

  if ((!startRef && !fromSelector) || (!endRef && !toSelector)) {
    return createErrorResult('Drag failed', 'Missing drag start or end reference');
  }

  try {
    const selection = await selectTabForTool('drag_element');
    if (!selection.ok) {
      return createErrorResult('Drag failed', selection.error);
    }

    const { tabId, tab } = selection;

    // Resolve accessibility refs to CSS selectors
    const resolvedStartRef = resolveAccessibilityRef(startRef, tabId);
    const resolvedEndRef = resolveAccessibilityRef(endRef, tabId);

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: ({ startParams, endParams }) => {
        const resolveElement = ({ ref, selector }) => {
          // Handle Shadow DOM references
          if (typeof ref === 'string' && ref.includes('##')) {
            const parts = ref.split('##');
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

          // Regular CSS selector from ref
          if (typeof ref === 'string' && ref.startsWith('css:')) {
            const selectorText = ref.slice(4);
            if (selectorText) {
              try {
                const resolved = document.querySelector(selectorText);
                if (resolved) return resolved;
              } catch (_) {
                // ignore
              }
            }
          }

          // Fallback to selector parameter
          if (selector) {
            try {
              return document.querySelector(selector);
            } catch (_) {
              return null;
            }
          }
          return null;
        };

        const start = resolveElement(startParams);
        const end = resolveElement(endParams);
        if (!start) {
          return { success: false, error: 'Start element not found' };
        }
        if (!end) {
          return { success: false, error: 'End element not found' };
        }

        const startRect = start.getBoundingClientRect();
        const endRect = end.getBoundingClientRect();

        const startX = startRect.left + startRect.width / 2;
        const startY = startRect.top + startRect.height / 2;
        const endX = endRect.left + endRect.width / 2;
        const endY = endRect.top + endRect.height / 2;

        const pointerInit = (x, y) => ({
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
        });

        const movePointer = (x, y) => document.dispatchEvent(new PointerEvent('pointermove', {
          ...pointerInit(x, y),
          buttons: 1,
        }));

        start.dispatchEvent(new PointerEvent('pointerdown', { ...pointerInit(startX, startY), buttons: 1 }));
        start.dispatchEvent(new MouseEvent('mousedown', { ...pointerInit(startX, startY), buttons: 1 }));

        const steps = 6;
        for (let i = 1; i <= steps; i += 1) {
          const progress = i / steps;
          const x = startX + (endX - startX) * progress;
          const y = startY + (endY - startY) * progress;
          movePointer(x, y);
        }

        end.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit(endX, endY) }));
        end.dispatchEvent(new MouseEvent('mouseup', { ...pointerInit(endX, endY) }));

        return {
          success: true,
          startTag: start.tagName,
          endTag: end.tagName,
        };
      },
      args: [{ startParams: { ref: resolvedStartRef, selector: fromSelector }, endParams: { ref: resolvedEndRef, selector: toSelector } }],
    });

    if (!result?.success) {
      return createErrorResult('Drag failed', result?.error || 'Drag operation failed');
    }

    const meta = {};
    if (tab?.url) meta.urls = [tab.url];
    if (typeof tabId === 'number') meta.tabId = tabId;

    return {
      ok: true,
      content: [
        {
          type: 'text',
          text: `Dragged "${params?.startElement || fromSelector || startRef || 'start element'}" to "${params?.endElement || toSelector || endRef || 'end element'}"`,
        },
      ],
      _meta: Object.keys(meta).length ? meta : undefined,
      data: {
        url: tab?.url,
        fromSelector,
        toSelector,
        startRef,
        endRef,
        startTag: result.startTag,
        endTag: result.endTag,
        timestamp: new Date().toISOString(),
        tabId,
      },
    };
  } catch (e) {
    console.error('[MCP Tools] drag_element error:', e);
    return createErrorResult('Drag failed', e);
  }
}

/**
 * Press key handler
 */

import { selectTabForTool, createErrorResult } from '../utils.js';

export async function handlePressKey(params = {}) {
  const key = String(params?.key || '').trim();

  if (!key) {
    return createErrorResult('Press key failed', 'Missing key parameter');
  }

  try {
    const selection = await selectTabForTool('press_key');
    if (!selection.ok) {
      return createErrorResult('Press key failed', selection.error);
    }

    const { tabId, tab } = selection;

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (pressedKey) => {
        const target = document.activeElement && document.activeElement !== document.body
          ? document.activeElement
          : document.body;
        if (!target) {
          return { success: false, error: 'No active element to dispatch key events' };
        }

        const keyCode = pressedKey.length === 1 ? pressedKey.toUpperCase().charCodeAt(0) : 0;
        const eventInit = {
          key: pressedKey,
          code: pressedKey.length === 1 ? `Key${pressedKey.toUpperCase()}` : pressedKey,
          keyCode,
          which: keyCode,
          bubbles: true,
          cancelable: true,
        };

        const keydown = new KeyboardEvent('keydown', eventInit);
        target.dispatchEvent(keydown);

        if (!keydown.defaultPrevented) {
          const keypress = new KeyboardEvent('keypress', eventInit);
          target.dispatchEvent(keypress);
        }

        const keyup = new KeyboardEvent('keyup', eventInit);
        target.dispatchEvent(keyup);

        return { success: true, tagName: target.tagName || 'BODY' };
      },
      args: [key],
    });

    if (!result?.success) {
      return createErrorResult('Press key failed', result?.error || 'Key dispatch failed');
    }

    const meta = {};
    if (tab?.url) meta.urls = [tab.url];
    if (typeof tabId === 'number') meta.tabId = tabId;

    return {
      ok: true,
      content: [
        {
          type: 'text',
          text: `Pressed key ${key}`,
        },
      ],
      _meta: Object.keys(meta).length ? meta : undefined,
      data: {
        url: tab?.url,
        key,
        target: result.tagName,
        timestamp: new Date().toISOString(),
        tabId,
      },
    };
  } catch (e) {
    console.error('[MCP Tools] press_key error:', e);
    return createErrorResult('Press key failed', e);
  }
}

/**
 * Drag an element and drop it on another element
 */

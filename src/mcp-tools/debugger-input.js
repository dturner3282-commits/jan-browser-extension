// debugger-input.js
// Human-like input helpers for driving Chrome debugger mouse and keyboard events

import { attachDebugger, detachDebugger, sendDebuggerCommand } from './snapshot-utils.js';

export const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_CURSOR_POSITION = { x: 400, y: 300 };
const KEY_DELAY_RANGE = { min: 24, max: 62 };
const MOUSE_BUTTON_MASK = { left: 1, right: 2, middle: 4 };

const cursorStateByTab = new Map();

const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function getCursorState(tabId) {
  if (!cursorStateByTab.has(tabId)) {
    cursorStateByTab.set(tabId, { ...DEFAULT_CURSOR_POSITION, initialized: false });
  }
  return cursorStateByTab.get(tabId);
}

function setCursorState(tabId, state) {
  cursorStateByTab.set(tabId, state);
}

async function withDebuggerSession(tabId, handler) {
  const target = { tabId };
  await attachDebugger(target);
  try {
    const send = (method, params) => sendDebuggerCommand(target, method, params);
    return await handler(send);
  } finally {
    try {
      await detachDebugger(target);
    } catch (err) {
      console.warn('[MCP Tools] Failed to detach debugger session', err);
    }
  }
}

async function driveCursorSteps(send, start, target, steps) {
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const x = start.x + (target.x - start.x) * progress;
    const y = start.y + (target.y - start.y) * progress;
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
    });
    await waitMs(randomBetween(6, 14));
  }
}

/**
 * Click at a point using JavaScript (works on background/hidden tabs).
 * Uses elementFromPoint to find the element and dispatches synthetic mouse events.
 * These are "untrusted" events (isTrusted: false) but work without tab visibility.
 */
export async function clickPointWithJS(tabId, point, options = {}) {
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
    throw new Error('Invalid cursor point');
  }

  const { button = 'left', clickCount = 1 } = options;

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN', // Required to interact with React/Vue/Angular event systems
    func: ({ x, y, button, clickCount }) => {
      const element = document.elementFromPoint(x, y);
      if (!element) {
        return { success: false, error: `No element found at (${x}, ${y})` };
      }

      const buttonNumber = button === 'right' ? 2 : button === 'middle' ? 1 : 0;

      const eventOptions = {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: buttonNumber,
        buttons: buttonNumber === 0 ? 1 : buttonNumber === 2 ? 2 : 4,
      };

      // Dispatch full mouse event sequence: mouseover, mousedown, mouseup, click
      element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
      element.dispatchEvent(new MouseEvent('mouseenter', { ...eventOptions, bubbles: false }));
      element.dispatchEvent(new MouseEvent('mousemove', eventOptions));
      element.dispatchEvent(new MouseEvent('mousedown', eventOptions));

      // Focus the element if it's focusable
      if (typeof element.focus === 'function') {
        try {
          element.focus();
        } catch (e) {
          // Ignore focus errors
        }
      }

      element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      element.dispatchEvent(new MouseEvent('click', { ...eventOptions, detail: clickCount }));

      // For double-click
      if (clickCount === 2) {
        element.dispatchEvent(new MouseEvent('dblclick', { ...eventOptions, detail: 2 }));
      }

      return {
        success: true,
        tagName: element.tagName,
        id: element.id || null,
        className: element.className || null,
      };
    },
    args: [{ x: point.x, y: point.y, button, clickCount }],
  });

  if (!result?.success) {
    throw new Error(result?.error || 'JS click failed');
  }

  return result;
}

/**
 * Click at a point using Chrome DevTools Protocol (produces trusted events).
 * NOTE: This requires the tab to be visible/active to work correctly.
 * Use clickPointWithJS for background tabs.
 */
export async function clickPointWithDebugger(tabId, point, options = {}) {
  if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
    throw new Error('Invalid cursor point');
  }

  const { steps = 12, button = 'left', clickCount = 1 } = options;
  const mask = MOUSE_BUTTON_MASK[button] ?? MOUSE_BUTTON_MASK.left;
  const state = getCursorState(tabId);
  const start = state.initialized ? state : point;

  await withDebuggerSession(tabId, async (send) => {
    await driveCursorSteps(send, start, point, steps);

    await waitMs(randomBetween(12, 28));
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button,
      buttons: mask,
      pointerType: 'mouse',
      clickCount,
    });

    await waitMs(randomBetween(28, 52));
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button,
      buttons: 0,
      pointerType: 'mouse',
      clickCount,
    });
  });

  setCursorState(tabId, { x: point.x, y: point.y, initialized: true });
}

/**
 * Ensures the tab is visible/active before performing operations that require it.
 * Returns the previously active tab info so focus can be restored after the operation.
 */
async function ensureTabVisible(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const [currentActiveTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });

    if (tab.active) {
      return { wasActive: true, previousTabId: null, windowId: tab.windowId };
    }

    await chrome.tabs.update(tabId, { active: true });
    await waitMs(50);

    return {
      wasActive: false,
      previousTabId: currentActiveTab?.id ?? null,
      windowId: tab.windowId
    };
  } catch (err) {
    console.warn('[debugger-input] ensureTabVisible failed:', err);
    return { wasActive: true, previousTabId: null, windowId: null };
  }
}

/**
 * Restores focus to the previously active tab after operations.
 */
async function restoreTabFocus(previousState) {
  if (previousState.wasActive || !previousState.previousTabId) {
    return;
  }

  try {
    await chrome.tabs.update(previousState.previousTabId, { active: true });
  } catch (err) {
    console.warn('[debugger-input] restoreTabFocus failed:', err);
  }
}

/**
 * Check if a tab is currently active AND its window is focused.
 * Both conditions must be true for debugger input methods to work reliably.
 */
async function isTabActive(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) {
      return false;
    }
    // Also check if the window is focused - debugger methods need actual window focus
    const window = await chrome.windows.get(tab.windowId);
    return window.focused;
  } catch {
    return false;
  }
}

/**
 * Smart click that uses debugger for active tabs (trusted events),
 * or JS-based clicking for hidden tabs (with debugger fallback).
 */
export async function clickPoint(tabId, point, options = {}) {
  // If tab is already active, use debugger directly (trusted events, no issues)
  if (await isTabActive(tabId)) {
    await clickPointWithDebugger(tabId, point, options);
    return { success: true, method: 'debugger' };
  }

  // Tab is not active - try JS-based click first (works on background tabs)
  try {
    const result = await clickPointWithJS(tabId, point, options);
    console.log('[debugger-input] JS click succeeded on hidden tab:', result);
    return result;
  } catch (jsErr) {
    console.warn('[debugger-input] JS click failed, activating tab for debugger:', jsErr);
  }

  // Fall back to debugger-based click (activate tab temporarily)
  const previousTabState = await ensureTabVisible(tabId);

  try {
    await clickPointWithDebugger(tabId, point, options);
    return { success: true, method: 'debugger' };
  } finally {
    await restoreTabFocus(previousTabState);
  }
}

const SPECIAL_KEYS = {
  Enter: { key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 },
  Tab: { key: 'Tab', code: 'Tab', text: '\t', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', text: '', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
  Space: { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 },
};

function normalizeKeyName(name) {
  if (!name) return '';
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (['ctrl', 'control', 'cmdorctrl'].includes(lower)) return 'Control';
  if (['cmd', 'meta', 'command', 'super', '⌘'].includes(lower)) return 'Meta';
  if (['alt', 'option', '⌥'].includes(lower)) return 'Alt';
  if (['shift', '⇧'].includes(lower)) return 'Shift';
  if (['enter', 'return', '↩', '⏎'].includes(lower)) return 'Enter';
  if (['esc', 'escape'].includes(lower)) return 'Escape';
  if (['space', 'spacebar'].includes(lower)) return 'Space';
  if (['tab'].includes(lower)) return 'Tab';
  if (['arrowleft', 'left'].includes(lower)) return 'ArrowLeft';
  if (['arrowright', 'right'].includes(lower)) return 'ArrowRight';
  if (['arrowup', 'up'].includes(lower)) return 'ArrowUp';
  if (['arrowdown', 'down'].includes(lower)) return 'ArrowDown';
  return trimmed;
}

function keyPayloadForChar(char) {
  const codePoint = char.codePointAt(0);
  if (char === ' ') {
    return { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 };
  }

  if (/^[a-z]$/i.test(char)) {
    const upper = char.toUpperCase();
    return {
      key: upper === char ? char : upper,
      code: `Key${upper}`,
      text: char,
      windowsVirtualKeyCode: upper.charCodeAt(0),
      nativeVirtualKeyCode: upper.charCodeAt(0),
    };
  }

  if (/^[0-9]$/.test(char)) {
    return {
      key: char,
      code: `Digit${char}`,
      text: char,
      windowsVirtualKeyCode: 48 + Number(char),
      nativeVirtualKeyCode: 48 + Number(char),
    };
  }

  return {
    key: char,
    text: char,
    windowsVirtualKeyCode: codePoint && codePoint <= 0xffff ? codePoint : undefined,
    nativeVirtualKeyCode: codePoint && codePoint <= 0xffff ? codePoint : undefined,
  };
}

async function dispatchKey(send, payload, includeCharEvent = true) {
  const { text, unmodifiedText, ...keyPayload } = payload;
  const isTextual = includeCharEvent && Boolean(text);
  const keyDownType = isTextual ? 'rawKeyDown' : 'keyDown';

  await send('Input.dispatchKeyEvent', {
    type: keyDownType,
    ...keyPayload,
  });

  if (isTextual) {
    await send('Input.dispatchKeyEvent', {
      type: 'char',
      text,
      unmodifiedText: unmodifiedText ?? text,
      key: payload.key,
    });
  }

  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    ...keyPayload,
  });
}

async function dispatchSpecialKey(send, keyName) {
  const payload = SPECIAL_KEYS[keyName];
  if (!payload) {
    throw new Error(`Unsupported special key: ${keyName}`);
  }
  await dispatchKey(send, payload, keyName !== 'Backspace');
}

async function selectAllWithModifier(send, modifier) {
  const modifierBits = { Control: 2, Meta: 4 };
  const modifierKeyCodes = { Control: 17, Meta: 91 };
  const modifierCodes = { Control: 'ControlLeft', Meta: 'MetaLeft' };
  const modifierBit = modifierBits[modifier];
  const modifierKeyCode = modifierKeyCodes[modifier];
  const modifierCode = modifierCodes[modifier];

  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: modifier,
    code: modifierCode,
    windowsVirtualKeyCode: modifierKeyCode,
    nativeVirtualKeyCode: modifierKeyCode,
  });

  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    text: 'a',
    unmodifiedText: 'a',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: modifierBit,
  });

  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    text: 'a',
    unmodifiedText: 'a',
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65,
    modifiers: modifierBit,
  });

  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: modifier,
    code: modifierCode,
    windowsVirtualKeyCode: modifierKeyCode,
    nativeVirtualKeyCode: modifierKeyCode,
  });
}

async function clearExistingText(send) {
  for (const modifier of ['Control', 'Meta']) {
    await selectAllWithModifier(send, modifier);
    await waitMs(40);
  }
  await dispatchSpecialKey(send, 'Backspace');
  await waitMs(60);
}

/**
 * Type text using JavaScript (works on background/hidden tabs).
 * Uses native value setter to bypass React/Vue/Angular framework checks.
 * Can optionally accept a point to find the element at that location.
 */
export async function typeTextWithJS(tabId, text, options = {}) {
  const { pressEnter = false, clear = false, point = null } = options;
  const content = typeof text === 'string' ? text : String(text ?? '');

  console.log('[debugger-input] typeTextWithJS called:', { tabId, text: content.slice(0, 50), point, clear, pressEnter });

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN', // Required to interact with React/Vue/Angular event systems
    func: ({ text, clear, pressEnter, point }) => {
      console.log('[typeTextWithJS injected] Starting, point:', point, 'text length:', text.length);
      const findElementAtPoint = (root, x, y) => {
        if (!root?.elementFromPoint) return null;
        const el = root.elementFromPoint(x, y);
        if (!el) return null;

        // Drill into shadow DOM if present
        if (el.shadowRoot?.elementFromPoint) {
          const shadowHit = el.shadowRoot.elementFromPoint(x, y);
          if (shadowHit) return shadowHit;
        }

        // Drill into same-origin iframes
        if (el.tagName === 'IFRAME' && el.contentDocument) {
          const rect = el.getBoundingClientRect();
          const insideX = x - rect.left;
          const insideY = y - rect.top;
          const frameHit = findElementAtPoint(el.contentDocument, insideX, insideY);
          if (frameHit) return frameHit;
        }

        return el;
      };

      let targetElement = null;

      // If point is provided, find element at that location
      if (point && typeof point.x === 'number' && typeof point.y === 'number') {
        targetElement = findElementAtPoint(document, point.x, point.y);
        console.log('[typeTextWithJS injected] Found element at point:', targetElement?.tagName, targetElement?.id, targetElement?.className);
      }

      // Fall back to activeElement if no point or element not found
      if (!targetElement) {
        targetElement = document.activeElement;
        console.log('[typeTextWithJS injected] Using activeElement:', targetElement?.tagName, targetElement?.id);
      }

      if (!targetElement || targetElement === document.body || targetElement === document.documentElement) {
        console.log('[typeTextWithJS injected] No valid element found, activeElement is:', document.activeElement?.tagName);
        return { success: false, error: 'No element to type into' };
      }

      // Check if element is typeable
      const tagName = targetElement.tagName.toUpperCase();
      const isInput = tagName === 'INPUT' || tagName === 'TEXTAREA';
      const isContentEditable = targetElement.isContentEditable || targetElement.contentEditable === 'true';

      if (!isInput && !isContentEditable) {
        return { success: false, error: `Element ${tagName} is not typeable` };
      }

      // Helper: Use native setter to bypass React/Vue/Angular value tracking
      // Also resets React's _valueTracker so React detects the change
      const setNativeValue = (element, value) => {
        const lastValue = element.value;

        // Use native setter
        const proto = Object.getPrototypeOf(element);
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) {
          descriptor.set.call(element, value);
        } else {
          element.value = value;
        }

        // Reset React's _valueTracker so it detects the change
        // This is critical for React controlled inputs
        const tracker = element._valueTracker;
        if (tracker) {
          tracker.setValue(lastValue);
        }
      };

      // Try to focus element (may not work on hidden tabs, but try anyway)
      try {
        targetElement.focus();
      } catch (e) {
        // Ignore focus errors
      }

      // Clear existing text if requested
      if (clear) {
        if (isInput) {
          setNativeValue(targetElement, '');
        } else if (isContentEditable) {
          targetElement.textContent = '';
        }
        targetElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      }

      // Type the text
      if (isInput) {
        const currentValue = targetElement.value || '';
        const newValue = currentValue + text;
        console.log('[typeTextWithJS injected] Setting value from', JSON.stringify(currentValue), 'to', JSON.stringify(newValue));
        setNativeValue(targetElement, newValue);
        console.log('[typeTextWithJS injected] After setNativeValue, element.value is:', JSON.stringify(targetElement.value));
      } else if (isContentEditable) {
        targetElement.textContent = (targetElement.textContent || '') + text;
      }

      // Dispatch events - order matters for React: input then change
      console.log('[typeTextWithJS injected] Dispatching input and change events');
      targetElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      targetElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

      // Also dispatch InputEvent for modern frameworks
      try {
        targetElement.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        }));
      } catch (e) {
        // InputEvent may not be supported in all environments
      }

      // Press Enter if requested
      if (pressEnter) {
        const enterEventOptions = {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        };
        targetElement.dispatchEvent(new KeyboardEvent('keydown', enterEventOptions));
        targetElement.dispatchEvent(new KeyboardEvent('keypress', enterEventOptions));
        targetElement.dispatchEvent(new KeyboardEvent('keyup', enterEventOptions));

        // Submit form if in a form
        if (targetElement.form) {
          // Try requestSubmit first (modern), then dispatchEvent
          if (typeof targetElement.form.requestSubmit === 'function') {
            try {
              targetElement.form.requestSubmit();
            } catch (e) {
              targetElement.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
          } else {
            targetElement.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }
      }

      return {
        success: true,
        typedCharacters: text.length,
        pressedEnter: pressEnter,
        cleared: clear,
        elementTag: tagName,
        elementId: targetElement.id || null,
      };
    },
    args: [{ text: content, clear, pressEnter, point }],
  });

  console.log('[debugger-input] typeTextWithJS executeScript results:', results);

  const result = results?.[0]?.result;
  if (!result?.success) {
    console.error('[debugger-input] typeTextWithJS failed:', result);
    throw new Error(result?.error || 'JS type failed');
  }

  console.log('[debugger-input] typeTextWithJS succeeded:', result);
  return result;
}

/**
 * Type text using Chrome DevTools Protocol (produces trusted events).
 * NOTE: This requires the tab to be visible/active to work correctly.
 */
export async function typeTextWithDebugger(tabId, text, options = {}) {
  const { pressEnter = false, clear = false } = options;
  const content = typeof text === 'string' ? text : String(text ?? '');
  return withDebuggerSession(tabId, async (send) => {
    if (clear) {
      await clearExistingText(send);
    }

    // Use insertText to preserve all characters (including extended/utf punctuation)
    await send('Input.insertText', { text: content });
    await waitMs(randomBetween(20, 45));

    if (pressEnter) {
      await dispatchSpecialKey(send, 'Enter');
    }

    return {
      success: true,
      typedCharacters: content.length,
      pressedEnter: pressEnter,
      cleared: clear,
    };
  });
}

/**
 * Smart type that uses debugger for active tabs (trusted events),
 * or JS-based typing for hidden tabs (with debugger fallback).
 */
export async function typeText(tabId, text, options = {}) {
  const tabActive = await isTabActive(tabId);
  console.log('[debugger-input] typeText called, tabId:', tabId, 'tabActive:', tabActive, 'hasPoint:', !!options.point);

  // If tab is already active AND window is focused, use debugger directly (trusted events)
  if (tabActive) {
    console.log('[debugger-input] Using debugger for active/focused tab');
    return await typeTextWithDebugger(tabId, text, options);
  }

  // Tab is not active or window not focused - use JS-based typing (works on background tabs)
  console.log('[debugger-input] Tab not active/focused, using JS-based typing');
  try {
    const result = await typeTextWithJS(tabId, text, options);
    console.log('[debugger-input] JS type succeeded:', result);
    return result;
  } catch (jsErr) {
    console.warn('[debugger-input] JS type failed, activating tab for debugger fallback:', jsErr);
  }

  // Fall back to debugger-based typing (activate tab temporarily)
  const previousTabState = await ensureTabVisible(tabId);

  try {
    if (options?.point) {
      try {
        await clickPointWithDebugger(tabId, options.point, options);
      } catch (focusErr) {
        console.warn('[debugger-input] Failed to focus target before debugger typing:', focusErr);
      }
    }
    return await typeTextWithDebugger(tabId, text, options);
  } finally {
    await restoreTabFocus(previousTabState);
  }
}

/**
 * Send keys using JavaScript (works on background/hidden tabs).
 * Dispatches KeyboardEvent for each key.
 * Can optionally accept a point to find the element at that location.
 */
export async function sendKeysWithJS(tabId, keys, options = {}) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return { success: true, pressed: 0, sequence: [] };
  }

  const { point = null } = options;

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN', // Required to interact with React/Vue/Angular event systems
    func: ({ keys, point }) => {
      const findElementAtPoint = (root, x, y) => {
        if (!root?.elementFromPoint) return null;
        const el = root.elementFromPoint(x, y);
        if (!el) return null;

        // Drill into shadow DOM if present
        if (el.shadowRoot?.elementFromPoint) {
          const shadowHit = el.shadowRoot.elementFromPoint(x, y);
          if (shadowHit) return shadowHit;
        }

        // Drill into same-origin iframes
        if (el.tagName === 'IFRAME' && el.contentDocument) {
          const rect = el.getBoundingClientRect();
          const insideX = x - rect.left;
          const insideY = y - rect.top;
          const frameHit = findElementAtPoint(el.contentDocument, insideX, insideY);
          if (frameHit) return frameHit;
        }

        return el;
      };

      let targetElement = null;

      // If point is provided, find element at that location
      if (point && typeof point.x === 'number' && typeof point.y === 'number') {
        targetElement = findElementAtPoint(document, point.x, point.y);
      }

      // Fall back to activeElement
      if (!targetElement) {
        targetElement = document.activeElement;
      }

      // Ultimate fallback to body
      if (!targetElement || targetElement === document.documentElement) {
        targetElement = document.body;
      }

      // Try to focus if possible
      if (targetElement && targetElement !== document.body) {
        try {
          targetElement.focus();
        } catch (e) {
          // Ignore focus errors
        }
      }

      const SPECIAL_KEY_MAP = {
        Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
        Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
        Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
        Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
        ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
        ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
        ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        Space: { key: ' ', code: 'Space', keyCode: 32 },
        Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
        Home: { key: 'Home', code: 'Home', keyCode: 36 },
        End: { key: 'End', code: 'End', keyCode: 35 },
        PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
        PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
      };

      let pressed = 0;
      const sequence = [];

      for (const key of keys) {
        if (!key) continue;

        const specialKey = SPECIAL_KEY_MAP[key];
        const keyInfo = specialKey || {
          key: key,
          code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
          keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
        };

        const eventOptions = {
          key: keyInfo.key,
          code: keyInfo.code,
          keyCode: keyInfo.keyCode,
          which: keyInfo.keyCode,
          bubbles: true,
          cancelable: true,
        };

        targetElement.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
        targetElement.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
        targetElement.dispatchEvent(new KeyboardEvent('keyup', eventOptions));

        // Special handling for Enter key - submit form if in a form
        if (key === 'Enter' && targetElement.form) {
          if (typeof targetElement.form.requestSubmit === 'function') {
            try {
              targetElement.form.requestSubmit();
            } catch (e) {
              targetElement.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
          } else {
            targetElement.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }

        // Special handling for Backspace - remove last character from input
        if (key === 'Backspace') {
          const tagName = targetElement.tagName?.toUpperCase();
          if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
            const currentValue = targetElement.value || '';
            if (currentValue.length > 0) {
              // Use native setter for React compatibility (Object.getPrototypeOf is more robust)
              const proto = Object.getPrototypeOf(targetElement);
              const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
              if (descriptor && descriptor.set) {
                descriptor.set.call(targetElement, currentValue.slice(0, -1));
              } else {
                targetElement.value = currentValue.slice(0, -1);
              }
              targetElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
              targetElement.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            }
          }
        }

        pressed += 1;
        sequence.push(key);
      }

      return { success: true, pressed, sequence, targetTag: targetElement.tagName };
    },
    args: [{ keys, point }],
  });

  if (!result?.success) {
    throw new Error(result?.error || 'JS sendKeys failed');
  }

  return result;
}

/**
 * Send keys using Chrome DevTools Protocol (produces trusted events).
 * NOTE: This requires the tab to be visible/active to work correctly.
 */
export async function sendKeysWithDebugger(tabId, keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return { success: true, pressed: 0, sequence: [] };
  }

  const sequence = keys.map((key) => normalizeKeyName(String(key)));

  return withDebuggerSession(tabId, async (send) => {
    let pressed = 0;
    for (const key of sequence) {
      if (!key) continue;

      if (SPECIAL_KEYS[key]) {
        await dispatchKey(send, SPECIAL_KEYS[key], key !== 'Backspace');
        pressed += 1;
        await waitMs(randomBetween(8, 16));
        continue;
      }

      if (key.length === 1) {
        const payload = keyPayloadForChar(key);
        await dispatchKey(send, payload);
        pressed += 1;
        await waitMs(randomBetween(8, 18));
        continue;
      }

      const payload = {
        key,
        code: key,
        text: '',
        windowsVirtualKeyCode: undefined,
        nativeVirtualKeyCode: undefined,
      };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...payload });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...payload });
      pressed += 1;
      await waitMs(randomBetween(8, 18));
    }

    return { success: true, pressed, sequence };
  });
}

/**
 * Smart sendKeys that uses debugger for active tabs (trusted events),
 * or JS-based for hidden tabs (with debugger fallback).
 */
export async function sendKeys(tabId, keys, options = {}) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return { success: true, pressed: 0, sequence: [] };
  }

  // If tab is already active, use debugger directly (trusted events, no double-key issues)
  if (await isTabActive(tabId)) {
    return await sendKeysWithDebugger(tabId, keys);
  }

  // Tab is not active - try JS-based keys first (works on background tabs)
  try {
    const result = await sendKeysWithJS(tabId, keys, options);
    console.log('[debugger-input] JS sendKeys succeeded on hidden tab:', result);
    return result;
  } catch (jsErr) {
    console.warn('[debugger-input] JS sendKeys failed, activating tab for debugger:', jsErr);
  }

  // Fall back to debugger-based keys (activate tab temporarily)
  const previousTabState = await ensureTabVisible(tabId);

  try {
    if (options?.point) {
      try {
        await clickPointWithDebugger(tabId, options.point, options);
      } catch (focusErr) {
        console.warn('[debugger-input] Failed to focus target before debugger sendKeys:', focusErr);
      }
    }
    return await sendKeysWithDebugger(tabId, keys);
  } finally {
    await restoreTabFocus(previousTabState);
  }
}

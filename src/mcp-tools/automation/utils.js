/**
 * Shared utilities for automation tools
 */

/**
 * Create standardized error result
 */
export function createErrorResult(toolName, errorMessage) {
  return {
    success: false,
    error: errorMessage,
    toolName,
  };
}

/**
 * Select active tab or prompt user to select one
 * Returns { ok: true, tabId, tab } or { ok: false, error }
 */
export async function selectTabForTool(toolName) {
  const { selectTab } = await import('../utils.js');
  const selection = await selectTab({ toolName });

  if (!selection.ok) {
    return { ok: false, error: selection.error };
  }

  return { ok: true, ...selection };
}

/**
 * Execute a script in a tab with error handling
 */
export async function executeScriptSafely(tabId, func, args) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
    });
    return { success: true, result: result.result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Dispatch keyboard event with proper parameters
 */
export function createKeyboardEvent(type, char) {
  const keyCode = char.charCodeAt(0);
  const code = char.length === 1 && char.match(/[a-zA-Z]/) ? `Key${char.toUpperCase()}` : char;

  return {
    type,
    key: char,
    code,
    keyCode,
    which: keyCode,
    charCode: type === 'keypress' ? keyCode : 0,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
}

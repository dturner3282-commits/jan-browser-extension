/**
 * Script builder - inlines utility functions into injected scripts
 */

import * as elementUtils from './element-utils.js';

/**
 * Build a script function with utilities inlined
 * Replaces __UTILITY_NAME__ placeholders with actual function code
 */
export function buildScript(scriptFn) {
  let scriptCode = scriptFn.toString();

  // Replace utility function placeholders
  const replacements = {
    '__RESOLVE_ELEMENT_FROM_REF__': elementUtils.resolveElementFromRef.toString(),
    '__FIND_CLICKABLE_ELEMENT__': elementUtils.findClickableElement.toString(),
    '__SCROLL_INTO_VIEW__': elementUtils.scrollIntoView.toString(),
    '__GET_ELEMENT_CENTER__': elementUtils.getElementCenter.toString(),
    '__DISPATCH_MOUSE_EVENT__': elementUtils.dispatchMouseEvent.toString(),
  };

  for (const [placeholder, code] of Object.entries(replacements)) {
    scriptCode = scriptCode.replace(placeholder, code);
  }

  // Create a new function from the modified code
  // Extract parameters and body
  const match = scriptCode.match(/^[^(]*\(([^)]*)\)\s*{([\s\S]*)}$/);
  if (!match) {
    throw new Error('Failed to parse script function');
  }

  const params = match[1];
  const body = match[2];

  // Return as executable function
  return new Function(params, body);
}

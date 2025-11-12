// automation.js
// MCP Bridge automation tools: click, type, hover, fill_form, select_option, press_key, drag

// Import all refactored handlers
import { handleClickElement } from './automation/handlers/click.js';
import { handleTypeText } from './automation/handlers/type.js';
import { handleHoverElement } from './automation/handlers/hover.js';
import { handleBrowserFillForm } from './automation/handlers/fill-form.js';
import { handleSelectOption } from './automation/handlers/select-option.js';
import { handlePressKey } from './automation/handlers/press-key.js';
import { handleDragElement } from './automation/handlers/drag.js';

// Export all handlers
export {
  handleClickElement,
  handleTypeText,
  handleHoverElement,
  handleBrowserFillForm,
  handleSelectOption,
  handlePressKey,
  handleDragElement,
};

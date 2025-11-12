# Automation Tools - Refactored Structure

This directory contains the refactored automation tools, broken down into modular components for better maintainability.

## Structure

```
automation/
├── README.md (this file)
├── utils.js - Shared utilities (tab selection, error handling)
├── element-resolver.js - Element finding and resolution
├── keyboard.js - Keyboard event utilities
├── injected/
│   ├── element-utils.js - Common element utilities for injected scripts
│   ├── click-script.js - Click script template
│   └── script-builder.js - Script builder utilities
└── handlers/
    ├── click.js - ✅ COMPLETE - Click element handler
    └── type.js - 🚧 TODO - Type text handler (523 lines)
```

## Migration Status

### ✅ Completed
- **Utils module** (`utils.js`) - 60 lines
  - `createErrorResult()` - Standardized error formatting
  - `selectTabForTool()` - Tab selection wrapper
  - `executeScriptSafely()` - Safe script execution

- **Element Resolver** (`element-resolver.js`) - 160 lines
  - `resolveAccessibilityRef()` - Accessibility ref resolution
  - `resolveElementFromRef()` - Element finding (injected)
  - `findActualInputElement()` - Input wrapper detection
  - `findSubmitButton()` - Submit button finding (Slack fix)

- **Keyboard Utils** (`keyboard.js`) - 50 lines
  - `dispatchKey()` - Keyboard event dispatch
  - `isReactElement()` - React detection
  - `isVueElement()` - Vue detection
  - `getNativeValueSetter()` - Native setter access

- **Click Handler** (`handlers/click.js`) - 280 lines
  - Fully extracted and working
  - Uses new utility modules
  - Maintains all original functionality

### 🚧 In Progress
- **Type Handler** (`handlers/type.js`)
  - 523 lines (most complex handler)
  - Includes DraftJS/React support
  - Submit button integration
  - Needs extraction

### 📋 TODO
- **Hover Handler** (~150 lines) - Simple, quick to extract
- **Fill Form Handler** (~200 lines) - Medium complexity
- **Select Option Handler** (~120 lines) - Simple
- **Press Key Handler** (~80 lines) - Simple
- **Drag Handler** (~160 lines) - Medium complexity

## Usage

### Importing Refactored Handlers

```javascript
// In main automation.js
import { handleClickElement } from './automation/handlers/click.js';

// Export for use by MCP bridge
export { handleClickElement };
```

### Using Utilities in New Handlers

```javascript
import { selectTabForTool, createErrorResult } from '../utils.js';
import { resolveAccessibilityRef } from '../element-resolver.js';

export async function handleMyTool(params) {
  const selection = await selectTabForTool('my_tool');
  if (!selection.ok) {
    return createErrorResult('My tool failed', selection.error);
  }

  const { tabId } = selection;
  const resolvedRef = resolveAccessibilityRef(params.ref, tabId);

  // ... rest of implementation
}
```

## Benefits

1. **Reduced Code Duplication**
   - Tab selection: Was repeated 7 times, now 1 function
   - Element resolution: Was repeated 7 times, now 1 function
   - Error handling: Standardized across all tools

2. **Better Testability**
   - Each module can be unit tested independently
   - Mock dependencies easily
   - Isolated testing of business logic

3. **Improved Maintainability**
   - Smaller files are easier to understand
   - Clear separation of concerns
   - Easy to find and fix bugs

4. **Easier to Extend**
   - Add new tools using existing utilities
   - Share common patterns
   - Consistent code style

## Migration Guide

To extract a handler:

1. **Create handler file**: `automation/handlers/[name].js`
2. **Add imports**:
   ```javascript
   import { selectTabForTool, createErrorResult } from '../utils.js';
   import { resolveAccessibilityRef } from '../element-resolver.js';
   ```
3. **Replace inline calls**:
   - `selectTab({ toolName: 'foo' })` → `selectTabForTool('foo')`
   - Keep injected script as-is (inline function)
4. **Export handler**: `export async function handleFoo(params) { ... }`
5. **Update main file**:
   ```javascript
   import { handleFoo } from './automation/handlers/foo.js';
   export { handleFoo };
   ```
6. **Test thoroughly**
7. **Delete old inline version**

## Testing

After extracting each handler:

```bash
# Build
npm run build:all

# Test manually
# (Load extension, test the specific tool)

# Verify no regressions
```

## Next Steps

**Option A**: Complete all extractions (4-6 hours)
- Systematic extraction of all handlers
- Full testing suite
- Complete refactor

**Option B**: Incremental migration (recommended)
- Extract handlers as needed
- Use new utilities for new tools
- Gradual improvement

**Option C**: Keep current state
- Click handler fully extracted (working example)
- Utilities available for reuse
- Remaining handlers stay inline

The foundation is in place. We can proceed with any option based on project priorities.

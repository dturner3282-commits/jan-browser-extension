/**
 * Type text handler
 * Includes DraftJS support, React/Vue handling, and submit button integration
 */

import { selectTabForTool, createErrorResult } from '../utils.js';
import { resolveAccessibilityRef } from '../element-resolver.js';


export async function handleTypeText(params) {
  const ref = typeof params?.ref === 'string' ? params.ref.trim() : '';
  const selector = String(params?.selector || '').trim();
  const text = String(params?.text || '');
  const clear = params?.clear !== false;
  const pressEnter = params?.pressEnter === true;

  if (!ref && !selector) {
    return createErrorResult('Type text failed', 'Missing element ref or selector parameter');
  }

  try {
    const selection = await selectTabForTool('type_text');
    if (!selection.ok) {
      return createErrorResult('Type text failed', selection.error);
    }

    const { tabId, tab } = selection;

    // Resolve accessibility refs to CSS selectors
    const resolvedRef = resolveAccessibilityRef(ref, tabId);

    const [{ result: typed }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: ({ sel, ref, txt, clr, pressEnter }) => {
        const resolveElementFromRef = (reference) => {
          if (typeof reference !== 'string' || reference.length === 0) return null;

          // Handle Shadow DOM references (format: css:host##shadow-selector##nested)
          if (reference.includes('##')) {
            const parts = reference.split('##');

            // First part should be the host element (css:...)
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

            // Traverse through shadow DOMs
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

        let el = resolveElementFromRef(ref) || (sel ? document.querySelector(sel) : null);
        if (!el) return { success: false, error: 'Element not found' };

        // Smart element detection - find the actual typeable element
        // Some divs with role="textbox" contain an actual input inside
        const actualInput = el.querySelector('input, textarea, [contenteditable="true"]');
        if (actualInput && (actualInput.tagName === 'INPUT' || actualInput.tagName === 'TEXTAREA' || actualInput.contentEditable === 'true')) {
          el = actualInput;
        }

        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // Simulate realistic mouse interaction
        el.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
        }));

        // Focus with multiple strategies
        el.focus();

        // For contenteditable, also try clicking
        if (el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true') {
          el.click();
        }

        el.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: x,
          clientY: y,
        }));

        function dispatchKey(element, type, char) {
          const keyCode = char.charCodeAt(0);
          const code = char.length === 1 && char.match(/[a-zA-Z]/) ? `Key${char.toUpperCase()}` : char;

          element.dispatchEvent(new KeyboardEvent(type, {
            key: char,
            code,
            keyCode,
            which: keyCode,
            charCode: type === 'keypress' ? keyCode : 0,
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
          }));
        }

        // Smart input detection
        const isContentEditable = el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true';
        const isQuillEditor = el.classList.contains('ql-editor') || el.closest('.ql-container') !== null;
        const isTinyMCE = el.classList.contains('tox-edit-area') || el.id?.includes('tinymce');
        const isDraftJS = el.classList.contains('public-DraftEditor-content') ||
                          el.classList.contains('DraftEditor-editorContainer') ||
                          el.querySelector('.public-DraftEditor-content') !== null ||
                          el.closest('.DraftEditor-root') !== null;
        const hasRoleTextbox = el.getAttribute('role') === 'textbox';
        const isRichEditor = isQuillEditor || isTinyMCE || isDraftJS || (isContentEditable && hasRoleTextbox);

        // For DraftJS editors, ensure we target the actual contenteditable element
        if (isDraftJS && !el.classList.contains('public-DraftEditor-content')) {
          const draftContent = el.querySelector('.public-DraftEditor-content');
          if (draftContent) {
            el = draftContent;
          }
        }

        // Handle rich text editors (Quill, TinyMCE, etc.) or contenteditable with special care
        if (isContentEditable || isRichEditor) {
          // Clear existing content if requested
          if (clr) {
            el.textContent = '';
            el.innerHTML = '';

            // For Quill editors, also clear the internal structure
            if (isQuillEditor) {
              el.innerHTML = '<p><br></p>';
            }
          }

          // Focus the element first
          el.focus();

          // Set up selection at the end of content
          const selection = window.getSelection();
          const range = document.createRange();

          if (el.childNodes.length > 0) {
            const lastNode = el.childNodes[el.childNodes.length - 1];
            range.setStartAfter(lastNode);
            range.setEndAfter(lastNode);
          } else {
            range.selectNodeContents(el);
            range.collapse(false);
          }

          selection.removeAllRanges();
          selection.addRange(range);

          // Strategy 1: Try using execCommand with batched text (most reliable for React editors)
          let insertedSuccessfully = false;

          if (document.execCommand && txt.length > 0) {
            try {
              // execCommand('insertText') automatically fires beforeinput, input events with isTrusted: true
              // which React editors expect
              insertedSuccessfully = document.execCommand('insertText', false, txt);
            } catch (e) {
              insertedSuccessfully = false;
            }
          }

          // Strategy 2: If execCommand didn't work, try paste event approach (works for some editors)
          if (!insertedSuccessfully && txt.length > 0) {
            try {
              // Create a paste event with text data
              const dataTransfer = new DataTransfer();
              dataTransfer.setData('text/plain', txt);

              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dataTransfer,
                composed: true,
              });

              el.dispatchEvent(pasteEvent);

              if (!pasteEvent.defaultPrevented) {
                // If paste event wasn't handled, fall back to execCommand
                if (document.execCommand) {
                  try {
                    document.execCommand('insertText', false, txt);
                  } catch (e) {
                    // Continue to manual approach
                  }
                }
              }
              insertedSuccessfully = true;
            } catch (e) {
              insertedSuccessfully = false;
            }
          }

          // Strategy 3: Character-by-character insertion with proper event sequence (last resort)
          if (!insertedSuccessfully) {
            for (let i = 0; i < txt.length; i++) {
              const char = txt[i];

              // Dispatch beforeinput event (cancellable)
              const beforeInputEvent = new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: char,
                composed: true,
              });
              el.dispatchEvent(beforeInputEvent);

              if (!beforeInputEvent.defaultPrevented) {
                // Keyboard events before text insertion
                dispatchKey(el, 'keydown', char);
                dispatchKey(el, 'keypress', char);

                // Try execCommand per character (works with most rich editors)
                let inserted = false;
                if (document.execCommand) {
                  try {
                    inserted = document.execCommand('insertText', false, char);
                  } catch (e) {
                    inserted = false;
                  }
                }

                // Fallback to manual DOM manipulation
                if (!inserted) {
                  const textNode = document.createTextNode(char);
                  const sel = window.getSelection();
                  if (sel && sel.rangeCount > 0) {
                    const currentRange = sel.getRangeAt(0);
                    currentRange.deleteContents();
                    currentRange.insertNode(textNode);
                    currentRange.setStartAfter(textNode);
                    currentRange.setEndAfter(textNode);
                    sel.removeAllRanges();
                    sel.addRange(currentRange);
                  } else {
                    // Last resort: append to element
                    if (el.lastChild && el.lastChild.nodeName === 'P') {
                      el.lastChild.appendChild(textNode);
                    } else {
                      el.appendChild(textNode);
                    }
                  }
                }

                // Dispatch input event (non-cancellable)
                el.dispatchEvent(new InputEvent('input', {
                  bubbles: true,
                  cancelable: false,
                  inputType: 'insertText',
                  data: char,
                  composed: true,
                }));

                // Keyboard up event
                dispatchKey(el, 'keyup', char);
              }
            }
          }

          el.dispatchEvent(new Event('change', { bubbles: true }));

          if (pressEnter) {
            dispatchKey(el, 'keydown', 'Enter');
            dispatchKey(el, 'keypress', 'Enter');
            dispatchKey(el, 'keyup', 'Enter');

            // Find and click submit button
            let submitButton = null;
            const grandParent = el.closest('[role="group"]') || el.closest('.p-workspace__input') || el.closest('[class*="message_input"]');

            if (grandParent) {
              submitButton = grandParent.querySelector('button[aria-label="Send now"]');

              if (!submitButton) {
                const toolbars = grandParent.querySelectorAll('[role="toolbar"]');
                for (const toolbar of toolbars) {
                  if (toolbar.getAttribute('aria-label')?.includes('Formatting')) continue;
                  const buttons = toolbar.querySelectorAll('button');
                  for (const btn of buttons) {
                    const text = btn.textContent?.trim().toLowerCase() || '';
                    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
                    if ((text.includes('send') || ariaLabel.includes('send')) &&
                        !text.includes('schedule') && !ariaLabel.includes('schedule')) {
                      submitButton = btn;
                      break;
                    }
                  }
                  if (submitButton) break;
                }
              }
            }

            if (submitButton && !submitButton.disabled) {
              submitButton.click();
            }
          }

          return {
            success: true,
            type: 'contenteditable',
            pressedEnter: pressEnter,
            finalContent: el.textContent.slice(0, 100),
          };
        }

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          // Detect React/framework
          const isReact = Object.keys(el).some(key =>
            key.startsWith('__reactFiber') ||
            key.startsWith('__reactProps') ||
            key.startsWith('__reactInternalInstance')
          );
          const isVue = el.__vue__ || el.__vueParentComponent || el._value !== undefined;

          if (clr) {
            el.value = '';
          }

          // Get native setter to bypass framework getters/setters
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
            'value',
          )?.set;

          if (!nativeInputValueSetter) {
            return { success: false, error: 'Could not find native value setter' };
          }

          // Type character by character
          for (let i = 0; i < txt.length; i++) {
            const char = txt[i];
            const currentValue = el.value;

            // Set value using native setter (bypasses React/Vue)
            nativeInputValueSetter.call(el, currentValue + char);

            // Dispatch keyboard events
            dispatchKey(el, 'keydown', char);
            dispatchKey(el, 'keypress', char);

            // Dispatch input event - critical for React/Vue
            const inputEvent = new InputEvent('input', {
              bubbles: true,
              cancelable: false,
              inputType: 'insertText',
              data: char,
              composed: true,
            });

            // For React, ensure the event has a proper target
            if (isReact) {
              Object.defineProperty(inputEvent, 'target', {
                writable: false,
                value: el
              });
              Object.defineProperty(inputEvent, 'currentTarget', {
                writable: false,
                value: el
              });
            }

            el.dispatchEvent(inputEvent);

            dispatchKey(el, 'keyup', char);
          }

          // Final change event
          const changeEvent = new Event('change', { bubbles: true });
          if (isReact) {
            Object.defineProperty(changeEvent, 'target', {
              writable: false,
              value: el
            });
          }
          el.dispatchEvent(changeEvent);

          if (pressEnter) {
            dispatchKey(el, 'keydown', 'Enter');
            dispatchKey(el, 'keypress', 'Enter');
            if (el.form && el.tagName === 'INPUT') {
              el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
            dispatchKey(el, 'keyup', 'Enter');
          }

          return {
            success: true,
            type: el.tagName.toLowerCase(),
            pressedEnter: pressEnter,
            finalValue: el.value.slice(0, 100),
          };
        }

        // Last resort: check if element has any text input characteristics
        const hasTextboxRole = el.getAttribute('role') === 'textbox';
        const hasTabIndex = el.hasAttribute('tabindex');
        const looksLikeInput = hasTextboxRole || hasTabIndex;

        if (looksLikeInput) {
          // Try to set textContent directly for non-standard elements
          if (clr) {
            el.textContent = '';
            el.innerHTML = '';
          }

          el.focus();

          // Dispatch events as if it's contenteditable
          for (let i = 0; i < txt.length; i++) {
            const char = txt[i];

            dispatchKey(el, 'keydown', char);
            dispatchKey(el, 'keypress', char);

            // Try to insert text
            const textNode = document.createTextNode(char);
            if (el.lastChild && el.lastChild.nodeType === Node.TEXT_NODE) {
              el.lastChild.textContent += char;
            } else {
              el.appendChild(textNode);
            }

            el.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              inputType: 'insertText',
              data: char,
            }));

            dispatchKey(el, 'keyup', char);
          }

          el.dispatchEvent(new Event('change', { bubbles: true }));

          return {
            success: true,
            type: 'custom-input',
            pressedEnter: pressEnter,
            finalContent: el.textContent.slice(0, 100),
          };
        }

        return { success: false, error: 'Element is not a valid input, textarea, or contenteditable element' };
      },
      args: [{ sel: selector, ref: resolvedRef, txt: text, clr: clear, pressEnter }],
    });

    if (!typed.success) {
      return createErrorResult('Type text failed', typed.error || 'Typing failed');
    }

    const truncated = text.length > 80 ? `${text.slice(0, 77)}...` : text;
    const targetLabel = params?.element || selector || ref || 'target element';
    const status = pressEnter
      ? `Typed "${truncated}" and pressed Enter into "${targetLabel}"`
      : `Typed "${truncated}" into "${targetLabel}"`;

    const meta = {};
    if (tab?.url) meta.urls = [tab.url];
    if (typeof tabId === 'number') meta.tabId = tabId;

    return {
      ok: true,
      content: [
        {
          type: 'text',
          text: status,
        },
      ],
      _meta: Object.keys(meta).length ? meta : undefined,
      data: {
        url: tab.url,
        selector,
        ref,
        text: text.slice(0, 200),
        clear,
        pressEnter,
        result: typed,
        timestamp: new Date().toISOString(),
        tabId,
      },
    };
  } catch (e) {
    console.error('[MCP Tools] type_text error:', e);
    return createErrorResult('Type text failed', e);
  }
}

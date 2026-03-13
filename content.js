(() => {
  const TAG = "[GQR]";
  function warn(msg, detail) {
    console.warn(TAG, msg, detail ?? "");
  }

  const DEFAULTS = { labels: ["Done", "Acknowledged", "Duplicate comment"], autoResolve: false };
  let settings = { ...DEFAULTS };

  // ── Settings ──────────────────────────────────────────────────────────
  // Load labels and auto-resolve preference from chrome.storage.sync.
  // Re-inject buttons whenever settings change (including from the popup).

  function loadSettings() {
    chrome.storage.sync.get(DEFAULTS, (result) => {
      settings = result;
      reinjectAll();
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.labels) settings.labels = changes.labels.newValue;
    if (changes.autoResolve) settings.autoResolve = changes.autoResolve.newValue;
    reinjectAll();
  });

  // ── Re-injection ─────────────────────────────────────────────────────
  // Tear down all existing button rows and re-inject from scratch.
  // Called on settings change and initial load.

  function reinjectAll() {
    document.querySelectorAll(".gqr-buttons").forEach((el) => el.remove());
    document.querySelectorAll('[data-gqr-injected="true"]').forEach((el) => {
      el.removeAttribute("data-gqr-injected");
    });
    document.querySelectorAll('[class*="ThreadReply_threadReply__"]').forEach(injectButtons);
  }

  // ── Fill textarea ────────────────────────────────────────────────────
  // Sets the textarea value using the native setter (bypasses React's
  // synthetic event system) then dispatches an input event so React
  // picks up the change.

  function fillTextarea(textarea, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
  }

  // ── Find Resolve button ──────────────────────────────────────────────
  // The Resolve button lives in Card_gdsCardHeader, while ThreadReply is
  // inside Card_gdsCardBody. Both share a Card_gdsCard ancestor.
  // We look for a <span class="Button_gdsButtonText__*"> with text
  // "Resolve" and return its parent <button>.

  function findResolveButton(threadReply) {
    let container = threadReply.closest('[class*="Card_gdsCard__"]');
    if (!container) {
      container = threadReply.closest('[class*="CommentThread"]') || threadReply.parentElement;
      warn("Card_gdsCard__ ancestor not found, falling back", container?.className);
    }
    if (!container) {
      warn("No resolve button container found at all");
      return null;
    }

    const textSpans = container.querySelectorAll('[class*="Button_gdsButtonText__"]');
    for (const span of textSpans) {
      if (span.textContent.trim().toLowerCase() === "resolve") {
        return span.closest("button");
      }
    }

    // Fallback: any button whose full text content is "Resolve"
    const buttons = container.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.textContent.trim().toLowerCase() === "resolve") return btn;
    }

    warn("Resolve button not found in container", container.className);
    return null;
  }

  // ── Auto-submit and resolve ─────────────────────────────────────────
  // When auto-resolve is enabled, after filling the textarea:
  //   1. Uncheck "Add to review" if checked
  //   2. Click the submit button
  //   3. Click the Resolve button in the thread header
  //
  // Expected toolbar DOM:
  //   [role="toolbar"]
  //   ├── left group (attachment buttons)
  //   └── right group
  //       ├── Checkbox_gdsCheckbox__ → input[type="checkbox"] + "Add to review"
  //       └── <button> (submit — last button in toolbar)

  // Simulate a real click: pointerdown → mousedown → mouseup → click
  function simulateClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  }

  function autoSubmitAndResolve(threadReply) {
    if (!settings.autoResolve) return;

    // Find checkbox and submit button directly from threadReply.
    // The expanded editor adds a formatting [role="toolbar"], so we
    // can't rely on scoping to a single toolbar. Instead, find the
    // "Add to review" checkbox and the submit button (its sibling)
    // by their unique selectors.

    const checkboxContainer = threadReply.querySelector('[class*="Checkbox_gdsCheckbox__"]');
    const checkbox = checkboxContainer?.querySelector('input[type="checkbox"]');
    console.log(TAG, "checkbox", { found: !!checkboxContainer, checked: checkbox?.checked });

    if (!checkboxContainer) {
      warn("Add to review checkbox not found in ThreadReply");
    } else if (checkbox?.checked) {
      const label = checkboxContainer.querySelector("label");
      simulateClick(label || checkboxContainer);
      console.log(TAG, "checkbox after uncheck", checkbox.checked);
    }

    // Submit button is a sibling of the checkbox's flex group, inside
    // the parent flex container (which has styles_gap__3xs).
    const checkboxGroup = checkboxContainer?.closest('[class*="utilities_flexAlignCenter__"]');
    const submitGroup = checkboxGroup?.parentElement;
    const submitBtn = submitGroup?.querySelector(':scope > button');
    console.log(TAG, "submit", { found: !!submitBtn, disabled: submitBtn?.disabled, groupFound: !!submitGroup });

    if (!submitBtn) {
      warn("submit button not found");
      return;
    }

    const textarea = threadReply.querySelector('textarea[placeholder="Reply"]');
    console.log(TAG, "textarea value before submit", JSON.stringify(textarea?.value));

    simulateClick(submitBtn);

    // Resolve the thread after submission completes
    setTimeout(() => {
      const resolveBtn = findResolveButton(threadReply);
      console.log(TAG, "resolve", { found: !!resolveBtn });
      if (resolveBtn) {
        simulateClick(resolveBtn);
      } else {
        warn("Resolve button not found after submit");
      }
    }, 500);
  }

  // ── Button injection ─────────────────────────────────────────────────
  // For each ThreadReply, inject a row of quick-reply buttons after the
  // CommentComposer. We insert OUTSIDE the composer because it uses
  // display:grid with overflow:clip, which would hide extra children.
  //
  // Expected DOM (class hashes vary per build):
  //   ThreadReply_threadReply__  (display: grid, 2 cols: avatar + content)
  //   ├── avatar
  //   ├── CommentComposer_commentComposer__  (display: grid, overflow: clip)
  //   │   ├── CommentEditor_commentEditor__
  //   │   └── [role="toolbar"]
  //   └── ← gqr-buttons inserted here (grid-column: 2)

  function injectButtons(threadReply) {
    if (threadReply.getAttribute("data-gqr-injected") === "true") return;

    const composer = threadReply.querySelector('[class*="CommentComposer_commentComposer__"]');
    const toolbar = threadReply.querySelector('[role="toolbar"]');

    if (!composer) {
      warn("CommentComposer not found in ThreadReply", threadReply.className);
      return;
    }
    if (!toolbar) {
      warn("toolbar [role=toolbar] not found in ThreadReply", threadReply.className);
      return;
    }

    const row = document.createElement("div");
    row.className = "gqr-buttons";

    settings.labels.forEach((label) => {
      const btn = document.createElement("button");
      btn.className = "gqr-btn";
      // Truncate after first word if label is 12+ characters
      const firstWord = label.split(/\s/)[0];
      btn.textContent = label.length >= 12 && label.includes(" ") ? firstWord + "\u2026" : label;
      btn.title = label;
      btn.type = "button";
      btn.dataset.gqrLabel = label;
      row.appendChild(btn);
    });

    // ── Click handling ───────────────────────────────────────────────
    // When the editor is collapsed, ThreadReply's grid doesn't fully
    // allocate space for the button row, so browser hit-testing can
    // attribute clicks to the ThreadReply background instead of our
    // buttons. To work around this, we listen on the ThreadReply itself
    // (capture phase) and match clicks by coordinate intersection.
    //
    // On match: focus the textarea first (activates the collapsed
    // editor), wait a tick for React to expand it, then fill.

    function handleGqrClick(e) {
      const directBtn = e.target.closest('.gqr-btn');
      let matchedLabel = directBtn?.dataset.gqrLabel;

      if (!matchedLabel) {
        for (const b of row.querySelectorAll('.gqr-btn')) {
          const r = b.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            matchedLabel = b.dataset.gqrLabel;
            break;
          }
        }
      }

      if (!matchedLabel) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const textarea = threadReply.querySelector('textarea[placeholder="Reply"]');
      if (!textarea) {
        warn("textarea[placeholder=Reply] not found on button click");
        return;
      }
      textarea.focus();
      setTimeout(() => {
        const fresh = threadReply.querySelector('textarea[placeholder="Reply"]');
        if (fresh) {
          fillTextarea(fresh, matchedLabel);
          // Auto-submit and resolve after letting React process the value change
          setTimeout(() => autoSubmitAndResolve(threadReply), 300);
        } else {
          warn("textarea disappeared after focus");
        }
      }, 100);
    }
    threadReply.addEventListener("pointerdown", handleGqrClick, true);
    threadReply.addEventListener("click", handleGqrClick, true);

    composer.insertAdjacentElement("afterend", row);
    threadReply.setAttribute("data-gqr-injected", "true");
  }

  // ── DOM observer ─────────────────────────────────────────────────────
  // Graphite is a SPA — ThreadReply elements appear dynamically.
  // Watch document.body for new nodes matching the ThreadReply selector.

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.('[class*="ThreadReply_threadReply__"]')) {
          injectButtons(node);
        }
        node.querySelectorAll?.('[class*="ThreadReply_threadReply__"]').forEach(injectButtons);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Inject into any ThreadReply elements already in the DOM
  document.querySelectorAll('[class*="ThreadReply_threadReply__"]').forEach(injectButtons);

  loadSettings();
})();

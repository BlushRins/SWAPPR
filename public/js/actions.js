(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // Bind an explicit allowlist of page actions in script under the CSP.
  app.bindClicks = function bindClicks(actions) {
    document.querySelectorAll("[data-action]").forEach((element) => {
      const name = element.dataset.action;
      if (Object.hasOwn(actions, name)) {
        element.addEventListener("click", actions[name]);
      }
    });
  };

  // ── Popups and keyboard focus ───────────────────────────────────────────
  // Dialogs, drawers and the phone menu open as layers. While one is open
  // the rest of the page is inert (no Tab stops, hidden from screen readers)
  // and Tab wraps inside it; closing it puts focus back on what opened it.
  // Drawers and the menu are also inert while closed.
  const TABBABLE = "a[href], button, input, select, textarea, summary, [tabindex]";
  // Status messages must still be announced while a popup is open.
  const NEVER_INERT = '[aria-live], [role="status"], [role="alert"], script, style, template';
  const layers = []; // { element, keep, opener, openerKey }, top last
  const drawers = new Set();
  const madeInert = new Set();
  let lastPressed = null;

  function isTabbable(node) {
    if (node.tabIndex < 0 || node.disabled || node.type === "hidden") return false;
    if (node.closest("[inert]") || !node.getClientRects().length) return false;
    // Only one radio per group takes a Tab stop: the checked one, else any.
    if (node.type !== "radio" || node.checked || !node.name) return true;
    return !document.querySelector(`input[type="radio"][name="${CSS.escape(node.name)}"]:checked`);
  }

  function tabbables(scope = document) {
    return [...scope.querySelectorAll(TABBABLE)].filter(isTabbable);
  }

  app.canFocus = function canFocus(node) {
    return Boolean(node?.isConnected && !node.closest("[inert]") && node.getClientRects().length);
  };

  function syncInert() {
    madeInert.forEach((node) => {
      node.inert = false;
    });
    madeInert.clear();
    drawers.forEach((node) => {
      node.inert = !layers.some((layer) => layer.element === node);
    });
    const top = layers[layers.length - 1];
    if (!top) return;
    const keep = [top.element, ...top.keep].filter(Boolean);
    (function walk(parent) {
      for (const child of parent.children) {
        if (keep.includes(child) || child.inert || child.matches(NEVER_INERT)) continue;
        if (keep.some((node) => child.contains(node))) walk(child);
        else {
          child.inert = true;
          madeInert.add(child);
        }
      }
    })(document.body);
  }

  // Drawers and menus that slide in stay in the page while closed, so they
  // are inert until opened as a layer.
  app.registerDrawer = function registerDrawer(element) {
    if (!element) return;
    drawers.add(element);
    syncInert();
  };

  // Call once the popup is visible. `focus` is where the cursor starts
  // (default: its first control); `keep` lists elements outside it that
  // stay usable (a backdrop, the menu button); `returnFocus` overrides the
  // element focus goes back to.
  app.openLayer = function openLayer(element, { focus, keep = [], returnFocus } = {}) {
    if (!element || layers.some((layer) => layer.element === element)) return;
    const active = document.activeElement;
    const clicked = lastPressed?.isConnected ? lastPressed : null;
    const opener = returnFocus || (active && active !== document.body ? active : clicked);
    layers.push({ element, keep, opener, openerKey: opener?.dataset?.focusKey });
    syncInert();
    const target = focus || tabbables(element)[0] || element;
    if (target === element && !element.hasAttribute("tabindex")) element.tabIndex = -1;
    target.focus({ preventScroll: drawers.has(element) });
  };

  app.closeLayer = function closeLayer(element) {
    const index = layers.findIndex((layer) => layer.element === element);
    if (index === -1) return;
    const [closed] = layers.splice(index, 1);
    // A popup opened from inside this one now returns to this one's opener.
    layers.slice(index).forEach((layer) => {
      if (layer.opener && element.contains(layer.opener)) {
        layer.opener = closed.opener;
        layer.openerKey = closed.openerKey;
      }
    });
    syncInert();
    if (index < layers.length) return; // focus stays in the popup on top
    // A re-rendered opener is found again by its data-focus-key.
    const rerendered =
      closed.openerKey &&
      document.querySelector(`[data-focus-key="${CSS.escape(closed.openerKey)}"]`);
    const below = layers[layers.length - 1];
    const target =
      [closed.opener, rerendered].find(app.canFocus) || (below && tabbables(below.element)[0]);
    target?.focus();
  };

  app.isLayerOpen = () => layers.length > 0;

  // Key presses that began while a popup was open. A handler that runs
  // after that popup closed on the same press (e.g. Escape) can still tell
  // the key was meant for the popup. This script loads first, so its
  // capture listener runs before any other.
  const pressedOverLayer = new WeakSet();
  root.addEventListener(
    "keydown",
    (event) => {
      if (layers.length) pressedOverLayer.add(event);
    },
    true,
  );
  app.keyStartedOverLayer = (event) => pressedOverLayer.has(event);

  // Gives a popup box the dialog role and a name, unless the markup has them.
  // `label` is the visible heading element, or a string for aria-label.
  app.labelDialog = function labelDialog(box, label, fallbackId) {
    if (!box) return;
    if (!box.hasAttribute("role")) box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    if (box.hasAttribute("aria-labelledby") || box.hasAttribute("aria-label") || !label) return;
    if (typeof label === "string") {
      box.setAttribute("aria-label", label);
      return;
    }
    if (!label.id) label.id = fallbackId;
    box.setAttribute("aria-labelledby", label.id);
  };

  // Safari doesn't focus a clicked button, so remember it as the opener.
  document.addEventListener(
    "click",
    (event) => {
      lastPressed = event.target.closest?.(TABBABLE) || lastPressed;
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !layers.length) return;
    const items = tabbables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const inside = items.includes(document.activeElement);
    const edge = event.shiftKey ? first : last;
    if (!inside || document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });
})(window);

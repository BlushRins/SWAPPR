(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // Toasts show one at a time. Plain notices show for 3 seconds; notices
  // with an action button stay a bit longer so the student can tap it.
  const SHOW_MS = 3000;
  const ACTION_SHOW_MS = 6500;
  const FADE_MS = 300;
  const MAX_WAITING = 3;
  const waiting = [];
  let current = null;
  let hideTimer = null;
  let clearTimer = null;

  function dismissCurrent(toast) {
    if (hideTimer) clearTimeout(hideTimer);
    if (clearTimer) clearTimeout(clearTimer);
    hideTimer = null;
    clearTimer = null;
    toast.classList.remove("show");
    clearTimer = setTimeout(() => {
      clearTimer = null;
      toast.classList.remove("has-action");
      toast.replaceChildren();
      showNext();
    }, FADE_MS);
  }

  function showNext() {
    const toast = document.getElementById("toast");
    current = waiting.shift() ?? null;
    if (!toast || current === null) {
      current = null;
      return;
    }

    // Look and placement come from .toast in styles.css (it wraps on
    // phones). The live region stays in the page; only its contents and the
    // .show class change, so each message is announced.
    const hasAction = Boolean(current.actionLabel && typeof current.onAction === "function");
    toast.classList.toggle("has-action", hasAction);
    if (hasAction) {
      const text = document.createElement("span");
      text.className = "toast-message";
      text.textContent = current.message;
      const actionBtn = document.createElement("button");
      actionBtn.type = "button";
      actionBtn.className = "toast-action";
      actionBtn.textContent = current.actionLabel;
      const handler = current.onAction;
      actionBtn.addEventListener("click", () => {
        dismissCurrent(toast);
        handler();
      });
      toast.replaceChildren(text, actionBtn);
    } else {
      toast.textContent = current.message;
    }
    toast.classList.add("show");

    hideTimer = setTimeout(() => dismissCurrent(toast), current.durationMs);
  }

  app.showToast = function showToast(message, options = {}) {
    const item = {
      message,
      actionLabel: options?.actionLabel || null,
      onAction: options?.onAction || null,
      durationMs: options?.durationMs || (options?.actionLabel ? ACTION_SHOW_MS : SHOW_MS),
    };
    // Skip an exact repeat of what's already showing or next in line.
    const last = waiting[waiting.length - 1];
    if (
      (current && current.message === item.message && current.actionLabel === item.actionLabel) ||
      (last && last.message === item.message && last.actionLabel === item.actionLabel)
    ) {
      return;
    }
    if (waiting.length >= MAX_WAITING) waiting.shift();
    waiting.push(item);
    if (current === null) showNext();
  };
})(window);

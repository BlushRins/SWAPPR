// FUNC-010 (UC-04): the select-notebook prompt shown by "Request Swap".
(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  let requestedNotebook = null;
  let singleOfferId = null;
  let sending = false;

  // Only active notebooks can be offered; the feed only holds active ones.
  function ownNotebooks() {
    const me = app.state.currentUser?.username;
    return app.state.notebooks.filter((notebook) => notebook.username === me);
  }

  function setError(message) {
    document.getElementById("swappRequestError").textContent = message;
  }

  function setSending(isSending) {
    sending = isSending;
    const button = document.getElementById("swappRequestSendBtn");
    button.disabled = isSending;
    const action = singleOfferId === null ? "Send request" : "Send request with this notebook";
    button.textContent = isSending ? "Sending…" : action;
  }

  function renderChoices(notebooks, preferredId) {
    const list = document.getElementById("swappRequestChoices");
    list.replaceChildren(
      ...notebooks.map((notebook) => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = String(notebook.id);
        checkbox.checked = notebook.id === preferredId;
        checkbox.className = "accent-purple-600 w-4 h-4 mt-0.5 shrink-0";
        checkbox.addEventListener("change", () => setError(""));

        const title = document.createElement("span");
        title.className = "text-sm font-semibold text-gray-800 dark:text-purple-100";
        title.textContent = notebook.title || "Untitled notebook";
        const subject = document.createElement("span");
        subject.className = "block text-xs text-gray-500 dark:text-gray-400";
        subject.textContent = notebook.course_code || notebook.department || "";

        const text = document.createElement("span");
        text.className = "min-w-0 break-words";
        text.append(title, subject);

        const label = document.createElement("label");
        label.className = "swapp-choice";
        label.append(checkbox, text);
        return label;
      }),
    );
  }

  function renderOffer(notebooks, preferredId) {
    const needsNotebook = notebooks.length === 0;
    const single = notebooks.length === 1 ? notebooks[0] : null;
    singleOfferId = single?.id ?? null;

    document.getElementById("swappNoOffer").hidden = !needsNotebook;
    document.getElementById("swappOffer").hidden = needsNotebook;
    document.getElementById("swappOfferGroup").hidden = notebooks.length < 2;
    const singleOffer = document.getElementById("swappSingleOffer");
    singleOffer.hidden = !single;
    singleOffer.textContent = single ? single.title || "Untitled notebook" : "";
    renderChoices(notebooks.length > 1 ? notebooks : [], preferredId);
    setError("");

    document.getElementById("swappRequestCancelBtn").textContent =
      needsNotebook ? "Keep browsing" : "Cancel";
    const add = document.getElementById("swappAddOfferBtn");
    const send = document.getElementById("swappRequestSendBtn");
    add.classList.toggle("hidden", !needsNotebook);
    send.classList.toggle("hidden", needsNotebook);
    setSending(false);
    if (needsNotebook) return add;
    return document.querySelector("#swappRequestChoices input:checked") ||
      document.querySelector("#swappRequestChoices input") || send;
  }

  // Suspend the request while its New notebook dialog is on top of the layer stack.
  function addNotebookToOffer() {
    const modal = document.getElementById("swappRequestModal");
    modal.classList.add("hidden");
    app.openAddModal({
      onClose(publishedNotebook) {
        let choices = [];
        if (publishedNotebook) {
          choices = ownNotebooks().filter((notebook) => notebook.id !== publishedNotebook.id);
          choices.unshift(publishedNotebook);
        }
        const focus = renderOffer(choices, publishedNotebook?.id);
        modal.classList.remove("hidden");
        focus.focus();
      },
    });
  }

  app.openSwappRequestModal = function openSwappRequestModal(notebook) {
    requestedNotebook = notebook;
    document.getElementById("swappRequestTitle").textContent =
      notebook.title || "Untitled notebook";
    document.getElementById("swappRequestAuthor").textContent =
      notebook.username || "anonymous";
    document.getElementById("swappShareAuthor").textContent =
      notebook.username || "anonymous";
    const focus = renderOffer(ownNotebooks());
    const modal = document.getElementById("swappRequestModal");
    modal.classList.remove("hidden");
    root.lucide?.createIcons();
    app.labelDialog?.(
      modal.querySelector(".modal-box"),
      document.getElementById("swappRequestHeading"),
    );
    app.openLayer?.(modal, { focus });
  };

  app.closeSwappRequestModal = function closeSwappRequestModal(event) {
    if (event && event.target.id !== "swappRequestModal") return;
    const modal = document.getElementById("swappRequestModal");
    if (sending || modal.classList.contains("hidden")) return;
    modal.classList.add("hidden");
    document.getElementById("swappRequestChoices").replaceChildren();
    requestedNotebook = null;
    app.closeLayer?.(modal);
    // Publishing can push the card that opened the request onto another page.
    if (document.activeElement === document.body) {
      document.getElementById("sectionTitle")?.focus();
    }
  };

  async function refreshSwapps() {
    await app.loadSwapps().catch(() => {});
    app.renderNotebooks();
  }

  function showSelectionError(message) {
    setError(message);
    document.querySelector("#swappRequestChoices input")?.focus();
  }

  app.submitSwappRequest = async function submitSwappRequest() {
    const send = document.getElementById("swappRequestSendBtn");
    if (sending || !requestedNotebook || send.classList.contains("hidden")) return;

    const offered = singleOfferId !== null
      ? [singleOfferId]
      : [...document.querySelectorAll("#swappRequestChoices input:checked")]
          .map((checkbox) => Number(checkbox.value));
    if (!offered.length) {
      showSelectionError("Select at least one notebook to offer.");
      return;
    }

    setSending(true);
    try {
      await app.sendSwapp(requestedNotebook.id, offered);
    } catch (err) {
      setSending(false);
      if (err.code === "NO_OFFER") {
        showSelectionError(err.message);
        return;
      }
      if (err.code === "NO_NOTEBOOKS") {
        renderOffer([]).focus();
        app.loadNotebooks();
      } else {
        // Keep the form open with the student's choices so they can retry.
        setError(`${err.message || "Couldn't send the request."} Try again.`);
      }
      // The request may have been refused because the swap state changed
      // (e.g. sent from another tab), so show the current state.
      await refreshSwapps();
      return;
    }

    app.showToast("Request sent. It's waiting for a response under Requests.");
    try {
      await refreshSwapps();
    } finally {
      setSending(false);
      app.closeSwappRequestModal();
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("swappAddOfferBtn").addEventListener("click", addNotebookToOffer);
  });

  document.addEventListener("keydown", (event) => {
    const modal = document.getElementById("swappRequestModal");
    if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      app.closeSwappRequestModal();
    }
  });
})(window);

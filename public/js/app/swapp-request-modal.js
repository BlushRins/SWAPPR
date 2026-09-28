// FUNC-010 (UC-04): the select-notebook prompt shown by "Request Swap".
(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  let requestedNotebook = null;
  let sending = false;

  // Only active notebooks can be offered; the feed only holds active ones.
  function ownNotebooks() {
    const me = app.state.currentUser?.username;
    return app.state.notebooks.filter((notebook) => notebook.username === me);
  }

  function setError(message) {
    const error = document.getElementById("swappRequestError");
    error.textContent = message || "";
    error.classList.toggle("hidden", !message);
  }

  function setSending(isSending) {
    sending = isSending;
    const button = document.getElementById("swappRequestSendBtn");
    button.disabled = isSending;
    button.textContent = isSending ? "Sending..." : "Send Request";
  }

  function renderChoices(notebooks) {
    const list = document.getElementById("swappRequestChoices");
    list.replaceChildren(
      ...notebooks.map((notebook) => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = String(notebook.id);
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

  // REQT-008: a student with no notebook is asked to upload one first.
  function promptUpload() {
    if (confirm("Upload a notebook before sending a request.\n\nUpload one now?")) {
      app.openAddModal();
    }
  }

  app.openSwappRequestModal = function openSwappRequestModal(notebook) {
    const choices = ownNotebooks();
    if (!choices.length) {
      promptUpload();
      return;
    }

    requestedNotebook = notebook;
    document.getElementById("swappRequestTitle").textContent =
      notebook.title || "Untitled notebook";
    document.getElementById("swappRequestAuthor").textContent =
      notebook.username || "anonymous";
    renderChoices(choices);
    setError("");
    setSending(false);
    document.getElementById("swappRequestModal").classList.remove("hidden");
    root.lucide?.createIcons();
  };

  app.closeSwappRequestModal = function closeSwappRequestModal(event) {
    if (event && event.target.id !== "swappRequestModal") return;
    if (sending) return;
    document.getElementById("swappRequestModal").classList.add("hidden");
    document.getElementById("swappRequestChoices").replaceChildren();
    requestedNotebook = null;
  };

  async function refreshSwapps() {
    await app.loadSwapps().catch(() => {});
    app.renderNotebooks();
  }

  app.submitSwappRequest = async function submitSwappRequest() {
    if (sending || !requestedNotebook) return;

    const offered = [
      ...document.querySelectorAll("#swappRequestChoices input:checked"),
    ].map((checkbox) => Number(checkbox.value));
    if (!offered.length) {
      setError("Select at least one notebook to offer.");
      return;
    }

    setSending(true);
    try {
      await app.sendSwapp(requestedNotebook.id, offered);
    } catch (err) {
      setSending(false);
      if (err.code === "NO_OFFER") {
        setError(err.message);
        return;
      }
      app.closeSwappRequestModal();
      if (err.code === "NO_NOTEBOOKS") {
        promptUpload();
      } else {
        app.showToast(err.message || "Failed to send request");
      }
      // The request may have been refused because the SWAPP state changed
      // (e.g. sent from another tab), so show the current state.
      await refreshSwapps();
      return;
    }

    setSending(false);
    app.closeSwappRequestModal();
    app.showToast("Swap request sent!");
    await refreshSwapps();
  };

  document.addEventListener("keydown", (event) => {
    const modal = document.getElementById("swappRequestModal");
    if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      app.closeSwappRequestModal();
    }
  });
})(window);

(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // RPT001: Report Notebook / Report User (FUNC-015). The same modal is used
  // on index.html and profile.html, so it builds its own markup. The template
  // is static; the reported title and usernames are set with textContent.
  const MODAL_TEMPLATE = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="reportModalHeading">
      <button type="button" data-report-close class="report-modal-close" aria-label="Close">
        <i data-lucide="x" class="w-5 h-5"></i>
      </button>
      <h3 class="text-xl font-extrabold mb-1 pr-8 text-purple-900 dark:text-purple-100 flex items-center gap-2">
        <i data-lucide="flag" class="w-5 h-5"></i>
        <span id="reportModalHeading">Report Notebook</span>
      </h3>
      <p id="reportModalSubject" class="text-sm text-gray-500 dark:text-gray-400 mb-5 break-words"></p>

      <div class="space-y-4">
        <div>
          <label for="reportReason" class="field-section-label">
            Reason <span class="text-red-500">*</span>
          </label>
          <select id="reportReason" class="input-field">
            <option value="" disabled selected>Select a reason</option>
            <option value="inappropriate">Inappropriate or offensive content</option>
            <option value="spam">Spam or misleading</option>
            <option value="plagiarism">Plagiarized / not original work</option>
            <option value="harassment">Harassment or abuse</option>
            <option value="other">Other</option>
          </select>
          <p id="reportReasonError" class="report-error hidden">Missing input.</p>
        </div>

        <div>
          <label for="reportDetails" class="field-section-label">
            Details <span class="text-red-500">*</span>
          </label>
          <textarea id="reportDetails" rows="4" maxlength="500" class="input-field resize-none"></textarea>
          <p id="reportDetailsError" class="report-error hidden">Missing input.</p>
        </div>

        <div class="flex justify-end gap-3 pt-2">
          <button type="button" data-report-close
            class="text-sm font-semibold px-4 py-2 rounded-lg text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition">
            Cancel
          </button>
          <button id="reportSubmitBtn" type="button"
            class="btn-primary disabled:opacity-60 disabled:cursor-not-allowed">
            Submit Report
          </button>
        </div>
      </div>
    </div>`;

  const PLACEHOLDERS = {
    notebook: "Tell us what's wrong with this notebook or its author",
    user: "Tell us what this student did",
  };

  // { type: "notebook", notebook } or { type: "user", id, username }
  let target = null;
  let submitting = false;

  function ensureModal() {
    if (document.getElementById("reportModal")) return;
    const modal = document.createElement("div");
    modal.id = "reportModal";
    modal.className = "modal-overlay hidden";
    modal.innerHTML = MODAL_TEMPLATE;
    modal.addEventListener("click", (event) => app.closeReportModal(event));
    modal.querySelectorAll("[data-report-close]").forEach((button) =>
      button.addEventListener("click", () => app.closeReportModal()),
    );
    modal
      .querySelector("#reportSubmitBtn")
      .addEventListener("click", () => app.submitReport());
    document.body.appendChild(modal);

    const { reason, details, reasonError, detailsError } = getFields();
    reason.addEventListener("change", () => {
      if (reason.value) setFieldError(reason, reasonError, false);
    });
    details.addEventListener("input", () => {
      if (details.value.trim()) setFieldError(details, detailsError, false);
    });
  }

  function getFields() {
    return {
      reason: document.getElementById("reportReason"),
      details: document.getElementById("reportDetails"),
      reasonError: document.getElementById("reportReasonError"),
      detailsError: document.getElementById("reportDetailsError"),
    };
  }

  function setFieldError(field, message, hasError) {
    field?.classList.toggle("error", hasError);
    message?.classList.toggle("hidden", !hasError);
  }

  function resetReportForm() {
    const { reason, details, reasonError, detailsError } = getFields();
    if (reason) reason.selectedIndex = 0;
    if (details) details.value = "";
    setFieldError(reason, reasonError, false);
    setFieldError(details, detailsError, false);
  }

  function validateReportForm() {
    const { reason, details, reasonError, detailsError } = getFields();
    const reasonMissing = !reason.value;
    const detailsMissing = !details.value.trim();

    setFieldError(reason, reasonError, reasonMissing);
    setFieldError(details, detailsError, detailsMissing);

    if (reasonMissing) reason.focus();
    else if (detailsMissing) details.focus();

    return !reasonMissing && !detailsMissing;
  }

  function setSubmitting(isSubmitting) {
    submitting = isSubmitting;
    const button = document.getElementById("reportSubmitBtn");
    if (!button) return;
    button.disabled = isSubmitting;
    button.textContent = isSubmitting ? "Submitting..." : "Submit Report";
  }

  // REQT-003: the header names the reported notebook or account.
  function renderSubject() {
    const subject = document.getElementById("reportModalSubject");
    subject.replaceChildren();
    const strong = (text) => {
      const element = document.createElement("strong");
      element.className = "text-gray-700 dark:text-purple-100";
      element.textContent = text;
      return element;
    };

    if (target.type === "user") {
      subject.append("Reporting the account @", strong(target.username));
    } else {
      subject.append(
        'Reporting "',
        strong(target.notebook.title || "Untitled notebook"),
        '" by @',
        strong(target.notebook.username || "anonymous"),
      );
    }
    document.getElementById("reportModalHeading").textContent =
      target.type === "user" ? "Report User" : "Report Notebook";
    getFields().details.placeholder = PLACEHOLDERS[target.type];
  }

  // A notebook, or { type: "user", id, username } for a student's account.
  app.openReportModal = function openReportModal(reported) {
    if (!reported) return;
    ensureModal();
    target =
      reported.type === "user"
        ? { type: "user", id: reported.id, username: reported.username }
        : { type: "notebook", notebook: reported };
    resetReportForm();
    renderSubject();

    document.getElementById("reportModal").classList.remove("hidden");
    root.lucide?.createIcons();
  };

  app.closeReportModal = function closeReportModal(event) {
    if (event && event.target.id !== "reportModal") return;
    document.getElementById("reportModal")?.classList.add("hidden");
    resetReportForm();
    target = null;
  };

  app.submitReport = async function submitReport() {
    if (submitting || !target || !validateReportForm()) return;

    const { reason, details } = getFields();
    const reported = target;
    const payload = {
      reason: reason.value,
      details: details.value.trim(),
      ...(reported.type === "user"
        ? { reportedUserId: reported.id }
        : { notebookId: reported.notebook.id }),
    };

    setSubmitting(true);
    try {
      await app.api.submitReport(payload);
    } catch (err) {
      console.error("Could not submit report:", err);
      app.showToast(err.message || "Could not submit report. Please try again.");
      return;
    } finally {
      setSubmitting(false);
    }

    app.closeReportModal();
    app.showToast("Report submitted for admin review.");
    // A reported notebook is now under review, so it drops out of the feed.
    // A reported account stays active until an admin acts.
    if (reported.type === "notebook") {
      app.loadNotebooks?.();
      app.loadSubjects?.();
      app.loadSidebar?.();
    }
  };

  function closeOnEscape(event) {
    const modal = document.getElementById("reportModal");
    if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      app.closeReportModal();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    ensureModal();
    document.addEventListener("keydown", closeOnEscape);
  });
})(window);

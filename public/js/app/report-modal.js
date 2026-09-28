(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  let reportedNotebook = null;
  let submitting = false;

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

  app.openReportModal = function openReportModal(notebook) {
    if (!notebook) return;
    reportedNotebook = notebook;
    resetReportForm();

    document.getElementById("reportModalTitle").textContent =
      notebook.title || "Untitled notebook";
    document.getElementById("reportModalAuthor").textContent =
      notebook.username || "anonymous";

    document.getElementById("reportModal")?.classList.remove("hidden");
    root.lucide?.createIcons();
  };

  app.closeReportModal = function closeReportModal(event) {
    if (event && event.target.id !== "reportModal") return;
    document.getElementById("reportModal")?.classList.add("hidden");
    resetReportForm();
    reportedNotebook = null;
  };

  app.submitReport = async function submitReport() {
    if (submitting || !reportedNotebook || !validateReportForm()) return;

    const { reason, details } = getFields();
    setSubmitting(true);
    try {
      await app.api.submitReport({
        notebookId: reportedNotebook.id,
        reason: reason.value,
        details: details.value.trim(),
      });
    } catch (err) {
      console.error("Could not submit report:", err);
      app.showToast(err.message || "Could not submit report. Please try again.");
      return;
    } finally {
      setSubmitting(false);
    }

    app.closeReportModal();
    app.showToast("Report submitted for admin review.");
    // The notebook is now under review, so it drops out of the feed.
    app.loadNotebooks?.();
    app.loadSubjects?.();
    app.loadSidebar?.();
  };

  function closeOnEscape(event) {
    const modal = document.getElementById("reportModal");
    if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      app.closeReportModal();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const { reason, details, reasonError, detailsError } = getFields();

    reason?.addEventListener("change", () => {
      if (reason.value) setFieldError(reason, reasonError, false);
    });
    details?.addEventListener("input", () => {
      if (details.value.trim()) setFieldError(details, detailsError, false);
    });

    document.addEventListener("keydown", closeOnEscape);
  });
})(window);

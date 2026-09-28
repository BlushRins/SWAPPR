(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // No admin or reports table exists yet, so reports are kept in the browser
  // until a backend can take them over.
  const REPORTS_KEY = "swappr_reports";

  let reportedNotebook = null;

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

  function readReports() {
    try {
      const stored = JSON.parse(localStorage.getItem(REPORTS_KEY));
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
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

  app.submitReport = function submitReport() {
    if (!reportedNotebook || !validateReportForm()) return;

    const { reason, details } = getFields();
    const report = {
      id: `report_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      reporterUsername: app.state.currentUser?.username || null,
      notebookId: reportedNotebook.id,
      notebookTitle: reportedNotebook.title || "",
      authorUsername: reportedNotebook.username || "",
      reason: reason.value,
      details: details.value.trim(),
      dateSubmitted: new Date().toISOString(),
    };

    try {
      const reports = readReports();
      reports.push(report);
      localStorage.setItem(REPORTS_KEY, JSON.stringify(reports));
    } catch (err) {
      console.error("Could not save report:", err);
      app.showToast("Could not submit report. Please try again.");
      return;
    }

    app.closeReportModal();
    app.showToast("Report submitted for admin review.");
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

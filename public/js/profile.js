// ── Theme ────────────────────────────────────────────────────────────────
// Same toggle as index.html (js/app/theme.js, localStorage["theme"]).
window.SWAPPR.attachThemeToggle();

// ── Auth ─────────────────────────────────────────────────────────────────
let currentUser = null;

async function handleLogout() {
  await window.SWAPPR.auth.clearUser();
  window.location.replace("login.html");
}
function goHome() {
  window.location.href = "index.html";
}

// ── Toast ─────────────────────────────────────────────────────────────────
function reportProfileUser() {
  if (!profileData) return;
  window.SWAPPR.openReportModal({
    type: "user",
    id: profileData.id,
    username: profileData.username,
  });
}

// The shared toast queue (js/app/toast.js), as on index.html.
function showToast(message) {
  window.SWAPPR.showToast(message);
}

// PNL001 colour bands for a trust score: 95%+ green, 85%+ yellow,
// below that red (the same bands as index.html).
function trustToneClass(score) {
  if (score >= 95) return "text-green-500 dark:text-green-400";
  if (score >= 85) return "text-yellow-500 dark:text-yellow-400";
  return "text-red-500 dark:text-red-400";
}

// Shown to the author only: other students never receive these notebooks.
function moderationNote(status) {
  if (status === "under_review") return "Under review — hidden from the feed";
  if (status === "removed") return "Removed by an admin";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

// ── Whose profile? ────────────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
let viewUser = "";
let isOwn = false;

// ── Load ──────────────────────────────────────────────────────────────────
let profileData = null;

async function loadProfile() {
  try {
    const res = await fetch(`/api/profile/${encodeURIComponent(viewUser)}`, {
      credentials: "same-origin",
    });
    const data = await res.json();
    if (!data.success) {
      showToast("Profile not found.");
      return;
    }
    profileData = data.profile;
    renderProfile(profileData);
  } catch {
    showToast("Failed to load profile.");
  }
}

function renderProfile(p) {
  // Avatar initials
  const initials = p.name
    ? p.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : p.username.slice(0, 2).toUpperCase();
  document.getElementById("avatarEl").textContent = initials;
  document.title = `SWAPPR — ${p.name || p.username}`;

  // Name + tagline
  document.getElementById("profileNameEl").textContent =
    p.name || p.username;
  const taglineParts = [p.course, p.yearLevel].filter(Boolean);
  document.getElementById("profileTaglineEl").textContent =
    taglineParts.join(" · ") || "No course set";
  const metaParts = [`@${p.username}`];
  if (p.studentId) metaParts.push(`ID: ${p.studentId}`);
  if (p.department) metaParts.push(p.department);
  document.getElementById("profileMetaEl").textContent =
    metaParts.join(" · ");

  // Stats
  document.getElementById("profileStatsEl").innerHTML =
    `<span>${p.portfolios.length} Notebook${p.portfolios.length !== 1 ? "s" : ""}</span>` +
    `<span>${p.matches.length} SWAPP Connection${p.matches.length !== 1 ? "s" : ""}</span>` +
    `<span>${Number(p.completedSwapps) || 0} Completed SWAPP${p.completedSwapps !== 1 ? "s" : ""}</span>`;

  // FUNC-014 REQT-003: trust score, warning count and account status,
  // read-only for students (REQT-010).
  const trustScore = Number(p.trustScore ?? 100);
  const warnings = Number(p.warningCount) || 0;
  const status = p.accountStatus === "suspended" ? "Suspended" : "Active";
  document.getElementById("profileStandingEl").innerHTML =
    `<span class="${trustToneClass(trustScore)} font-bold">${trustScore}% Trust Score</span>` +
    `<span>${warnings} Warning${warnings !== 1 ? "s" : ""}</span>` +
    `<span>${status}</span>`;

  // Bio
  document.getElementById("bioText").textContent = p.bio || "No bio yet.";

  // Own controls
  if (isOwn) {
    document.getElementById("ownBadge").style.display = "inline-flex";
    document.getElementById("addNotebookBtn").classList.remove("hidden");
    document.getElementById("profileActions").innerHTML = `
      <button type="button" data-action="editProfile" class="btn-solid">Edit profile</button>`;
  } else {
    // FUNC-015 REQT-002: another student's profile can be reported.
    document.getElementById("profileActions").innerHTML = `
      <button type="button" data-action="goHome" class="btn-outline">Back to browsing</button>
      <button type="button" data-action="reportProfileUser" class="btn-outline">Report</button>`;
  }

  // Notebooks
  const notebooksList = document.getElementById("notebooksList");
  const noNotebooks = document.getElementById("noNotebooks");
  if (p.portfolios.length === 0) {
    notebooksList.innerHTML = "";
    noNotebooks.classList.remove("hidden");
  } else {
    noNotebooks.classList.add("hidden");
    notebooksList.innerHTML = p.portfolios
      .map(
        (n) => `
      <div class="notebook-item">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <button type="button" data-notebook-action="openNotebook" data-notebook-id="${Number(n.id)}" class="notebook-title notebook-title-link">${escapeHtml(n.title)}</button>
            <p class="notebook-dept">${escapeHtml(n.department || "No department")}</p>
            ${
              moderationNote(n.status)
                ? `<p class="mt-2"><span class="status-pill ${n.status === "removed" ? "status-ended" : "status-pending"}">${moderationNote(n.status)}</span></p>`
                : ""
            }
          </div>
          ${
            isOwn
              ? `
            <div class="flex gap-1.5 shrink-0">
              ${
                moderationNote(n.status)
                  ? ""
                  : `<button type="button" data-notebook-action="editNotebook" data-notebook-id="${Number(n.id)}" class="btn-outline">Edit</button>`
              }
              <button type="button" data-notebook-action="deleteNotebook" data-notebook-id="${Number(n.id)}" class="btn-danger-outline">Delete</button>
            </div>`
              : ""
          }
        </div>
      </div>`,
      )
      .join("");
  }

  // Connections
  const matchesList = document.getElementById("matchesList");
  const noMatches = document.getElementById("noMatches");
  document.getElementById("matchCount").textContent = p.matches.length
    ? `· ${p.matches.length}`
    : "";

  if (p.matches.length === 0) {
    matchesList.innerHTML = "";
    noMatches.classList.remove("hidden");
  } else {
    noMatches.classList.add("hidden");
    // FUNC-014 REQT-002: each partner with their trust score.
    matchesList.innerHTML = p.matches
      .map(
        ({ username: u, trustScore: partnerTrust }) => `
      <a href="profile.html?user=${encodeURIComponent(u)}" class="match-pill">
        <div class="match-avatar-sm">${escapeHtml(u.slice(0, 2).toUpperCase())}</div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-bold text-purple-900 dark:text-purple-100 truncate">@${escapeHtml(u)}</p>
          <p class="text-xs text-purple-400">SWAPP match · <span class="${trustToneClass(Number(partnerTrust))} font-bold">${escapeHtml(partnerTrust)}% Trust Score</span></p>
        </div>
        <span class="text-xs text-emerald-500 font-bold shrink-0">✅ Matched</span>
      </a>`,
      )
      .join("");
  }
}

// ── Edit Profile ──────────────────────────────────────────────────────────
// FUNC-014 REQT-005: editing happens in the Profile panel's Edit Profile
// modal, so hand off to it the same way editNotebook() does.
function editProfile() {
  sessionStorage.setItem("openEditProfile", "1");
  window.location.href = "index.html";
}

// ── Notebook actions ──────────────────────────────────────────────────────
// FUNC-014 REQT-004: a title opens Notebook Details (MOD004) on the
// main page, handed off like editNotebook() below.
function openNotebook(notebookId) {
  sessionStorage.setItem("openNotebookId", notebookId);
  window.location.href = "index.html";
}

// PRF001: + Add Notebook opens the New Notebook modal on index.html.
function addNotebook() {
  sessionStorage.setItem("openAddNotebook", "1");
  window.location.href = "index.html";
}

function editNotebook(notebookId) {
  sessionStorage.setItem("editNotebookId", notebookId);
  window.location.href = "index.html";
}

async function deleteNotebook(notebookId) {
  // FUNC-009 REQT-008
  if (!confirm("Are you sure you want to delete this notebook?")) return;
  try {
    const res = await fetch("/api/portfolios/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id: notebookId }),
    });
    const data = await res.json();
    if (data.success) {
      // FUNC-009 REQT-009: "Notebook deleted." then My Subjects on
      // index.html, which shows the toast when it opens.
      sessionStorage.setItem("openView", "mine");
      sessionStorage.setItem("flashMessage", "Notebook deleted.");
      window.location.href = "index.html";
    } else {
      // e.g. FUNC-009 REQT-011: the notebook is in an open SWAPP.
      showToast(data.message || "Failed to delete.");
    }
  } catch {
    showToast("Failed to delete.");
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
async function initProfile() {
  try {
    currentUser = await window.SWAPPR.auth.getUser();
    if (!currentUser) throw new Error();
  } catch {
    await window.SWAPPR.auth.clearUser();
    window.location.replace("login.html");
    return;
  }

  viewUser = params.get("user") || currentUser.username;
  isOwn = viewUser === currentUser.username;
  loadProfile();

  // New-message and cancelled-SWAPP popups, as on index.html. A SWAPP
  // change (accepted, cancelled) reloads this profile's matches.
  window.SWAPPR.state.currentUser = currentUser;
  window.SWAPPR.reloadAfterSwappChange = loadProfile;
  window.SWAPPR.startChatNotifications();
  window.SWAPPR.startSwappUpdates();
}

initProfile();

window.SWAPPR.bindClicks({
  goHome,
  handleLogout,
  toggleMobileMenu: window.toggleMobileMenu,
  closeMobileMenu: window.closeMobileMenu,
  addNotebook,
});

document.getElementById("profileActions").addEventListener("click", (event) => {
  const action = event.target.closest("button[data-action]")?.dataset.action;
  if (action === "editProfile") editProfile();
  if (action === "reportProfileUser") reportProfileUser();
  if (action === "goHome") goHome();
});

document.getElementById("notebooksList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-notebook-action]");
  if (!button) return;
  const id = Number(button.dataset.notebookId);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  switch (button.dataset.notebookAction) {
    case "openNotebook": openNotebook(id); break;
    case "editNotebook": editNotebook(id); break;
    case "deleteNotebook": deleteNotebook(id); break;
  }
});

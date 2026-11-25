(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // PNL001 colour bands for a trust score: 95%+ green, 85%+ yellow, below
  // that red. Shared with the notebook cards.
  app.trustTone = function trustTone(score) {
    if (score >= 95) return "high";
    if (score >= 85) return "mid";
    return "low";
  };

  // Token colours keep the score at 4.5:1 or more in both themes.
  const TRUST_TONE_CLASSES = {
    high: ["text-[color:var(--color-success)]"],
    mid: ["text-amber-700", "dark:text-yellow-400"],
    low: ["text-[color:var(--color-error)]"],
  };
  // Also used by Notebook Details for the author's trust score.
  app.trustToneClasses = function trustToneClasses(score) {
    return TRUST_TONE_CLASSES[app.trustTone(score)];
  };
  const ACCOUNT_STATUS_LABELS = { active: "Active", suspended: "Suspended" };

  app.openProfilePanel = async function openProfilePanel() {
    try {
      const username = app.state.currentUser.username;
      const data = await app.api.getProfile(username);
      if (!data.success) return;

      const profile = data.profile;
      document.getElementById("profileName").textContent = profile.name;
      document.getElementById("profileUsername").textContent = `@${profile.username}`;
      document.getElementById("profileBio").textContent = profile.bio || "";
      document.getElementById("profilePortfolioCount").textContent =
        profile.portfolios.length;

      // FUNC-014 REQT-002: number of completed SWAPPs.
      const swappCountEl = document.getElementById("profileSwappCount");
      if (swappCountEl) swappCountEl.textContent = profile.completedSwapps || 0;

      // FUNC-014 REQT-003: course, warning count and account status.
      document.getElementById("profileCourse").textContent = profile.course || "—";
      document.getElementById("profileWarningCount").textContent = String(
        profile.warningCount ?? 0,
      );
      document.getElementById("profileAccountStatus").textContent =
        ACCOUNT_STATUS_LABELS[profile.accountStatus] || profile.accountStatus || "Active";

      const initialsEl = document.getElementById("profileInitials");
      if (initialsEl && profile.name) {
        initialsEl.textContent = profile.name
          .split(" ")
          .map((word) => word[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);
      }

      renderTrustScore(profile);
      renderProfileLists(profile);

      const panel = document.getElementById("profilePanel");
      const overlay = document.getElementById("profileOverlay");
      panel.classList.add("open");
      overlay.classList.add("active");
      app.openLayer?.(panel, { keep: [overlay] });
      setTimeout(() => root.lucide?.createIcons(), 100);
    } catch (err) {
      console.error("Failed to load profile:", err);
      app.showToast("Could not load your profile. Please try again.");
    }
  };

  function setTrustTone(element, score) {
    Object.values(TRUST_TONE_CLASSES).forEach((classes) =>
      element.classList.remove(...classes),
    );
    element.classList.add(...TRUST_TONE_CLASSES[app.trustTone(score)]);
  }

  function renderTrustScore(profile) {
    const trustScoreEl = document.getElementById("profileTrustScore");
    if (!trustScoreEl) return;

    const score = Number(profile.trustScore ?? 100);
    trustScoreEl.textContent = `${score}%`;
    setTrustTone(trustScoreEl, score);
  }

  // Only the author gets these notebooks back from the API, so this tells
  // them why a notebook is missing from the feed.
  const MODERATION_LABELS = {
    under_review: "under review",
    removed: "removed by an admin",
  };

  function renderProfileLists(profile) {
    const portfolioList = document.getElementById("profilePortfolioList");
    portfolioList.innerHTML = "";
    // FUNC-014 REQT-004: each entry opens Notebook Details (MOD004).
    profile.portfolios.forEach((portfolio) => {
      const div = document.createElement("button");
      div.type = "button";
      div.className =
        "block w-full text-left text-sm py-1 border-b border-purple-100 dark:border-white/[0.05] hover:text-purple-700 dark:hover:text-purple-200 transition";
      div.textContent = portfolio.title;
      div.addEventListener("click", () =>
        app.openNotebookDetails(portfolio.id, {
          ...portfolio,
          username: profile.username,
          trustScore: profile.trustScore,
        }),
      );
      const statusLabel = MODERATION_LABELS[portfolio.status];
      if (statusLabel) {
        const label = document.createElement("span");
        label.className = "ml-1 text-xs font-semibold text-[color:var(--color-error)]";
        label.textContent = `(${statusLabel})`;
        div.appendChild(label);
      }
      portfolioList.appendChild(div);
    });

    const matchList = document.getElementById("profileMatchList");
    if (!matchList) return;

    matchList.innerHTML = "";
    if (!profile.matches?.length) {
      const empty = document.createElement("p");
      empty.className = "text-xs text-[color:var(--color-text-muted)]";
      empty.textContent = "No swap partners yet.";
      matchList.appendChild(empty);
      return;
    }

    // FUNC-014 REQT-002: each SWAPP partner with their trust score. The name
    // opens their profile page; the flag reports the account (FUNC-015 REQT-002).
    profile.matches.forEach((match) => {
      const div = document.createElement("div");
      div.className =
        "flex items-center justify-between gap-2 text-xs text-[color:var(--color-primary)]";
      const name = document.createElement("a");
      name.className = "min-w-0 break-words hover:underline hover:text-purple-600 dark:hover:text-purple-200";
      name.href = `profile.html?user=${encodeURIComponent(match.username)}`;
      name.textContent = `@${match.username}`;
      const right = document.createElement("span");
      right.className = "flex items-center gap-2 shrink-0";
      const score = document.createElement("span");
      score.className = "font-bold";
      score.textContent = `${match.trustScore}%`;
      setTrustTone(score, Number(match.trustScore));
      const report = document.createElement("button");
      report.type = "button";
      report.className =
        "inline-flex items-center justify-center w-6 h-6 rounded-md text-[color:var(--color-text-muted)] hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition";
      report.title = "Report";
      report.setAttribute("aria-label", `Report @${match.username}`);
      const flag = document.createElement("i");
      flag.dataset.lucide = "flag";
      flag.className = "w-3.5 h-3.5";
      report.appendChild(flag);
      report.addEventListener("click", () =>
        app.openReportModal({ type: "user", id: match.id, username: match.username }),
      );
      right.append(score, report);
      div.append(name, right);
      matchList.appendChild(div);
    });
  }

  app.closeProfilePanel = function closeProfilePanel() {
    const panel = document.getElementById("profilePanel");
    panel.classList.remove("open");
    document.getElementById("profileOverlay").classList.remove("active");
    app.closeLayer?.(panel);
  };

  // The closed drawer stays in the page off-screen, so it's inert until
  // opened; open, it's a modal dialog named Profile.
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.getElementById("profilePanel");
    app.labelDialog?.(panel, "Profile");
    app.registerDrawer?.(panel);
    // The icon-only Close (x) is the first thing focused, so it needs a name.
    const close = panel?.querySelector('[data-action="closeProfilePanel"]');
    if (close && !close.hasAttribute("aria-label") && !close.textContent.trim()) {
      close.setAttribute("aria-label", "Close profile");
    }
  });

  // Escape closes the panel, like its overlay. A popup opened on top of it
  // (Report User, Edit Profile) closes first; this runs in the capture phase
  // so it still sees that popup before the popup's own handler hides it.
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      if (!document.getElementById("profilePanel")?.classList.contains("open")) return;
      if (document.querySelector(".modal-overlay:not(.hidden)")) return;
      app.closeProfilePanel();
    },
    true,
  );
})(window);

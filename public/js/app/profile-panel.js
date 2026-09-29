(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // PNL001 colour bands for a trust score: 95%+ green, 85%+ yellow, below
  // that red. Shared with the notebook cards.
  app.trustTone = function trustTone(score) {
    if (score >= 95) return "high";
    if (score >= 85) return "mid";
    return "low";
  };

  const TRUST_TONE_CLASSES = {
    high: ["text-green-500", "dark:text-green-400"],
    mid: ["text-yellow-500", "dark:text-yellow-400"],
    low: ["text-red-500", "dark:text-red-400"],
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

      document.getElementById("profilePanel").classList.add("open");
      document.getElementById("profileOverlay").classList.add("active");
      setTimeout(() => root.lucide?.createIcons(), 100);
    } catch (err) {
      console.error("Failed to load profile:", err);
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
        label.className = "ml-1 text-xs font-semibold text-red-500 dark:text-red-400";
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
      empty.className = "text-xs text-purple-300";
      empty.textContent = "No matches yet.";
      matchList.appendChild(empty);
      return;
    }

    // FUNC-014 REQT-002: each SWAPP partner with their trust score.
    profile.matches.forEach((match) => {
      const div = document.createElement("div");
      div.className = "flex items-center justify-between gap-2 text-xs text-purple-400";
      const name = document.createElement("span");
      name.className = "min-w-0 break-words";
      name.textContent = `@${match.username}`;
      const score = document.createElement("span");
      score.className = "font-bold shrink-0";
      score.textContent = `${match.trustScore}%`;
      setTrustTone(score, Number(match.trustScore));
      div.append(name, score);
      matchList.appendChild(div);
    });
  }

  app.closeProfilePanel = function closeProfilePanel() {
    document.getElementById("profilePanel").classList.remove("open");
    document.getElementById("profileOverlay").classList.remove("active");
  };
})(window);

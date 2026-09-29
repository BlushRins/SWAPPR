(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // Same minimum the registration form and the server enforce.
  const PASSWORD_MIN_LENGTH = 4;
  // profile.html's Edit Profile button sets this and sends the student here.
  const HANDOFF_KEY = "openEditProfile";

  let saving = false;

  function getFields() {
    return {
      name: document.getElementById("editProfileName"),
      username: document.getElementById("editProfileUsername"),
      course: document.getElementById("editProfileCourse"),
      password: document.getElementById("editProfilePassword"),
    };
  }

  function showError(message) {
    const error = document.getElementById("editProfileError");
    if (!error) return;
    error.textContent = message;
    error.classList.toggle("hidden", !message);
  }

  function markField(field, hasError) {
    field?.classList.toggle("error", hasError);
  }

  function resetErrors() {
    Object.values(getFields()).forEach((field) => markField(field, false));
    showError("");
  }

  function setSaving(isSaving) {
    saving = isSaving;
    const button = document.getElementById("editProfileSaveBtn");
    if (!button) return;
    button.disabled = isSaving;
    button.textContent = isSaving ? "Saving..." : "Save";
  }

  // FUNC-014 REQT-005: the modal opens filled with the student's current
  // name, username and course.
  app.openEditProfileModal = async function openEditProfileModal() {
    let profile;
    try {
      profile = (await app.api.getProfile(app.state.currentUser.username)).profile;
    } catch (err) {
      console.error("Could not load profile:", err);
      app.showToast("Could not load your profile. Please try again.");
      return;
    }

    const fields = getFields();
    resetErrors();
    fields.name.value = profile.name || "";
    fields.username.value = profile.username || "";
    // A course that isn't in the list leaves the placeholder selected, so
    // the student picks a current one instead of saving a blank.
    fields.course.value = root.SWAPPRCourses.isCourse(profile.course)
      ? profile.course
      : "";
    fields.password.value = "";

    document.getElementById("editProfileModal")?.classList.remove("hidden");
    root.lucide?.createIcons();
    fields.name.focus();
  };

  app.closeEditProfileModal = function closeEditProfileModal(event) {
    if (event && event.target.id !== "editProfileModal") return;
    document.getElementById("editProfileModal")?.classList.add("hidden");
    resetErrors();
    getFields().password.value = "";
  };

  app.saveProfile = async function saveProfile(event) {
    event?.preventDefault();
    if (saving) return;

    const fields = getFields();
    const values = {
      name: fields.name.value.trim(),
      username: fields.username.value.trim(),
      course: fields.course.value,
      password: fields.password.value.trim(),
    };
    resetErrors();

    // REQT-006: every field is required; each empty one turns red.
    const missing = Object.keys(values).filter((key) => !values[key]);
    if (missing.length) {
      missing.forEach((key) => markField(fields[key], true));
      showError("Missing Input");
      fields[missing[0]].focus();
      return;
    }
    if (values.password.length < PASSWORD_MIN_LENGTH) {
      markField(fields.password, true);
      showError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      fields.password.focus();
      return;
    }

    // REQT-007 / REQT-009: "No" leaves the student in the modal.
    if (!confirm("Are you sure you want to edit this profile?")) return;

    setSaving(true);
    let data;
    try {
      data = await app.api.updateProfile(values);
    } catch (err) {
      if (err.message === "Username already taken") markField(fields.username, true);
      showError(err.message || "Could not update profile. Please try again.");
      return;
    } finally {
      setSaving(false);
    }

    const updated = { ...app.state.currentUser, ...data.user };
    app.state.currentUser = updated;
    app.auth?.setUser(updated);
    const badgeName = document.getElementById("userBadgeName");
    if (badgeName) badgeName.textContent = updated.name;

    app.closeEditProfileModal();
    // REQT-008
    app.showToast("Successfully updated profile.");

    // The panel, the subject feed (built from the course) and every card or
    // SWAPP that shows the student's username all need the new values.
    app.openProfilePanel();
    app.loadSubjects();
    app.loadNotebooks();
    app.loadSwapps();
    app.loadSidebar();
  };

  app.openEditProfileIfRequested = function openEditProfileIfRequested() {
    if (sessionStorage.getItem(HANDOFF_KEY) !== "1") return;
    sessionStorage.removeItem(HANDOFF_KEY);
    app.openProfilePanel();
    app.openEditProfileModal();
  };

  function closeOnEscape(event) {
    const modal = document.getElementById("editProfileModal");
    if (event.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      app.closeEditProfileModal();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const course = document.getElementById("editProfileCourse");
    if (course) root.SWAPPRCourses.fillCourseSelect(course);

    document.getElementById("editProfileForm")?.addEventListener("submit", app.saveProfile);

    // A field stops being red once it's filled in, and the message goes
    // once nothing is red any more.
    Object.values(getFields()).forEach((field) => {
      const clear = () => {
        if (!field.value.trim()) return;
        markField(field, false);
        if (!document.querySelector("#editProfileForm .error")) showError("");
      };
      field?.addEventListener("input", clear);
      field?.addEventListener("change", clear);
    });

    document.addEventListener("keydown", closeOnEscape);
  });
})(window);

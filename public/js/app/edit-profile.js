(function (root) {
  const app = (root.SWAPPR = root.SWAPPR || {});

  // profile.html's Edit Profile button sets this and sends the student here.
  const HANDOFF_KEY = "openEditProfile";

  let saving = false;

  function getFields() {
    return {
      name: document.getElementById("editProfileName"),
      username: document.getElementById("editProfileUsername"),
      course: document.getElementById("editProfileCourse"),
      currentPassword: document.getElementById("editProfileCurrentPassword"),
      password: document.getElementById("editProfilePassword"),
    };
  }

  function showError(errorId, message) {
    const error = document.getElementById(errorId);
    error.textContent = message;
    error.hidden = !message;
  }

  function setFieldError(field, message = "") {
    field.classList.toggle("error", Boolean(message));
    if (message) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
    showError(field.getAttribute("aria-describedby"), message);
  }

  function resetErrors(fields) {
    Object.values(fields).forEach((field) => setFieldError(field));
    showError("editProfileError", "");
  }

  function passwordDetails() {
    return document.getElementById("editProfilePasswordDetails");
  }

  function clearPasswordFields(fields) {
    for (const field of [fields.currentPassword, fields.password]) {
      field.value = "";
      setFieldError(field);
    }
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
    resetErrors(fields);
    fields.name.value = profile.name || "";
    fields.username.value = profile.username || "";
    // A course that isn't in the list leaves the placeholder selected, so
    // the student picks a current one instead of saving a blank.
    fields.course.value = root.SWAPPRCourses.isCourse(profile.course)
      ? profile.course
      : "";
    passwordDetails().open = false;
    clearPasswordFields(fields);

    const modal = document.getElementById("editProfileModal");
    modal?.classList.remove("hidden");
    root.lucide?.createIcons();
    app.labelDialog?.(
      modal?.querySelector(".modal-box"),
      document.getElementById("editProfileHeading"),
    );
    app.openLayer?.(modal, { focus: fields.name });
  };

  app.closeEditProfileModal = function closeEditProfileModal(event) {
    if (event && event.target.id !== "editProfileModal") return;
    document.getElementById("editProfileModal")?.classList.add("hidden");
    app.closeLayer?.(document.getElementById("editProfileModal"));
    const fields = getFields();
    resetErrors(fields);
    passwordDetails().open = false;
    clearPasswordFields(fields);
  };

  app.saveProfile = async function saveProfile(event) {
    event?.preventDefault();
    if (saving) return;

    const fields = getFields();
    const values = {
      name: fields.name.value.trim(),
      username: fields.username.value.trim(),
      course: fields.course.value,
    };
    resetErrors(fields);

    const editingPassword = passwordDetails().open &&
      (fields.password.value || fields.currentPassword.value);
    const validation = {
      name: values.name ? "" : "Enter your full name.",
      username: /^[A-Za-z0-9_.-]{1,40}$/.test(values.username)
        ? ""
        : "Use letters, digits, dots, underscores or hyphens.",
      course: root.SWAPPRCourses.isCourse(values.course) ? "" : "Select your degree program.",
    };
    if (editingPassword) {
      values.currentPassword = fields.currentPassword.value;
      values.password = fields.password.value;
      validation.currentPassword = values.currentPassword ? "" : "Enter your current password.";
      validation.password = app.passwordPolicy.passwordError(values.password);
    }
    const errors = Object.entries(validation).filter(([, message]) => message);
    if (errors.length) {
      errors.forEach(([key, message]) => setFieldError(fields[key], message));
      fields[errors[0][0]].focus();
      return;
    }

    setSaving(true);
    let data;
    try {
      data = await app.api.updateProfile(values);
    } catch (err) {
      const message = err.message || "Could not update profile. Please try again.";
      const field = Object.hasOwn(fields, err.field) ? fields[err.field] : null;
      if (field) {
        if (field === fields.currentPassword || field === fields.password) passwordDetails().open = true;
        setFieldError(field, message);
        field.focus();
      } else {
        showError("editProfileError", message);
      }
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
    // The panel opens first, so the modal sits on top of it.
    app.openProfilePanel().then(() => app.openEditProfileModal());
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

    const fields = getFields();
    Object.values(fields).forEach((field) => {
      const clear = () => setFieldError(field);
      field.addEventListener("input", clear);
      field.addEventListener("change", clear);
    });
    passwordDetails().addEventListener("toggle", () => {
      if (!passwordDetails().open) clearPasswordFields(fields);
    });

    document.addEventListener("keydown", closeOnEscape);
  });
})(window);

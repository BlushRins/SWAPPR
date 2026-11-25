// Initialize Lucide icons
lucide.createIcons();

// Check if already logged in
window.SWAPPR?.auth?.getUser().then((user) => {
  if (user) window.location.replace(homePageFor(user.role));
});

function homePageFor(role) {
  return role === "admin" ? "admin.html" : "index.html";
}

// FUNC-001 REQT-010: shown when a request times out or the server
// can't be reached.
const NETWORK_ERROR =
  "A network error (such as timeout, interrupted connection or unreachable host) has occurred.";
const REQUEST_TIMEOUT_MS = 15000;

// POSTs JSON and returns the parsed reply. Throws NetworkError when the
// request times out, can't reach the server or gets no JSON back.
class NetworkError extends Error {}
async function postJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } catch {
    throw new NetworkError(NETWORK_ERROR);
  } finally {
    clearTimeout(timer);
  }
}

function showMessage(el, text) {
  el.textContent = text;
  el.style.display = "block";
}

function hideMessage(el) {
  el.style.display = "none";
}

// FUNC-001 REQT-008, FUNC-002 REQT-006: an empty or rejected field turns red.
// When the field has a .field-error line (linked by aria-describedby), the
// message shows there, beside the field.
function setFieldError(field, hasError, message = "") {
  if (!field) return;
  field.classList.toggle("error", hasError);
  if (hasError) field.setAttribute("aria-invalid", "true");
  else field.removeAttribute("aria-invalid");
  const errorLine = (field.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id))
    .find((el) => el?.classList.contains("field-error"));
  if (!errorLine) return;
  errorLine.textContent = hasError ? message : "";
  if (!errorLine.hasAttribute("aria-live")) errorLine.hidden = !(hasError && message);
}

// ── OTP box auto-advance ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const boxes = document.querySelectorAll(".otp-box");
  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      box.value = box.value.replace(/\D/g, "").slice(-1);
      if (box.value && i < boxes.length - 1) boxes[i + 1].focus();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && i > 0) boxes[i - 1].focus();
    });
    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      [...digits].forEach((d, idx) => { if (boxes[idx]) boxes[idx].value = d; });
      if (boxes[Math.min(digits.length, 5)]) boxes[Math.min(digits.length, 5)].focus();
    });
  });
});

// ── Registration step state ───────────────────────────────────────────
let verifiedEmail = "";
let pendingFormData = null;
let resendInterval = null;

const REG_STEP_LABELS = {
  1: "Step 1 of 2: Account details",
  2: "Step 2 of 2: Verify your USC email",
};

function showRegStep(step) {
  document.getElementById("registerForm").hidden = step !== 1;
  document.getElementById("regStep2").hidden = step !== 2;
  document.getElementById("registerError").style.display = "none";
  document.getElementById("registerSuccess").style.display = "none";
  document.getElementById("regStepLabel").textContent = REG_STEP_LABELS[step];
  if (step === 1) document.getElementById("regEmail").focus();
}

function startResendTimer(seconds) {
  const btn = document.getElementById("resendBtn");
  const timer = document.getElementById("resendTimer");
  btn.style.display = "none";
  timer.style.display = "";
  let remaining = seconds;
  timer.textContent = `Resend in ${remaining}s`;
  if (resendInterval) clearInterval(resendInterval);
  resendInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(resendInterval);
      timer.style.display = "none";
      btn.style.display = "";
    } else {
      timer.textContent = `Resend in ${remaining}s`;
    }
  }, 1000);
}

async function handleResend() {
  const errorEl = document.getElementById("registerError");
  const btn = document.getElementById("resendBtn");
  btn.disabled = true;
  errorEl.style.display = "none";
  try {
    const data = await postJson("/api/send-otp", {
      email: verifiedEmail,
      password: pendingFormData.password,
    });
    if (data.success) {
      document.querySelectorAll(".otp-box").forEach((b) => (b.value = ""));
      startResendTimer(60);
      document.querySelector(".otp-box")?.focus();
    } else {
      errorEl.textContent = data.message || "Failed to resend.";
      errorEl.style.display = "block";
      if (data.retryAfterSeconds) {
        startResendTimer(data.retryAfterSeconds);
      }
    }
  } catch {
    showMessage(errorEl, NETWORK_ERROR);
  } finally {
    btn.disabled = false;
  }
}

async function handleVerifyOtp() {
  const otp = [...document.querySelectorAll(".otp-box")].map((b) => b.value).join("");
  const errorEl = document.getElementById("registerError");
  const successEl = document.getElementById("registerSuccess");
  const btn = document.getElementById("verifyOtpBtn");

  if (otp.length !== 6) {
    errorEl.textContent = "Enter all 6 digits.";
    errorEl.style.display = "block";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verifying...";
  errorEl.style.display = "none";

  try {
    // Verify the OTP
    const vData = await postJson("/api/verify-otp", { email: verifiedEmail, otp });
    if (!vData.success) {
      errorEl.textContent = vData.message || "Incorrect code.";
      errorEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Verify & create account";
      return;
    }

    // OTP good — now register
    const rData = await postJson("/api/register", {
      ...pendingFormData,
      email: verifiedEmail,
      verificationToken: vData.verificationToken,
    });

    if (rData.success) {
      if (rData.user?.username) {
        window.SWAPPR.auth.setUser(rData.user);
        successEl.textContent = "Account created! Redirecting…";
        successEl.style.display = "block";
        setTimeout(() => { window.location.replace("index.html"); }, 1000);
      } else {
        successEl.textContent = "Account created! You can now sign in.";
        successEl.style.display = "block";
        setTimeout(closeRegisterModal, 2000);
      }
    } else {
      errorEl.textContent = rData.message || "Registration failed.";
      errorEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Verify & create account";
    }
  } catch {
    showMessage(errorEl, NETWORK_ERROR);
    btn.disabled = false;
    btn.textContent = "Verify & create account";
  }
}

// Custom dropdown for regCourse with click-open typing support
(function () {
  const courseSelect = document.getElementById("regCourse");
  const courseButton = document.getElementById("regCourseButton");
  const courseList = document.getElementById("regCourseList");
  if (!courseSelect || !courseButton || !courseList) return;

  // The options come from the shared list Edit Profile also uses.
  window.SWAPPRCourses.fillCourseSelect(courseSelect);

  const topLevelOptions = Array.from(courseSelect.children)
    .filter((child) => child.tagName.toLowerCase() === "option")
    .filter((opt) => opt.value)
    .map((opt) => ({
      value: opt.value,
      label: opt.textContent.trim(),
      normalized: opt.textContent.trim().toLowerCase(),
    }));

  const groups = Array.from(courseSelect.querySelectorAll("optgroup")).map(
    (group) => ({
      label: group.label,
      options: Array.from(group.querySelectorAll("option"))
        .filter((opt) => opt.value)
        .map((opt) => ({
          value: opt.value,
          label: opt.textContent.trim(),
          normalized: opt.textContent.trim().toLowerCase(),
        })),
    })
  );

  const options = [...topLevelOptions, ...groups.flatMap((group) => group.options)];

  let isOpen = false;
  let highlightedIndex = -1;
  let typeBuffer = "";
  let bufferTimer = null;
  const MIN_TYPE_MATCH_LENGTH = 3;

  const clearTypeBuffer = () => {
    typeBuffer = "";
    if (bufferTimer) {
      clearTimeout(bufferTimer);
      bufferTimer = null;
    }
  };

  const scheduleTypeBufferClear = () => {
    if (bufferTimer) {
      clearTimeout(bufferTimer);
    }
    bufferTimer = setTimeout(clearTypeBuffer, 1000);
  };

  const updateButtonLabel = () => {
    const selected = options.find((opt) => opt.value === courseSelect.value);
    const labelText = selected ? selected.label : "Select your degree program";
    const textSpan = courseButton.querySelector(".custom-select-label");
    if (textSpan) {
      textSpan.textContent = labelText;
    } else {
      courseButton.textContent = labelText;
    }
  };

  const highlightOption = (index, scrollIntoView = false) => {
    const items = Array.from(courseList.querySelectorAll(".custom-select-option"));
    if (!items.length) return;

    if (index < 0) index = 0;
    if (index >= items.length) index = items.length - 1;

    highlightedIndex = index;
    items.forEach((item, idx) => {
      const isActive = idx === highlightedIndex;
      item.classList.toggle("highlighted", isActive);
      item.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive && scrollIntoView) {
        const itemRect = item.getBoundingClientRect();
        const listRect = courseList.getBoundingClientRect();
        if (itemRect.top < listRect.top || itemRect.bottom > listRect.bottom) {
          item.scrollIntoView({ block: "nearest" });
        }
      }
    });
  };

  const openList = () => {
    if (isOpen) return;
    isOpen = true;
    courseList.classList.remove("hidden");
    courseButton.setAttribute("aria-expanded", "true");
    courseButton.classList.add("open");
    const selectedIndex = options.findIndex((opt) => opt.value === courseSelect.value);
    highlightOption(selectedIndex >= 0 ? selectedIndex : 0);
    courseList.focus();
  };

  const closeList = () => {
    if (!isOpen) return;
    isOpen = false;
    courseList.classList.add("hidden");
    courseButton.setAttribute("aria-expanded", "false");
    courseButton.classList.remove("open");
    clearTypeBuffer();
  };

  const setSelected = (value) => {
    courseSelect.value = value;
    updateButtonLabel();
    if (value) setFieldError(courseButton, false);
  };

  // registerForm.reset() empties the hidden select; show that on the
  // button too, instead of the course picked last time.
  courseSelect.form?.addEventListener("reset", () => setTimeout(updateButtonLabel));

  const findMatch = (query) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return null;

    const terms = normalized.split(/\s+/).filter(Boolean);
    const candidates = options
      .map((opt) => {
        const normalizedLabel = opt.normalized;
        const words = normalizedLabel.split(/\s+/);
        const startsWith = normalizedLabel.startsWith(normalized);
        const wordStartIndex = words.findIndex((word) => word.startsWith(normalized));
        const containsAll = terms.every((term) => normalizedLabel.includes(term));

        let score = 0;
        if (startsWith) {
          score = 200000 - normalizedLabel.length;
        } else if (wordStartIndex >= 0) {
          score = 100000 - wordStartIndex * 10 - words[wordStartIndex].length;
        } else if (terms.length >= 3 && containsAll) {
          score = 50000 - normalizedLabel.length;
        }

        return { opt, score, wordStartIndex };
      })
      .filter((item) => item.score > 0);

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].opt;
  };

  const handleType = (key) => {
    typeBuffer += key.toLowerCase();
    scheduleTypeBufferClear();
    if (typeBuffer.length < MIN_TYPE_MATCH_LENGTH) {
      return;
    }
    const match = findMatch(typeBuffer);
    if (match) {
      const matchIndex = options.findIndex((opt) => opt.value === match.value);
      highlightOption(matchIndex, true);
    }
  };

  const handleKeyDown = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "Escape" && isOpen) {
      // Close only the list, not the whole registration dialog.
      event.preventDefault();
      event.stopPropagation();
      closeList();
      courseButton.focus();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      highlightOption(highlightedIndex + 1, true);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      highlightOption(highlightedIndex - 1, true);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) {
        openList();
        return;
      }
      if (highlightedIndex >= 0) {
        setSelected(options[highlightedIndex].value);
      }
      closeList();
      courseButton.focus();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      if (typeBuffer.length > 0) {
        typeBuffer = typeBuffer.slice(0, -1);
        scheduleTypeBufferClear();
        if (typeBuffer.length >= MIN_TYPE_MATCH_LENGTH) {
          const match = findMatch(typeBuffer);
          if (match) {
            const matchIndex = options.findIndex((opt) => opt.value === match.value);
            highlightOption(matchIndex, true);
          }
        }
      }
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      if (!isOpen) {
        openList();
      }
      handleType(event.key);
    }
  };

  const renderOptions = () => {
    courseList.innerHTML = "";
    let optionIndex = 0;

    if (topLevelOptions.length) {
      topLevelOptions.forEach((option) => {
        const currentIndex = optionIndex;
        const optionEl = document.createElement("div");
        optionEl.id = `regCourseOption${currentIndex}`;
        optionEl.className = "custom-select-option";
        optionEl.setAttribute("role", "option");
        optionEl.setAttribute("aria-selected", "false");
        optionEl.dataset.value = option.value;
        optionEl.textContent = option.label;

        optionEl.addEventListener("click", () => {
          setSelected(option.value);
          closeList();
          courseButton.focus();
        });

        optionEl.addEventListener("mousemove", () => {
          highlightOption(currentIndex);
        });

        courseList.appendChild(optionEl);
        optionIndex += 1;
      });
    }

    groups.forEach((group) => {
      if (group.label) {
        const header = document.createElement("div");
        header.className = "custom-select-group";
        header.textContent = group.label;
        header.setAttribute("role", "presentation");
        courseList.appendChild(header);
      }

      group.options.forEach((option) => {
        const currentIndex = optionIndex;
        const optionEl = document.createElement("div");
        optionEl.id = `regCourseOption${currentIndex}`;
        optionEl.className = "custom-select-option";
        optionEl.setAttribute("role", "option");
        optionEl.setAttribute("aria-selected", "false");
        optionEl.dataset.value = option.value;
        optionEl.textContent = option.label;

        optionEl.addEventListener("click", () => {
          setSelected(option.value);
          closeList();
          courseButton.focus();
        });

        optionEl.addEventListener("mousemove", () => {
          highlightOption(currentIndex);
        });

        courseList.appendChild(optionEl);
        optionIndex += 1;
      });
    });
  };

  renderOptions();
  updateButtonLabel();

  courseButton.addEventListener("click", () => {
    toggleList();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (!isOpen) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const ignoredTags = ["INPUT", "TEXTAREA", "SELECT"];
      if (ignoredTags.includes(event.target.tagName)) return;
      handleKeyDown(event);
    },
    true
  );

  courseList.addEventListener("click", (event) => {
    const clicked = event.target.closest(".custom-select-option");
    if (!clicked) return;
    const value = clicked.dataset.value;
    if (value) {
      setSelected(value);
    }
    closeList();
    courseButton.focus();
  });

  document.addEventListener("click", (event) => {
    if (
      !courseList.contains(event.target) &&
      !courseButton.contains(event.target)
    ) {
      closeList();
    }
  });

  function toggleList() {
    if (isOpen) {
      closeList();
    } else {
      openList();
    }
  }
})();

// Modal functions. The dialog keeps keyboard focus inside while open and
// returns it to whatever opened it when it closes.
let registerModalOpener = null;

function isRegisterModalOpen() {
  return document.getElementById("registerModal").classList.contains("active");
}

function openRegisterModal() {
  const modal = document.getElementById("registerModal");
  registerModalOpener = document.activeElement;
  modal.classList.add("active");
  document.getElementById("registerForm").reset();
  document.getElementById("regEmail").value = "";
  document
    .querySelectorAll("#registerForm .error")
    .forEach((field) => setFieldError(field, false));
  verifiedEmail = "";
  showRegStep(1);
  setTimeout(() => {
    lucide.createIcons();
    document.getElementById("regEmail").focus();
  }, 50);
}

function closeRegisterModal() {
  if (!isRegisterModalOpen()) return;
  document.getElementById("registerModal").classList.remove("active");
  const opener = registerModalOpener || document.getElementById("openRegisterBtn");
  registerModalOpener = null;
  opener?.focus();
}

function closeModalOnOutsideClick(event) {
  if (event.target.id === "registerModal") {
    closeRegisterModal();
  }
}

// Escape closes the dialog; Tab and Shift+Tab wrap inside it.
document.addEventListener("keydown", (e) => {
  if (!isRegisterModalOpen()) return;
  if (e.key === "Escape") {
    closeRegisterModal();
    return;
  }
  if (e.key !== "Tab") return;
  const dialog = document.querySelector("#registerModal .modal-content");
  const focusable = [
    ...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex="0"]',
    ),
  ].filter((el) => el.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    e.preventDefault();
    first.focus();
  }
});

// A red field clears as soon as the student types in it, and the
// login message hides again (LOG001).
document.addEventListener("DOMContentLoaded", () => {
  ["loginUsername", "loginPassword"].forEach((id) =>
    document.getElementById(id).addEventListener("input", (event) => {
      if (event.target.value.trim()) setFieldError(event.target, false);
      hideMessage(document.getElementById("loginError"));
    }),
  );
  ["regEmail", "regName", "regStudentId", "regUsername", "regPassword"].forEach((id) =>
    document.getElementById(id).addEventListener("input", (event) => {
      if (event.target.value.trim()) setFieldError(event.target, false);
    }),
  );
});

// Login handler (FUNC-001 REQT-003 to REQT-010)
async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById("loginUsername");
  const passwordInput = document.getElementById("loginPassword");
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const errorEl = document.getElementById("loginError");
  const loginBtn = document.getElementById("loginBtn");

  hideMessage(errorEl);
  setFieldError(usernameInput, !username);
  setFieldError(passwordInput, !password);
  if (!username || !password) {
    showMessage(errorEl, "Input required data.");
    (username ? passwordInput : usernameInput).focus();
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in…";

  try {
    const data = await postJson("/api/login", { username, password });
    if (data.success && data.user && data.user.username) {
      window.SWAPPR.auth.setUser({ ...data.user, role: data.role });
      window.location.replace(homePageFor(data.role));
      return;
    }
    // The server uses the same error for unknown accounts and bad credentials.
    showMessage(errorEl, data.message || NETWORK_ERROR);
  } catch {
    showMessage(errorEl, NETWORK_ERROR);
  }
  loginBtn.disabled = false;
  loginBtn.textContent = "Sign in";
}

// Register handler — Step 1: validate form, send OTP, advance to step 2
// (FUNC-002 REQT-003, REQT-005, REQT-006).
async function handleRegister(e) {
  e.preventDefault();
  const fields = {
    email: document.getElementById("regEmail"),
    name: document.getElementById("regName"),
    studentId: document.getElementById("regStudentId"),
    course: document.getElementById("regCourse"),
    username: document.getElementById("regUsername"),
    password: document.getElementById("regPassword"),
  };
  const courseButton = document.getElementById("regCourseButton");
  const values = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, key === "password" ? field.value : field.value.trim()]),
  );
  const errorEl = document.getElementById("registerError");
  const registerBtn = document.getElementById("registerBtn");
  const markRed = (key, hasError, message) =>
    setFieldError(key === "course" ? courseButton : fields[key], hasError, message);
  // A rejected value gets its message beside the field.
  const fail = (key, message) => {
    markRed(key, true, message);
    (key === "course" ? courseButton : fields[key]).focus();
  };

  hideMessage(errorEl);
  Object.keys(fields).forEach((key) => markRed(key, false));

  // Every empty field turns red and nothing is sent (REQT-006).
  const missing = Object.keys(fields).filter((key) => !values[key]);
  if (missing.length) {
    missing.forEach((key) => markRed(key, true, "Required."));
    showMessage(errorEl, "Input required data.");
    (missing[0] === "course" ? courseButton : fields[missing[0]]).focus();
    return;
  }
  if (!/^\d+@usc\.edu\.ph$/i.test(values.email)) {
    return fail("email", "Email must be in the format: numbers@usc.edu.ph");
  }
  if (!/^\d{1,64}$/.test(values.studentId) || values.studentId !== values.email.split("@")[0]) {
    return fail("studentId", "Student ID must match the number in your school email.");
  }
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(values.username)) {
    return fail("username", "Use letters, digits, dots, underscores or hyphens.");
  }
  const invalidPassword = window.SWAPPR.passwordPolicy.passwordError(values.password);
  if (invalidPassword) return fail("password", invalidPassword);

  registerBtn.disabled = true;
  registerBtn.textContent = "Sending code...";

  try {
    const data = await postJson("/api/send-otp", { email: values.email, password: values.password });

    if (data.success) {
      // Store form data and email for use after OTP verification
      verifiedEmail = values.email;
      pendingFormData = {
        name: values.name,
        studentId: values.studentId,
        course: values.course,
        username: values.username,
        password: values.password,
      };

      document.getElementById("otpEmailLabel").textContent = values.email;
      document.querySelectorAll(".otp-box").forEach((b) => (b.value = ""));
      showRegStep(2);
      startResendTimer(60);
      document.querySelector(".otp-box")?.focus();
    } else {
      const message = data.message || "Failed to send code. Try again.";
      if (data.field === "password") fail("password", message);
      else if (data.field === "username") markRed("username", true, message);
      else if (/email/i.test(message)) markRed("email", true, message);
      else showMessage(errorEl, message);
      if (data.retryAfterSeconds) {
        startResendTimer(data.retryAfterSeconds);
      }
    }
  } catch {
    showMessage(errorEl, NETWORK_ERROR);
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = "Send verification code";
  }
}

document.getElementById("loginForm").addEventListener("submit", handleLogin);
document.getElementById("registerForm").addEventListener("submit", handleRegister);
const logo = document.getElementById("loginBrandLogo");
function hideBrokenLogo() {
  logo.style.display = "none";
}
logo.addEventListener("error", hideBrokenLogo);
if (logo.complete && !logo.naturalWidth) hideBrokenLogo();

window.SWAPPR.bindClicks({
  openRegisterModal: () => openRegisterModal(),
  closeRegisterModal: () => closeRegisterModal(),
  "closeModalOnOutsideClick-overlay": closeModalOnOutsideClick,
  handleVerifyOtp: () => handleVerifyOtp(),
  handleResend: () => handleResend(),
  "back-to-registration": () => showRegStep(1),
});

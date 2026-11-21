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
function setFieldError(field, hasError) {
  field?.classList.toggle("error", hasError);
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

function showRegStep(step) {
  document.getElementById("registerForm").style.display = step === 1 ? "" : "none";
  document.getElementById("regStep2").style.display = step === 2 ? "" : "none";
  document.getElementById("registerError").style.display = "none";
  document.getElementById("registerSuccess").style.display = "none";
  const d1 = document.getElementById("stepDot1");
  const d2 = document.getElementById("stepDot2");
  if (step === 1) {
    d1.style.cssText = "width:20px;height:8px;border-radius:4px;background:#6d28d9;transition:all .3s;";
    d2.style.cssText = "width:8px;height:8px;border-radius:50%;background:#d1d5db;transition:all .3s;";
  } else {
    d1.style.cssText = "width:8px;height:8px;border-radius:50%;background:#6d28d9;transition:all .3s;";
    d2.style.cssText = "width:20px;height:8px;border-radius:4px;background:#6d28d9;transition:all .3s;";
  }
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
    const data = await postJson("/api/send-otp", { email: verifiedEmail });
    if (data.success) {
      document.querySelectorAll(".otp-box").forEach((b) => (b.value = ""));
      startResendTimer(60);
      setTimeout(() => document.querySelector(".otp-box")?.focus(), 100);
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
      btn.textContent = "Verify & Create Account";
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
        successEl.textContent = "Account created! You can now log in.";
        successEl.style.display = "block";
        setTimeout(closeRegisterModal, 2000);
      }
    } else {
      errorEl.textContent = rData.message || "Registration failed.";
      errorEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Verify & Create Account";
    }
  } catch {
    showMessage(errorEl, NETWORK_ERROR);
    btn.disabled = false;
    btn.textContent = "Verify & Create Account";
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
    const labelText = selected ? selected.label : "Select your course";
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

    if (event.key === "Escape") {
      event.preventDefault();
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

// Modal functions
function openRegisterModal() {
  const modal = document.getElementById("registerModal");
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
  document.getElementById("registerModal").classList.remove("active");
}

function closeModalOnOutsideClick(event) {
  if (event.target.id === "registerModal") {
    closeRegisterModal();
  }
}

// Escape key to close modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeRegisterModal();
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
  loginBtn.textContent = "Logging in...";

  try {
    const data = await postJson("/api/login", { username, password });
    if (data.success && data.user && data.user.username) {
      window.SWAPPR.auth.setUser({ ...data.user, role: data.role });
      window.location.replace(homePageFor(data.role));
      return;
    }
    // "No account matches this username.", "The password is
    // incorrect." or the suspended-account message, from the server.
    showMessage(errorEl, data.message || NETWORK_ERROR);
  } catch {
    showMessage(errorEl, NETWORK_ERROR);
  }
  loginBtn.disabled = false;
  loginBtn.textContent = "Log In";
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
  const markRed = (key, hasError) =>
    setFieldError(key === "course" ? courseButton : fields[key], hasError);
  const fail = (key, message) => {
    markRed(key, true);
    showMessage(errorEl, message);
    (key === "course" ? courseButton : fields[key]).focus();
  };

  hideMessage(errorEl);
  Object.keys(fields).forEach((key) => markRed(key, false));

  // Every empty field turns red and nothing is sent (REQT-006).
  const missing = Object.keys(fields).filter((key) => !values[key]);
  if (missing.length) {
    missing.forEach((key) => markRed(key, true));
    showMessage(errorEl, "Input required data.");
    (missing[0] === "course" ? courseButton : fields[missing[0]]).focus();
    return;
  }
  if (!/^\d+@usc\.edu\.ph$/i.test(values.email)) {
    return fail("email", "Email must be in the format: numbers@usc.edu.ph");
  }
  if (!/^[0-9]+$/.test(values.studentId)) {
    return fail("studentId", "Student ID must contain numbers only.");
  }
  if (values.password.trim().length < 8) {
    return fail("password", "Password must be at least 8 characters.");
  }

  registerBtn.disabled = true;
  registerBtn.textContent = "Sending code...";

  try {
    // The username is checked here, before a code is sent (REQT-005).
    const data = await postJson("/api/send-otp", {
      email: values.email,
      username: values.username,
    });

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
      setTimeout(() => document.querySelector(".otp-box")?.focus(), 100);
    } else {
      if (data.field === "username") markRed("username", true);
      if (/email/i.test(data.message || "")) markRed("email", true);
      showMessage(errorEl, data.message || "Failed to send code. Try again.");
      if (data.retryAfterSeconds) {
        startResendTimer(data.retryAfterSeconds);
      }
    }
  } catch {
    showMessage(errorEl, NETWORK_ERROR);
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = "Register";
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

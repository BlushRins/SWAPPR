const assert = require("node:assert/strict");
const { once } = require("node:events");
const { spawn, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { copyFileSync, mkdtempSync, rmSync } = require("node:fs");
const { createServer } = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const sqlite3 = require("sqlite3");

const ADMIN_PASSWORD = "test operator credential 86";
const STUDENT_PASSWORD = "old student credential 71";
const REPLACEMENT_PASSWORD = " new student credential 91 ";
const REGISTRATION_PASSWORD = " unique unrelated credential 11 ";
const COURSE = "Bachelor of Science in Computer Science";

function databaseCall(db, method, sql, ...params) {
  return new Promise((resolve, reject) => {
    db[method](sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

async function startServer(env, onStop) {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));

  const child = spawn(process.execPath, ["server.js"], {
    env: { ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const exited = once(child, "exit");
  const stop = async () => {
    child.kill();
    await exited;
  };
  onStop(stop);

  await new Promise((resolve, reject) => {
    function capture(chunk) {
      output += chunk;
      if (output.includes("SWAPPR running on")) resolve();
    }
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Server exited with ${code}: ${output}`)));
  });

  const origin = `http://127.0.0.1:${port}`;
  const request = (route, { method = "GET", body, cookie, headers = {} } = {}) => {
    return fetch(origin + route, {
      method,
      body: body && JSON.stringify(body),
      headers: {
        ...(method === "GET" ? {} : { Origin: env.APP_ORIGIN || origin }),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
    });
  };
  return { request, stop, output: () => output };
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0];
}

test("seed and authentication hardening works through the app entry points", { timeout: 25_000 }, async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "swappr-security-test-"));
  copyFileSync("sql/courses.db", path.join(directory, "courses.db"));
  const stops = [];
  t.after(async () => {
    await Promise.all(stops.map((stop) => stop()));
    rmSync(directory, { recursive: true, force: true });
  });

  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    DOTENV_CONFIG_PATH: path.join(directory, "test.env"),
    HOST: "127.0.0.1",
    NODE_ENV: "test",
    OTP_DEV_MODE: "true",
    SWAPPR_SQL_DIR: directory,
    SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
    SESSION_SECRET: randomBytes(32).toString("hex"),
  };
  const run = (args, overrides) => spawnSync(process.execPath, args, {
    env: { ...env, ...overrides }, encoding: "utf8",
  });

  const production = { NODE_ENV: "production", APP_ORIGIN: "https://swappr.example" };
  const forbiddenSeed = run(["seed.js"], production);
  assert.equal(forbiddenSeed.status, 1);
  assert.match(forbiddenSeed.stderr, /Demo seeding is disabled/);
  const unsafeStart = run(["server.js"], { ...production, SESSION_SECRET: "" });
  assert.equal(unsafeStart.status, 1);
  assert.match(unsafeStart.stderr, /requires a random SESSION_SECRET/);
  const unsafeAdmin = run(["seed.js", "--admin-only"], { ...production, SEED_ADMIN_PASSWORD: "" });
  assert.equal(unsafeAdmin.status, 1);
  assert.match(unsafeAdmin.stderr, /SEED_ADMIN_PASSWORD/);

  const safeAdmin = run(["seed.js", "--admin-only"], production);
  assert.equal(safeAdmin.status, 0, safeAdmin.stderr);
  assert.ok(!safeAdmin.stdout.includes(ADMIN_PASSWORD));

  const seed = run(["seed.js"]);
  assert.equal(seed.status, 0, seed.stderr);
  assert.ok(!seed.stdout.includes(ADMIN_PASSWORD));
  const db = new sqlite3.Database(path.join(directory, "swappr.db"));
  try {
    const seeded = await databaseCall(db, "get", "SELECT password FROM Users WHERE username = 'ana_reyes'");
    assert.match(seeded.password, /^scrypt\$/);
    await databaseCall(db, "run", "UPDATE Users SET password = ? WHERE username = 'ana_reyes'", STUDENT_PASSWORD);
    await databaseCall(db, "run", "UPDATE Users SET username = ? WHERE username = 'ana_reyes'", " ana_reyes ");
    await databaseCall(db, "run", "UPDATE Users SET email = ?, studentId = ? WHERE username = 'marco_s'",
      "100004@usc.edu.ph", "00000");
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }

  const first = await startServer(env, (stop) => stops.push(stop));
  const second = await startServer(env, (stop) => stops.push(stop));
  const { request } = first;
  const post = (route, body, cookie, headers) => request(route, { method: "POST", body, cookie, headers });
  const login = (username, password) => post("/api/login", { username, password });
  const me = (cookie, instance = first) => instance.request("/api/me", { cookie });

  const anonymousPage = await request("/login.html");
  assert.match(anonymousPage.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(anonymousPage.headers.get("content-security-policy"), /script-src-attr 'none'/);
  assert.equal(anonymousPage.headers.get("x-content-type-options"), "nosniff");
  assert.equal(anonymousPage.headers.get("x-powered-by"), null);
  assert.equal((await request("/js/vendor/lucide.js")).status, 200);
  assert.equal((await request("/css/tailwind.css")).status, 200);
  assert.equal((await post("/api/login", {}, undefined, { Origin: "https://other.example" })).status, 403);
  assert.equal((await post("/api/login", {}, undefined, { Origin: "null", "Sec-Fetch-Site": "same-origin" })).status, 403);

  assert.equal((await request("/api/chats/1/messages", {
    headers: { "Sec-Fetch-Site": "cross-site" },
  })).status, 403);

  const badLogin = await login("ana_reyes", "incorrect credential");
  const unknownLogin = await login("missing_equivalence_fixture", "incorrect credential");
  assert.equal(badLogin.status, 401);
  assert.equal(unknownLogin.status, 401);
  assert.deepEqual(await badLogin.json(), await unknownLogin.json());
  const registeredOtpRequest = { email: "100004@usc.edu.ph", password: REGISTRATION_PASSWORD };
  const registeredRecipient = await post("/api/send-otp", registeredOtpRequest);
  assert.deepEqual(await registeredRecipient.json(), { success: true });
  assert.equal((await post("/api/send-otp", registeredOtpRequest)).status, 429);
  assert.ok(!first.output().includes("Code for 100004@usc.edu.ph"));

  assert.equal((await post("/api/register", { name: ["bad"], username: { invalid: true } })).status, 400);
  assert.equal((await request("/js/course-options.test.js")).status, 404);
  const subjects = await request("/api/subjects?course=ALL");
  assert.equal(subjects.status, 200);
  const mechanics = (await subjects.json()).subjects.find(({ code }) => code === "ES-MECH");
  assert.equal(mechanics.department, "");
  assert.deepEqual(mechanics.reservedUnits, [
    "Department of Chemical Engineering",
    "Department of Electrical & Electronics Engineering",
    "Department of Industrial Engineering",
  ]);
  const departments = await request("/api/departments");
  assert.ok((await departments.json()).departments.includes("School of Engineering"));

  const firstLogin = await login("ana_reyes", STUDENT_PASSWORD);
  assert.equal(firstLogin.status, 200, await firstLogin.text());
  const firstCookie = cookieFrom(firstLogin);
  assert.ok(firstCookie);
  assert.equal((await me(firstCookie, second)).status, 200);
  assert.equal((await post("/api/logout", undefined, firstCookie)).status, 200);
  assert.equal((await me(firstCookie, second)).status, 401);

  const profileCookie = cookieFrom(await login("ana_reyes", STUDENT_PASSWORD));
  const oldPeerCookie = cookieFrom(await login("ana_reyes", STUDENT_PASSWORD));
  const edit = (body) => request("/api/profile", {
    method: "PATCH", cookie: profileCookie,
    body: { name: "Ana Reyes", username: "ana_reyes", course: COURSE, ...body },
  });
  assert.equal((await edit({ name: "Ana R." })).status, 200);
  assert.equal((await me(oldPeerCookie)).status, 200);
  assert.equal((await edit({ password: REPLACEMENT_PASSWORD })).status, 400);
  assert.equal((await edit({ password: REPLACEMENT_PASSWORD, currentPassword: "wrong" })).status, 403);
  assert.equal((await edit({ password: "password123", currentPassword: STUDENT_PASSWORD })).status, 400);
  const changed = await edit({ password: REPLACEMENT_PASSWORD, currentPassword: STUDENT_PASSWORD });
  assert.equal(changed.status, 200, await changed.text());
  const updatedCookie = cookieFrom(changed);
  assert.equal((await me(updatedCookie, second)).status, 200);
  assert.equal((await me(oldPeerCookie, second)).status, 401);
  assert.equal((await me(profileCookie)).status, 401);

  const admin = await login("admin", ADMIN_PASSWORD);
  assert.equal(admin.status, 200, await admin.text());
  const adminCookie = cookieFrom(admin);
  assert.equal((await request("/admin.html", { cookie: adminCookie })).status, 200);
  const rotated = run(["scripts/reset-password.js", "admin", "admin"], { RESET_PASSWORD: "test operator replacement 89" });
  assert.equal(rotated.status, 0, rotated.stderr);
  assert.equal((await me(adminCookie, second)).status, 401);

  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await login("fixture_missing", "test only")).status, 401);
  }
  const locked = await second.request("/api/login", {
    method: "POST", body: { username: "fixture_missing", password: "test only" },
  });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get("retry-after")) > 0);

  const email = "100001@usc.edu.ph";
  const invalidOtpRequest = await post("/api/send-otp", { email, password: "Password123" });
  assert.equal(invalidOtpRequest.status, 400);
  assert.deepEqual(await invalidOtpRequest.json(), {
    success: false, message: "Choose a less common password.", field: "password",
  });
  assert.ok(!(first.output() + second.output()).includes(`Code for ${email}`));
  const otpRequest = { email, password: REGISTRATION_PASSWORD };
  const sendResults = await Promise.all([
    post("/api/send-otp", otpRequest),
    second.request("/api/send-otp", { method: "POST", body: otpRequest }),
  ]);
  assert.deepEqual(sendResults.map((response) => response.status).sort(), [200, 429]);
  const otp = /Code for 100001@usc\.edu\.ph: (\d{6})/.exec(first.output() + second.output())?.[1];
  assert.ok(otp);

  const lockedEmail = "100002@usc.edu.ph";
  assert.equal((await post("/api/send-otp", { email: lockedEmail, password: REGISTRATION_PASSWORD })).status, 200);
  const lockedOtp = /Code for 100002@usc\.edu\.ph: (\d{6})/.exec(first.output())?.[1];
  assert.ok(lockedOtp);
  const wrongCode = lockedOtp === "111111" ? "222222" : "111111";
  const checks = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    (index % 2 ? first : second).request("/api/verify-otp", {
      method: "POST", body: { email: lockedEmail, otp: wrongCode },
    }),
  ));
  assert.equal(checks.filter((response) => response.status === 200).length, 4);
  assert.equal(checks.filter((response) => response.status === 429).length, 4);
  assert.equal((await post("/api/verify-otp", { email: lockedEmail, otp: lockedOtp })).status, 429);

  const verified = await post("/api/verify-otp", { email, otp });
  assert.equal(verified.status, 200);
  const { verificationToken } = await verified.json();
  assert.ok(verificationToken);
  const registration = {
    email, course: COURSE, username: " new_student ",
    name: " New Student ", password: REGISTRATION_PASSWORD,
  };
  assert.equal((await post("/api/register", registration)).status, 400);
  const invalidRegistration = await post("/api/register", {
    ...registration, verificationToken, password: "Password123",
  });
  assert.equal(invalidRegistration.status, 400);
  assert.equal((await invalidRegistration.json()).message, "Choose a less common password.");
  const mismatched = await post("/api/register", { ...registration, studentId: "100006", verificationToken });
  assert.equal(mismatched.status, 400);
  assert.match((await mismatched.json()).message, /Student ID must match/);
  const registered = await post("/api/register", { ...registration, verificationToken });
  assert.equal(registered.status, 201, await registered.text());
  assert.equal((await me(cookieFrom(registered))).status, 200);

  const studentCookie = cookieFrom(registered);
  const registeredProfile = await request("/api/profile/new_student", { cookie: studentCookie });
  assert.equal(registeredProfile.status, 200);
  assert.equal((await registeredProfile.json()).profile.studentId, "100001");
  const registeredLogin = await login("new_student", registration.password);
  assert.equal(registeredLogin.status, 200);
  assert.equal((await registeredLogin.json()).user.name, "New Student");
  const profile = await request("/api/profile/marco_s", {
    cookie: cookieFrom(await login("marco_s", "pass1234")),
  });
  assert.equal((await profile.json()).profile.studentId, "100004");

  const notebook = {
    title: "Lecture notes for my course", description: "Sample notebook for course filtering",
    courseCode: "CS 3106N", department: "Untrusted department", fileUrl: "https://example.com/notes",
  };
  assert.equal((await post("/api/portfolios", { ...notebook, courseCode: "fake subject" }, studentCookie)).status, 400);
  assert.equal((await post("/api/portfolios", { ...notebook, title: "a".repeat(121) }, studentCookie)).status, 400);
  const created = await post("/api/portfolios", notebook, studentCookie);
  assert.equal(created.status, 200, await created.clone().text());
  const { id } = await created.json();
  const filtered = await request(`/api/portfolios?program=${encodeURIComponent(COURSE)}&subject=CS%203106N`,
    { cookie: studentCookie });
  const listed = (await filtered.json()).portfolios.find((portfolio) => portfolio.id === id);
  assert.equal(listed.program, COURSE);
  assert.equal(listed.department, "Department of Computer, Information Sciences and Mathematics");
  assert.equal((await post("/api/portfolios/delete", { title: notebook.title }, studentCookie)).status, 400);
  assert.equal((await post("/api/portfolios/like", { notebookId: 1_000_000 }, studentCookie)).status, 404);
  assert.equal((await post("/api/portfolios/like", { notebookId: id }, studentCookie)).status, 200);
  assert.equal((await post("/api/portfolios/like", { notebookId: id }, studentCookie)).status, 409);
  assert.equal((await post("/api/portfolios/delete", { id }, studentCookie)).status, 200);

  const preMigration = new sqlite3.Database(path.join(directory, "swappr.db"));
  try {
    await databaseCall(preMigration, "run", "INSERT INTO Admin (username, password) VALUES (?, ?)",
      "legacy_operator", "old unprotected admin credential");
    await databaseCall(preMigration, "run", `INSERT INTO ChatMessages(chat_id,sender_id,body) VALUES (100001,1,'test')`);
    await databaseCall(preMigration, "run", `INSERT INTO Chats(id,status,archived_at) VALUES (100001,'archived','2000-01-01')`);
    await databaseCall(preMigration, "run", `INSERT INTO Reports(report_ID, status, date_resolved) VALUES (100001,'disregarded','2000-01-01')`);
    await databaseCall(preMigration, "run", `INSERT INTO Reports(report_ID, status, date_submitted) VALUES (100002,'open','2000-01-01')`);
  } finally {
    await new Promise((resolve) => preMigration.close(resolve));
  }
  const live = await startServer({ ...env, ...production }, (stop) => stops.push(stop));
  assert.equal((await live.request("/api/login", {
    method: "POST", body: { username: "marco_s", password: "pass1234" },
  })).status, 401);
  assert.equal((await live.request("/api/login", {
    method: "POST", body: { username: "legacy_operator", password: "old unprotected admin credential" },
  })).status, 401);
  const productionLogin = await live.request("/api/login", {
    method: "POST", body: { username: "ana_reyes", password: REPLACEMENT_PASSWORD },
  });
  assert.equal(productionLogin.status, 200, await productionLogin.text());
  assert.match(productionLogin.headers.get("set-cookie"), /; Secure/);
  assert.ok(productionLogin.headers.get("strict-transport-security"));
  const retention = new sqlite3.Database(path.join(directory, "swappr.db"));
  try {
    assert.equal(await databaseCall(retention, "get", "SELECT id FROM ChatMessages WHERE chat_id = 100001"), undefined);
    assert.equal(await databaseCall(retention, "get", "SELECT report_ID FROM Reports WHERE report_ID = 100001"), undefined);
    assert.ok(await databaseCall(retention, "get", "SELECT report_ID FROM Reports WHERE report_ID = 100002"));
  } finally {
    await new Promise((resolve) => retention.close(resolve));
  }
});

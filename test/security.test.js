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
  const sendResults = await Promise.all([
    post("/api/send-otp", { email }),
    second.request("/api/send-otp", { method: "POST", body: { email } }),
  ]);
  assert.deepEqual(sendResults.map((response) => response.status).sort(), [200, 429]);
  const otp = /Code for 100001@usc\.edu\.ph: (\d{6})/.exec(first.output() + second.output())?.[1];
  assert.ok(otp);

  const lockedEmail = "100002@usc.edu.ph";
  assert.equal((await post("/api/send-otp", { email: lockedEmail })).status, 200);
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
    email, studentId: "100001", course: COURSE, username: "new_student",
    name: "New Student", password: "unique unrelated credential 11",
  };
  assert.equal((await post("/api/register", registration)).status, 400);
  const registered = await post("/api/register", { ...registration, verificationToken });
  assert.equal(registered.status, 201, await registered.text());
  assert.equal((await me(cookieFrom(registered))).status, 200);

  const preMigration = new sqlite3.Database(path.join(directory, "swappr.db"));
  try {
    await databaseCall(preMigration, "run", "INSERT INTO Admin (username, password) VALUES (?, ?)",
      "legacy_operator", "old unprotected admin credential");
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
});

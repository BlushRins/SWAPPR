<div align="center">
  <img src="public/Images/swappr_logo_updated.jpg" alt="SWAPPR Logo" width="200" />
  <p>
    <a href="https://github.com/BlushRins/SWAPPR/commits/main">
      <img alt="Last commit" src="https://img.shields.io/github/last-commit/BlushRins/SWAPPR?style=for-the-badge&logo=github&color=7c3aed" />
    </a>
    <a href="https://github.com/BlushRins/SWAPPR/blob/main/LICENSE">
      <img alt="License" src="https://img.shields.io/github/license/BlushRins/SWAPPR?style=for-the-badge&color=2563eb" />
    </a>
    <a href="https://github.com/BlushRins/SWAPPR/issues">
      <img alt="Issues" src="https://img.shields.io/github/issues/BlushRins/SWAPPR?style=for-the-badge&color=dc2626" />
    </a>
    <a href="https://github.com/BlushRins/SWAPPR/pulls">
      <img alt="Pull requests" src="https://img.shields.io/github/issues-pr/BlushRins/SWAPPR?style=for-the-badge&color=059669" />
    </a>
  </p>
  <h1>SWAPPR — Study Together</h1>
</div>

**SWAPPR** is a collaborative platform for students to share notebooks, study materials, and seamlessly filter courses by department.

## Features
- **Notebook Sharing & Swapping:** Easily upload your portfolios and swap study materials with peers.
- **Department Browsing:** Automatically filters and organizes courses into clean, intuitive department categories.
- **Study Requests (Swapps):** Manage and respond to incoming requests for course materials.
- **Dynamic & Responsive UI:** Built with Tailwind CSS, supporting modern dark mode and dynamic theme toggling.

## Technology Stack
- **Backend:** Node.js, Express, SQLite3
- **Frontend:** Vanilla JavaScript, HTML5, Tailwind CSS, Lucide Icons

## Project Map
- `server.js` - Express API and static file server.
- `lib/` - course, subject, and department helpers with unit tests.
- `public/` - static HTML, CSS, images, and browser JavaScript.
- `public/js/app/` - focused front-end modules loaded by `public/index.html`.
- `sql/` - local SQLite databases used by the app.
- `docs/` - backlog, architecture notes, and implementation plans.

## Getting Started

### Prerequisites
Install [Node.js 24 LTS](https://nodejs.org/) and npm.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/BlushRins/SWAPPR.git
   cd SWAPPR
   ```

2. Install dependencies and build the local Tailwind stylesheet:
   ```bash
   npm ci
   npm run build
   ```

3. Optionally seed a disposable local database with demo students. This resets existing demo data:
   ```bash
   node seed.js
   ```

4. Start the server:
   ```bash
   npm start
   ```

5. Open your browser and navigate to `http://localhost:3000` unless you changed `PORT`.

### Production setup

- Set `NODE_ENV=production`, `APP_ORIGIN` to your exact HTTPS origin without a
  trailing slash, and `SESSION_SECRET` to a randomly generated secret of at
  least 32 bytes (for example, generate it with `openssl rand -hex 32`).
- Use a durable local volume for SQLite. If setting `SWAPPR_SQL_DIR`, copy
  the bundled `sql/courses.db` there and share the same directory between
  app processes on that host. Temporary serverless filesystems cannot persist
  sessions, rate limits, or account data.
- Behind a reverse proxy, set `TRUST_PROXY` to the addresses or CIDRs of the
  trusted proxy hops. Make the origin reachable only from those proxies and
  have the edge replace incoming forwarding headers. Keep the setting unset
  for a directly reachable server.
- Build the stylesheet with `npm run build` before starting the server.
  Run `node seed.js --admin-only` with `SEED_ADMIN_PASSWORD` set to a unique
  password of at least 16 characters to create the first admin. This command
  preserves an existing admin. Full demo seeding is disabled in production.
- Sessions expire after seven days. After deploying this update, sign in again.
  Existing production accounts still storing plaintext require an operator
  password reset. See the [credential incident runbook](docs/credential-incident.md).

See [Deployment and rollback](docs/deployment.md) for container setup, backups,
and the production checklist.

### Email OTP configuration

Registration now depends on SMTP-backed email verification. Create a local `.env`
file before starting the server.

Preferred provider-agnostic SMTP variables:

```env
PORT=3000
HOST=127.0.0.1
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=no-reply@example.com
```

Legacy Gmail variables still work as a fallback:

```env
EMAIL_USER=your-gmail-address@gmail.com
EMAIL_PASS=your-app-password
```

Notes:

- `SMTP_FROM` is the sender address shown in OTP emails.
- One USC email can only register one account.
- `studentId` is stored separately from `yearLevel`.
- OTP codes are hashed in SQLite, expire after 10 minutes, and use server-side
  resend/attempt limits.
- `HOST=127.0.0.1` keeps the app local-only by default during development.

### Testing

Run the current unit checks:

```bash
npm test
```

For a deeper map of the codebase, see `docs/ARCHITECTURE.md`.

## Known limitations

- Production needs a persistent SQLite volume on a single host. A temporary
  serverless filesystem cannot retain accounts, sessions, or uploaded notebook metadata.
- The USC catalog lists subject metadata and departments. Program-level
  requirements for shared prefixes need a current curriculum.
- A course page shows notebooks published by students in that degree program.
  For legacy notebooks, the app infers the program from the author's current profile.
- Archived chat messages are kept for 30 days after archive. Resolved reports
  are kept for 90 days. Open reports remain available for review.

## Reporting a vulnerability

Use the private reporting instructions in [SECURITY.md](SECURITY.md).

## License
This project is licensed under the [MIT License](LICENSE).

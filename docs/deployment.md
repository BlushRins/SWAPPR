# Deployment and rollback

Use a Node.js 24 host with a durable SQLite volume and an HTTPS reverse proxy.
The old `swappr.vercel.app` address returned 404 for this project's login route.
Choose a hostname you control before changing the GitHub Website field or
retiring an existing deployment. Vercel's temporary function filesystem
cannot retain this app's account, session, or rate-limit state.

## Build and run a container

Run commands from the repository checkout on the persistent host. Put
`APP_ORIGIN` (the exact HTTPS origin), `SESSION_SECRET` (a fresh random secret),
and the SMTP settings from [the environment example](../.env.example) in a
private `.env` file. Restrict it with `chmod 600 .env`.

```bash
docker build -t swappr:local .
docker volume create swappr-data
docker run -d --name swappr --env-file .env \
  -e HOST=0.0.0.0 -e PORT=3000 -e SWAPPR_SQL_DIR=/app/sql \
  --mount source=swappr-data,target=/app/sql -p 127.0.0.1:3000:3000 swappr:local
curl --fail --output /dev/null http://127.0.0.1:3000/login.html
```

GitHub Actions runs `bash test/container-smoke.sh swappr-ci` against a fresh
image. It checks that the production container serves its built assets, an
operator can provision and sign in as an administrator, and the same session
works after replacing the container with the same SQLite volume.

Set `TRUST_PROXY` to the addresses or CIDRs of the actual proxy hops. The
proxy should replace forwarding headers and be the only public ingress.
Provision the first administrator explicitly with a unique
`SEED_ADMIN_PASSWORD`, using `node seed.js --admin-only` in the running
container with the same volume.

An existing named volume keeps its own `courses.db`. When updating that
catalog, stop the service and replace only `courses.db` with the reviewed
read-only catalog. Leave the account database in place.

## Upgrade and verify

1. Stop writers and use SQLite's `.backup` command to save the account
   database into a restricted backup location. Keep the previous app version available.
2. Start the new app with the original volume and your production environment.
   The app upgrades the database schema at startup. Legacy IDs without a
   verified school email are cleared. The data-retention cleanup runs at startup
   and hourly thereafter.
3. Verify student and admin sign-in, OTP delivery to an authorized test address,
   notebook publishing and swapping, and logout. Confirm HTTPS and that the
   public URL serves this repo. Once verified, set that URL on the GitHub repo.
4. To roll back, stop the app and restore the pre-upgrade backup before
   restarting the previous version. Handle any credential exposure according
   to the [incident runbook](credential-incident.md).

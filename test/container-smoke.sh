#!/usr/bin/env bash
set -euo pipefail

image=${1:?Usage: bash test/container-smoke.sh IMAGE}
fixture_id=$(node -p "require('node:crypto').randomBytes(6).toString('hex')")
container="swappr-smoke-${fixture_id}"
volume="${container}-data"
origin=https://swappr.test
session_secret=$(node -p "require('node:crypto').randomBytes(32).toString('hex')")
admin_password="Local smoke test ${fixture_id}"

cleanup() {
  docker stop "${container}" >/dev/null 2>&1 || true
  docker volume rm "${volume}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "${volume}" >/dev/null
mount_args=(--mount "source=${volume},target=/app/sql")
docker run --rm "${mount_args[@]}" -e "SEED_ADMIN_PASSWORD=${admin_password}" "${image}" node seed.js --admin-only

start_container() {
  docker run --detach --rm --name "${container}" "${mount_args[@]}" \
    -e "APP_ORIGIN=${origin}" -e "SESSION_SECRET=${session_secret}" \
    -p 127.0.0.1::3000 "${image}" >/dev/null
  base_url="http://$(docker port "${container}" 3000/tcp)"
  if ! curl --fail --silent --show-error --max-time 3 --retry 8 --retry-delay 1 --retry-connrefused \
    "${base_url}/login.html" --output /dev/null; then
    docker logs "${container}" >&2 || true
    return 1
  fi
}

start_container
curl --fail --silent --show-error "${base_url}/css/tailwind.css" --output /dev/null
curl --fail --silent --show-error "${base_url}/js/vendor/lucide.js" --output /dev/null
cookie=$(curl --fail --silent --show-error --dump-header - --output /dev/null \
  -H "Origin: ${origin}" -H 'Content-Type: application/json' \
  --data "{\"username\":\"admin\",\"password\":\"${admin_password}\"}" \
  "${base_url}/api/login" | tr -d '\r' | awk 'tolower($1) == "set-cookie:" { sub(/;.*/, "", $2); print $2 }')
[[ "${cookie}" == swappr_session=* ]]

# Replacing the production container must retain app state on the named volume.
docker stop "${container}" >/dev/null
container="${container}-replacement"
start_container
curl --fail --silent --show-error -H "Cookie: ${cookie}" "${base_url}/api/me" |
  node -e 'const data = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (data.role !== "admin" || data.user.username !== "admin") process.exit(1);'

echo "Production container serves assets and keeps the administrator session after replacement."

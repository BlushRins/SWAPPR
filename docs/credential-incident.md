# Credential exposure response

1. Restrict access to the affected deployment while you scope the exposure. Identify affected accounts privately, including administrator accounts and accounts that already store a hash of the exposed password. Never copy passwords or database contents into issue comments, logs, or chat.
2. Back up the live database with restricted access. Deploy this update, then reset the affected credentials before restoring service. Rotate relevant deployment and session secrets and notify affected users privately. Ask users to change reused credentials on other services.
3. Coordinate removal of sensitive database files with the upstream repository and fork owners. Follow GitHub's guidance for rewriting affected refs, handling pull request references and caches, and coordinating cleanup of clones and forks. Keep issue #1 open until the exposure response has been verified.
4. Enable GitHub secret scanning and push protection where available. Keep account databases and their backups out of Git. The tracked course catalogs contain course reference data.

## Reset a live account

Run this in Bash from the upgraded app directory on the database host. Use
the same `SWAPPR_SQL_DIR` as the service and a new unique password. Substitute
`admin` for `student` when resetting an administrator.

```bash
read -r -s -p 'New password: ' swappr_reset_password
printf '\n'
RESET_PASSWORD="$swappr_reset_password" node scripts/reset-password.js student USERNAME
unset swappr_reset_password
```

The command updates the existing account and invalidates its sessions. Verify
the affected user can sign in with the replacement credential and that their
previous sessions are rejected. Deliver the replacement through a private,
verified channel.

## Check history coverage

In a full clone used for the incident, inventory affected paths without
extracting database rows. Repeat the check against the rewritten refs and a
fresh clone of each repo involved in the remediation.

```bash
git rev-parse --is-shallow-repository
git log --all --full-history --name-only --format= -- \
  ':(glob)**/swappr.db*' ':(glob)**/.vs/**' | awk 'NF' | sort -u
```

The first command should print `false`. Any path listed by the second
command is still reachable from a local ref in that clone. If you kept an
incident backup ref, store it in a separate restricted clone before using an
empty path inventory as a verification gate. GitHub pull request refs,
caches, and forks require the separate follow-up described by GitHub.

For history cleanup, follow
[GitHub's sensitive data removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

# Deploy: GitHub Actions → ghcr.io → Hetzner

`git push` to `main` → Actions builds the image from `Dockerfile` → pushes
`ghcr.io/mlitvino/junction-2026:{latest,sha-<short>}` → SSHes to the server and runs
`docker compose pull app && docker compose up -d`.

The files in this folder are templates. On the server, `~/junction-2026` holds
`docker-compose.yml`, `Caddyfile` and `.env` (from `.env.example`).

## One-time setup

1. Hetzner: install Docker; Cloud Firewall with only 22, 80, 443 open
   (Docker bypasses ufw, so ufw alone is not enough).
2. Optional swap (2–4 GB servers):
   ```bash
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
3. Separate deploy SSH key pair: public key → `~/.ssh/authorized_keys` on the server,
   private key → GitHub secret `SSH_KEY`.
4. GitHub → Settings → Secrets → Actions: `SSH_HOST`, `SSH_USER`, `SSH_KEY`.
   ghcr needs nothing: the built-in `GITHUB_TOKEN` has `packages: write`.
5. Copy `docker-compose.yml`, `Caddyfile`, `.env` to `~/junction-2026`; set the domain and
   `POSTGRES_PASSWORD`.
6. Push to `main`; check the image under Packages and the site over HTTPS.

## Rollback

| Way       | Command                                                    | Time    |
| --------- | ---------------------------------------------------------- | ------- |
| SSH + tag | `cd ~/junction-2026 && APP_TAG=sha-a1b2c3d docker compose up -d app` | ~10 s   |
| Re-run    | Actions → last green run → Re-run all jobs                 | 2–4 min |
| Revert    | `git revert <commit> && git push`                          | 2–4 min |

Tags: Packages page or `git log --oneline`. The next push returns the server to `latest`.
The database is not rolled back, so migrations must be additive only.

## Maintenance

- Backup before a risky migration: `docker compose exec db pg_dump -U app app > backup.sql`
- Old images on the server: `docker image prune -f` already runs on every deploy.
- Old versions in ghcr pile up: delete in Packages or with `actions/delete-package-versions`.

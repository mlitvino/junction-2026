# Deploy: GitHub Actions → ghcr.io → Hetzner

`git push` to `main` → Actions builds the image from `Dockerfile` → pushes
`ghcr.io/mlitvino/junction-2026:{latest,sha-<short>}` → SSHes to the server and runs
`docker compose pull app && docker compose up -d`.

The files in this folder are templates. On the server, `~/junction-2026` holds
`docker-compose.yml`, `Caddyfile` and `.env` (from `.env.example`).

## One-time setup

1. Hetzner: install Docker; Cloud Firewall with 22 and 9090 open for this app (80/443 stay
   open for the existing valinor.ink app). Docker bypasses ufw, so ufw alone is not enough.
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
5. Copy `docker-compose.yml`, `Caddyfile`, `.env` to `~/junction-2026`; set
   `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), keep
   `BETTER_AUTH_URL=https://valinor.ink:9090`. Set `GOOGLE_GENERATIVE_AI_API_KEY` (or `TEST_MODE=TRUE`
   for a demo without Gemini), else the agent endpoints answer 503 `AGENT_NOT_CONFIGURED`. The `valinor.ink` A record already points to this server.
6. Copy the existing valinor.ink certificate into `~/junction-2026/certs` (see "Certificate").
7. Push to `main`; check the image under Packages and the site at https://valinor.ink:9090.

## Certificate

The existing valinor.ink app owns ports 80/443, so Caddy can't request its own certificate.
It serves HTTPS on 9090 with the same certificate files as that app. Copy them onto the
server (example for certbot; adjust the paths if the app keeps them elsewhere):

```bash
mkdir -p ~/junction-2026/certs
sudo cp /etc/letsencrypt/live/valinor.ink/fullchain.pem ~/junction-2026/certs/
sudo cp /etc/letsencrypt/live/valinor.ink/private.key.pem ~/junction-2026/certs/
sudo chown "$USER": ~/junction-2026/certs/*.pem && chmod 600 ~/junction-2026/certs/private.key.pem
```

- Files must be named `fullchain.pem` (certificate + chain) and `private.key.pem` (private key),
  and the certificate must cover `valinor.ink`.
- The private key stays on the server only: `*.pem` is git- and docker-ignored.
- Certificates expire (Let's Encrypt: 90 days) and a copy does not renew itself. After the
  existing app renews, copy the files again and run `docker compose restart caddy`.

## Rollback

| Way       | Command                                                              | Time    |
| --------- | -------------------------------------------------------------------- | ------- |
| SSH + tag | `cd ~/junction-2026 && APP_TAG=sha-a1b2c3d docker compose up -d app` | ~10 s   |
| Re-run    | Actions → last green run → Re-run all jobs                           | 2–4 min |
| Revert    | `git revert <commit> && git push`                                    | 2–4 min |

Tags: Packages page or `git log --oneline`. The next push returns the server to `latest`.
The database is not rolled back, so migrations must be additive only. Exception: migration 0010 dropped the
retired procurement tables, so don't roll back to an image older than commit `9077a91`.

## Maintenance

- Backup before a risky migration: `docker compose exec db pg_dump -U app app > backup.sql`
- Old images on the server: `docker image prune -f` already runs on every deploy.
- Old versions in ghcr pile up: delete in Packages or with `actions/delete-package-versions`.

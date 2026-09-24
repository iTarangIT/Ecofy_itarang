# Deploying `main` to sandbox-ecofy.itarang.com (staging)

Pipeline: push to `main` → GitHub Actions (`.github/workflows/staging.yml`) lints, typechecks, runs unit
tests, builds the standalone app → uploads it over SSH to a Hostinger VPS → `deploy/remote-deploy.sh`
installs it under `/srv/ecofy/releases/<sha>`, switches `/srv/ecofy/current`, reloads PM2
(`ecofy-lms` + `ecofy-worker`), checks `/api/v1/health` and rolls back if it fails.

**Hosting note.** This app needs two long-running Node processes (web + worker) behind Nginx. Hostinger's
shared *Web/Cloud hosting* in hPanel cannot run that; use a **Hostinger KVM VPS** (Ubuntu 24.04, 2 vCPU /
4 GB is enough). Domains and DNS stay in hPanel.

**Secrets never go into git.** The repository is public and `.gitignore` blocks `.env` and `.env.*`.
The server's environment file lives in the GitHub secret `STAGING_ENV_FILE`; the workflow writes it to
`/srv/ecofy/shared/.env` (mode 600) on every deploy. `deploy/staging.env.example` is the template.

## 1. VPS (once)
1. hPanel → **VPS** → use an existing KVM (the script is safe next to other sites) or buy one with **Ubuntu 24.04**; note the public IP and root password.
2. SSH in as root and run the bootstrap (installs Node 22, PM2, Nginx, certbot, creates the `deploy` user,
   generates the Actions SSH key, writes the vhost, opens the firewall, requests the TLS certificate):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/iTarangIT/Ecofy_itarang/main/deploy/server-setup.sh | bash -s -- sandbox-ecofy.itarang.com
   ```
   It ends by printing the **private key** for `STAGING_SSH_KEY` and the server IP. Certbot only succeeds
   after step 2 has propagated; re-run `certbot --nginx -d sandbox-ecofy.itarang.com --redirect` if it failed.
3. **CloudPanel servers** (the existing iTarang KVM 2 is one): the script skips Nginx and certbot. Create the
   site in CloudPanel instead: Sites → Add Site → **Create a Reverse Proxy**, domain `sandbox-ecofy.itarang.com`,
   reverse proxy URL `http://127.0.0.1:3100`; then the site's SSL/TLS tab → Actions → New Let's Encrypt Certificate.

## 2. DNS (hPanel)
`sandbox-ecofy.itarang.com` is a subdomain of `itarang.com`, which is already in hPanel. **Domains → itarang.com → Manage →
DNS / Nameservers → Manage DNS records**:

| Type | Name | Points to | TTL |
|---|---|---|---|
| A | `sandbox-ecofy` | VPS public IP | 300 |


## 3. Database access
1. AWS console → RDS → `leadplatform-staging` → security group → add inbound **PostgreSQL 5432 from `<VPS IP>/32`**.
2. Register the host with the tenant (run from the office machine, which already has the owner URL in `.env.local`):
   ```bash
   npm run psql -- -c "INSERT INTO tenant_domains (tenant_id, host, is_primary) SELECT id, 'sandbox-ecofy.itarang.com', false FROM tenants WHERE code = 'ECOFY' ON CONFLICT (host) DO NOTHING;"
   ```
   Without this row `resolve_tenant()` returns nothing and every page answers "unknown tenant".
3. Supabase → Authentication → URL configuration → add `https://sandbox-ecofy.itarang.com` to **Redirect URLs**
   (needed for the password-reset e-mail link).

## 4. GitHub secrets and variables
Repository → **Settings → Secrets and variables → Actions**.

| Kind | Name | Value |
|---|---|---|
| Secret | `STAGING_SSH_KEY` | private key printed by the bootstrap (`/home/deploy/.ssh/github_actions`, whole file incl. BEGIN/END lines) |
| Secret | `STAGING_SSH_HOST` | VPS public IP |
| Secret | `STAGING_ENV_FILE` | the filled copy of `deploy/staging.env.example` (start from your `.env.local`: copy `DATABASE_URL`, the three Supabase keys, `SUPABASE_JWT_SECRET`; set `TENANT_HOSTS=sandbox-ecofy.itarang.com`, `APP_BASE_URL=https://sandbox-ecofy.itarang.com`, `COOKIE_SECURE=true`, `NODE_ENV=production`; drop `OWNER_DATABASE_URL`, `PSQL`, `ECOFY_APP_PASSWORD`, `DEV_FIXTURE_PASSWORD`) |
| Variable | `STAGING_DOMAIN` | `sandbox-ecofy.itarang.com` |
| Variable | `STAGING_SSH_USER` | `deploy` (optional) |
| Variable | `STAGING_SSH_PORT` | `22` (optional) |

Optionally create an **Environment** named `staging` (Settings → Environments) with required reviewers if
deploys should wait for approval.

## 5. Deploy
- Push/merge to `main`, or **Actions → staging → Run workflow**.
- Watch the run: `build` (lint, typecheck, unit tests, `next build`) then `deploy`. The deploy step prints
  the health JSON (`{"db":true,...}`) and `pm2 ls`.
- First deploy has nothing to roll back to; if the health check fails, read the PM2 log lines in the job
  output (most often: RDS security group, wrong `DATABASE_URL`, missing `tenant_domains` row).

## 6. Operating the server
```bash
ssh deploy@<VPS IP>
pm2 ls                         # ecofy-lms, ecofy-worker
pm2 logs ecofy-lms --lines 100
pm2 logs ecofy-worker --lines 100
ls /srv/ecofy/releases         # last 5 releases kept
# manual rollback
ln -sfn /srv/ecofy/releases/<older sha> /srv/ecofy/current && pm2 startOrReload /srv/ecofy/current/ecosystem.config.cjs --update-env
```
Files written by the dev storage/mail/SMS drivers live in `/srv/ecofy/shared/data` (each release's `.data`
is a symlink to it). Dev mail and SMS with OTPs are files there, not real messages, until `MAIL_DRIVER=ses`
and `SMS_DRIVER=gupshup` are configured.

## Changing the environment
Edit the `STAGING_ENV_FILE` secret and re-run the workflow (Actions → staging → Run workflow). Nothing on
the server has to be edited by hand.

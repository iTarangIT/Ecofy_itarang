#!/usr/bin/env bash
# ONE-TIME bootstrap of a fresh Hostinger KVM VPS (Ubuntu 22.04 / 24.04). Run as root:
#   curl -fsSL https://raw.githubusercontent.com/iTarangIT/Ecofy_itarang/main/deploy/server-setup.sh | bash -s -- sandbox-ecofy.itarang.com
# Installs Node 22, PM2, Nginx, certbot; creates the `deploy` user and /srv/ecofy; generates the SSH key
# that GitHub Actions will use and prints the PRIVATE key to paste into the STAGING_SSH_KEY secret.
set -euo pipefail
DOMAIN="${1:?usage: server-setup.sh <domain>}"
PORT="${PORT:-3100}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx ufw ca-certificates gnupg

# Node 22 (NodeSource)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2@latest

# deploy user + release layout
id -u deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
mkdir -p /srv/ecofy/releases /srv/ecofy/shared/data
chown -R deploy:deploy /srv/ecofy
chmod 750 /srv/ecofy

# SSH key pair used by GitHub Actions (private half goes into the STAGING_SSH_KEY secret)
sudo -u deploy bash <<'DEPLOYUSER'
set -e
mkdir -p ~/.ssh && chmod 700 ~/.ssh
[ -f ~/.ssh/github_actions ] || ssh-keygen -t ed25519 -N "" -C "github-actions@ecofy" -f ~/.ssh/github_actions
touch ~/.ssh/authorized_keys
grep -qF "$(cat ~/.ssh/github_actions.pub)" ~/.ssh/authorized_keys || cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
DEPLOYUSER

# PM2 resurrects at boot for the deploy user; rotate logs
env PATH="$PATH:/usr/bin" pm2 startup systemd -u deploy --hp /home/deploy >/dev/null
sudo -u deploy pm2 install pm2-logrotate >/dev/null 2>&1 || true

# Nginx vhost (plain http for now; certbot rewrites it to https + redirect)
sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" "$(dirname "$0")/nginx.conf.template" 2>/dev/null > "/etc/nginx/sites-available/$DOMAIN" \
  || curl -fsSL "https://raw.githubusercontent.com/iTarangIT/Ecofy_itarang/main/deploy/nginx.conf.template" \
     | sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" > "/etc/nginx/sites-available/$DOMAIN"
ln -sfn "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Firewall
ufw allow OpenSSH >/dev/null
ufw allow "Nginx Full" >/dev/null
ufw --force enable >/dev/null

# TLS (the DNS A record must already point at this server)
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
  || echo "certbot failed (DNS not propagated yet?). Re-run later:  certbot --nginx -d $DOMAIN --redirect"

PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
cat <<MSG

=========================================================================
Server ready. Add these in GitHub -> Settings -> Secrets and variables -> Actions

  Secret   STAGING_SSH_HOST = $PUBLIC_IP
  Secret   STAGING_SSH_KEY  = the PRIVATE key printed below
  Secret   STAGING_ENV_FILE = your filled server .env (deploy/staging.env.example)
  Variable STAGING_DOMAIN   = $DOMAIN

-------- /home/deploy/.ssh/github_actions  (paste as STAGING_SSH_KEY) --------
$(cat /home/deploy/.ssh/github_actions)
------------------------------------------------------------------------------
Also allow $PUBLIC_IP in the RDS security group (TCP 5432).
=========================================================================
MSG

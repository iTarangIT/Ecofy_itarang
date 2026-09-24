#!/usr/bin/env bash
# ONE-TIME bootstrap of the VPS (Ubuntu 22.04 / 24.04). Safe on a server that already hosts other sites:
# it never replaces an existing Node, never removes existing Nginx sites, never enables a firewall.
# Run as root:
#   curl -fsSL https://raw.githubusercontent.com/iTarangIT/Ecofy_itarang/main/deploy/server-setup.sh | bash -s -- sandbox-ecofy.itarang.com
# Optional: PORT=3101 (default 3100) when 3100 is already taken on this server.
# It installs what is missing (Node 22, PM2, Nginx, certbot), creates the `deploy` user and /srv/ecofy,
# generates the SSH key GitHub Actions will use and prints the PRIVATE key for the STAGING_SSH_KEY secret.
set -euo pipefail
DOMAIN="${1:?usage: server-setup.sh <domain>}"
PORT="${PORT:-3100}"
export DEBIAN_FRONTEND=noninteractive

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

say "Pre-flight checks"
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$PORT\$"; then
  die "Port $PORT is already in use on this server. Re-run with PORT=3101 (and put PORT=3101 in the env secret)."
fi
if systemctl is-active --quiet apache2 2>/dev/null; then
  die "Apache is serving port 80 here. This setup uses Nginx; stop Apache or ask for an Apache vhost instead."
fi
if systemctl is-active --quiet caddy 2>/dev/null; then
  die "Caddy is serving port 80 here. This setup uses Nginx; ask for a Caddy config instead."
fi
if command -v node >/dev/null 2>&1; then
  major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "$major" -ge 20 ] || die "Node $(node -v) is installed and other apps may depend on it; the app needs Node >= 20. Decide how to upgrade before continuing."
  say "Keeping existing Node $(node -v)"
fi

CLP=0
if command -v clpctl >/dev/null 2>&1 || [ -d /home/clp ]; then CLP=1; say "CloudPanel detected: its Nginx and certificates will be used"; fi

say "Packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg
[ "$CLP" = 1 ] || apt-get install -y nginx

if ! command -v node >/dev/null 2>&1; then
  say "Installing Node 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v pm2 >/dev/null 2>&1; then
  say "Installing PM2"
  npm install -g pm2
fi

say "deploy user and /srv/ecofy"
id -u deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
mkdir -p /srv/ecofy/releases /srv/ecofy/shared/data
chown -R deploy:deploy /srv/ecofy
chmod 750 /srv/ecofy

say "SSH key for GitHub Actions"
sudo -u deploy bash <<'DEPLOYUSER'
set -e
mkdir -p ~/.ssh && chmod 700 ~/.ssh
[ -f ~/.ssh/github_actions ] || ssh-keygen -t ed25519 -N "" -C "github-actions@ecofy" -f ~/.ssh/github_actions
touch ~/.ssh/authorized_keys
grep -qF "$(cat ~/.ssh/github_actions.pub)" ~/.ssh/authorized_keys || cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
DEPLOYUSER

say "PM2 on boot for the deploy user (separate from any root PM2)"
env PATH="$PATH:/usr/bin:/usr/local/bin" pm2 startup systemd -u deploy --hp /home/deploy >/dev/null || true
sudo -u deploy pm2 install pm2-logrotate >/dev/null 2>&1 || true

if [ "$CLP" = 1 ]; then
  # CloudPanel owns Nginx and Let's Encrypt on this server: the vhost is created in its UI instead.
  PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  cat <<MSG

=========================================================================
CloudPanel detected. Create the site in CloudPanel (https://$PUBLIC_IP:8443):
  Sites -> Add Site -> Create a Reverse Proxy
    Domain Name:       $DOMAIN
    Reverse Proxy Url: http://127.0.0.1:$PORT
    Site User:         any name, e.g. ecofy
  then open the site -> SSL/TLS -> Actions -> New Let's Encrypt Certificate.

Add these in GitHub -> Settings -> Secrets and variables -> Actions
  Secret   STAGING_SSH_HOST = $PUBLIC_IP
  Secret   STAGING_SSH_KEY  = the PRIVATE key printed below
  Variable STAGING_DOMAIN   = $DOMAIN
  (STAGING_ENV_FILE must contain PORT=$PORT)

-------- /home/deploy/.ssh/github_actions  (paste as STAGING_SSH_KEY) --------
$(cat /home/deploy/.ssh/github_actions)
------------------------------------------------------------------------------
Also allow $PUBLIC_IP in the RDS security group (TCP 5432).
=========================================================================
MSG
  exit 0
fi

say "Nginx vhost for $DOMAIN -> 127.0.0.1:$PORT"
TEMPLATE="$(dirname "$0")/nginx.conf.template"
if [ -f "$TEMPLATE" ]; then
  sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" "$TEMPLATE" > "/etc/nginx/sites-available/$DOMAIN"
else
  curl -fsSL "https://raw.githubusercontent.com/iTarangIT/Ecofy_itarang/main/deploy/nginx.conf.template" \
    | sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" > "/etc/nginx/sites-available/$DOMAIN"
fi
ln -sfn "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t && systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  say "ufw is active: allowing HTTP/HTTPS (no other change)"
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

say "TLS certificate (DNS A record must already point here)"
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
  || echo "certbot failed (DNS not propagated yet?). Re-run later:  certbot --nginx -d $DOMAIN --redirect"

PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
cat <<MSG

=========================================================================
Server ready. Add these in GitHub -> Settings -> Secrets and variables -> Actions

  Secret   STAGING_SSH_HOST = $PUBLIC_IP
  Secret   STAGING_SSH_KEY  = the PRIVATE key printed below
  Variable STAGING_DOMAIN   = $DOMAIN
  (STAGING_ENV_FILE must contain PORT=$PORT)

-------- /home/deploy/.ssh/github_actions  (paste as STAGING_SSH_KEY) --------
$(cat /home/deploy/.ssh/github_actions)
------------------------------------------------------------------------------
Also allow $PUBLIC_IP in the RDS security group (TCP 5432).
=========================================================================
MSG

#!/usr/bin/env bash
# Run this ON the VPS (Ubuntu/Debian), as root, from inside the cloned repo root:
#
#   git clone <your-repo-url> email-validator && cd email-validator
#   sudo bash verifier-service/deploy.sh verifier.yourdomain.com
#
# It installs Node/pm2/Caddy if missing, builds and starts the verifier
# under pm2 (survives reboots), and puts it behind HTTPS via Caddy.
#
# What it CANNOT do for you (needs your own accounts/credentials):
#   - point verifier.yourdomain.com's A record at this box's IP
#   - ask your provider to unblock outbound port 25
#   - ask your provider to set the PTR/rDNS record for this IP
#   - set VERIFIER_SERVICE_URL / VERIFIER_SHARED_SECRET in Vercel
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: sudo bash verifier-service/deploy.sh <domain, e.g. verifier.yourdomain.com>"
  exit 1
fi

PORT="${PORT:-4000}"
SECRET="${VERIFIER_SHARED_SECRET:-$(openssl rand -hex 32)}"

apt-get update -y
apt-get install -y curl gnupg

echo "==> Installing Node.js (if missing)"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing pm2 (if missing)"
if ! command -v pm2 >/dev/null; then
  npm install -g pm2
fi

echo "==> Installing Caddy (if missing)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Installing deps + building verifier"
npm install
npm run build:verifier

echo "==> Starting service under pm2"
pm2 delete verifier >/dev/null 2>&1 || true
VERIFIER_SHARED_SECRET="$SECRET" PORT="$PORT" pm2 start npm --name verifier -- run start:verifier
pm2 save
STARTUP_CMD=$(pm2 startup systemd -u root --hp /root 2>&1 | grep '^sudo ' || true)
[ -n "$STARTUP_CMD" ] && eval "$STARTUP_CMD"

echo "==> Configuring Caddy reverse proxy for $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY_EOF
$DOMAIN {
    reverse_proxy 127.0.0.1:$PORT
}
CADDY_EOF
systemctl restart caddy

echo "==> Opening firewall (OpenSSH, 80, 443)"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH
  ufw allow 80,443/tcp
  ufw --force enable
fi

cat <<SUMMARY

============================================================
Service is running under pm2, proxied via Caddy. Still needed
before this actually works end to end (these need your own
accounts, so I can't do them from here):

1. DNS: point $DOMAIN's A record at this server's public IP.
2. PTR/rDNS: ask your provider to set the reverse record for
   this IP to $DOMAIN (DigitalOcean: rename the droplet to
   $DOMAIN in the control panel; AWS: support ticket).
3. Ask your provider to unblock outbound port 25 (support
   ticket, explain it's mailbox verification, not sending).
4. Check this IP isn't already blocklisted:
   https://mxtoolbox.com/blacklists.aspx

Then set these in Vercel (Project -> Settings -> Environment
Variables) and redeploy:

  VERIFIER_SERVICE_URL=https://$DOMAIN
  VERIFIER_SHARED_SECRET=$SECRET

(save that secret now -- this script won't print it again)
============================================================
SUMMARY

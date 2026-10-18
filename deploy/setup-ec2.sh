#!/usr/bin/env bash
# Sets up, or updates, Converza on an Ubuntu 24.04 server (e.g. AWS EC2):
# Node.js, the backend under pm2, the React build behind Nginx, HTTPS from
# Let's Encrypt, and the SFU announcing the server's public IP.
#
# First time:   DOMAIN=converza.duckdns.org EMAIL=you@example.com bash setup-ec2.sh
#               (asks for your MongoDB connection string and saves it to backend/.env)
# Update later: DOMAIN=converza.duckdns.org bash setup-ec2.sh
#
# By requesting a Let's Encrypt certificate, this script accepts the Let's
# Encrypt Subscriber Agreement on your behalf.
set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN, for example DOMAIN=converza.duckdns.org}"
EMAIL="${EMAIL:-}"
BRANCH="${BRANCH:-feature/sfu}"
REPO_URL="${REPO_URL:-https://github.com/Srujan-017/Converza.git}"
APP_DIR="${APP_DIR:-$HOME/converza}"
SITE_URL="${SITE_URL:-https://$DOMAIN}"
MEDIA_MIN_PORT="${MEDIA_MIN_PORT:-40000}"
MEDIA_MAX_PORT="${MEDIA_MAX_PORT:-40999}"
# "self-signed" is only for rehearsing on your own machine (e.g. in Docker).
CERT_MODE="${CERT_MODE:-letsencrypt}"
PUBLIC_IP="${PUBLIC_IP:-}"

if [ "$(id -u)" = 0 ]; then SUDO=""; else SUDO="sudo"; fi
IN_CONTAINER=false
[ -f /.dockerenv ] && IN_CONTAINER=true

log() { printf '\n==> %s\n' "$*"; }
reload_nginx() {
    $SUDO nginx -t
    if pidof nginx >/dev/null; then $SUDO nginx -s reload; else $SUDO nginx; fi
}

log "Installing system packages"
$SUDO apt-get update -y
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y nginx git curl ca-certificates openssl rsync procps
if [ "$CERT_MODE" = "letsencrypt" ]; then
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
fi

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1)" != "v20" ]; then
    log "Installing Node.js 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | ${SUDO:+$SUDO -E} bash -
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
command -v pm2 >/dev/null || $SUDO npm install -g pm2

# A 1 GB instance runs out of memory while building the React app.
if ! $IN_CONTAINER && [ "$(free -m | awk '/Mem:/ {print $2}')" -lt 2000 ] && ! swapon --show | grep -q /swapfile; then
    log "Adding 2 GB of swap"
    $SUDO fallocate -l 2G /swapfile
    $SUDO chmod 600 /swapfile
    $SUDO mkswap /swapfile
    $SUDO swapon /swapfile
    echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

if [ -z "$PUBLIC_IP" ]; then
    # EC2 instance metadata (IMDSv2)
    token=$(curl -sf --max-time 2 -X PUT http://169.254.169.254/latest/api/token \
        -H "X-aws-ec2-metadata-token-ttl-seconds: 60" || true)
    PUBLIC_IP=$(curl -sf --max-time 2 -H "X-aws-ec2-metadata-token: $token" \
        http://169.254.169.254/latest/meta-data/public-ipv4 || true)
fi
if [ -z "$PUBLIC_IP" ]; then
    echo "Could not detect this server's public IP. Run again with PUBLIC_IP=<your Elastic IP>."
    exit 1
fi

log "Getting the code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
DEPLOY_DIR="$APP_DIR/deploy"

ENV_FILE="$APP_DIR/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
    if [ -z "${MONGODB_URI:-}" ]; then
        # Asked here (not passed on the command line) so it doesn't end up in shell history.
        read -rsp "MongoDB connection string: " MONGODB_URI
        echo
    fi
    log "Writing backend/.env"
    (
        umask 077
        cat > "$ENV_FILE" <<EOF
MONGODB_URI=$MONGODB_URI
PORT=8000
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_ADDRESS=$PUBLIC_IP
MEDIASOUP_MIN_PORT=$MEDIA_MIN_PORT
MEDIASOUP_MAX_PORT=$MEDIA_MAX_PORT
MEDIASOUP_NUM_WORKERS=$(nproc)
EOF
    )
else
    echo "backend/.env already exists; leaving it unchanged (edit it to change settings)."
fi

log "Installing backend packages"
(cd "$APP_DIR/backend" && npm ci --omit=dev)

log "Building the frontend for $SITE_URL"
(cd "$APP_DIR/frontend" && npm ci && REACT_APP_SERVER_URL="$SITE_URL" npm run build)
$SUDO mkdir -p /var/www/converza /var/www/certbot
$SUDO rsync -a --delete "$APP_DIR/frontend/build/" /var/www/converza/

render_nginx() {
    sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__CERT_PATH__|$CERT|g" -e "s|__KEY_PATH__|$KEY|g" "$1" \
        | $SUDO tee /etc/nginx/sites-available/converza >/dev/null
    $SUDO ln -sf /etc/nginx/sites-available/converza /etc/nginx/sites-enabled/converza
    $SUDO rm -f /etc/nginx/sites-enabled/default
}

if [ "$CERT_MODE" = "self-signed" ]; then
    CERT=/etc/ssl/converza/selfsigned.crt
    KEY=/etc/ssl/converza/selfsigned.key
    if [ ! -f "$CERT" ]; then
        log "Creating a self-signed certificate (rehearsal only)"
        $SUDO mkdir -p /etc/ssl/converza
        $SUDO openssl req -x509 -nodes -newkey rsa:2048 -days 30 -subj "/CN=$DOMAIN" \
            -keyout "$KEY" -out "$CERT" >/dev/null 2>&1
    fi
else
    CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    KEY="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
    if ! $SUDO test -f "$CERT"; then
        log "Getting an HTTPS certificate from Let's Encrypt"
        render_nginx "$DEPLOY_DIR/nginx/converza-bootstrap.conf"
        reload_nginx
        if [ -n "$EMAIL" ]; then contact=(-m "$EMAIL"); else contact=(--register-unsafely-without-email); fi
        $SUDO certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
            --non-interactive --agree-tos "${contact[@]}" \
            --deploy-hook "nginx -s reload"
    fi
fi

log "Configuring Nginx"
render_nginx "$DEPLOY_DIR/nginx/converza.conf"
reload_nginx

log "Starting the backend"
pm2 startOrReload "$DEPLOY_DIR/ecosystem.config.cjs" --update-env
pm2 save
if ! $IN_CONTAINER; then
    $SUDO env PATH="$PATH" pm2 startup systemd -u "$(id -un)" --hp "$HOME" >/dev/null
fi

log "Checking health"
for _ in $(seq 1 30); do
    if health=$(curl -sfk --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/v1/health"); then
        echo "$health"
        break
    fi
    sleep 2
done
if [ -z "${health:-}" ]; then
    echo "The backend did not answer. See: pm2 logs converza-backend"
    exit 1
fi

cat <<EOF

Converza is running at $SITE_URL
Media ports: UDP and TCP $MEDIA_MIN_PORT-$MEDIA_MAX_PORT on $PUBLIC_IP
(open them in the EC2 security group, together with TCP 80 and 443).
Logs: pm2 logs converza-backend
EOF

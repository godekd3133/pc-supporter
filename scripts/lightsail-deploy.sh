#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_TARGET="${PC_SUPPORTER_SSH_TARGET:-ubuntu@3.39.79.1}"
SSH_KEY="${PC_SUPPORTER_SSH_KEY:-}"
SSH_CERTIFICATE="${PC_SUPPORTER_SSH_CERTIFICATE:-}"
ENV_FILE=""
DOMAIN="${PC_SUPPORTER_API_DOMAIN:-pc-supporter.3-39-79-1.sslip.io}"
REMOTE_TMP="${PC_SUPPORTER_REMOTE_TMP:-/tmp/pc-supporter-lightsail}"
APP_DIR="${PC_SUPPORTER_REMOTE_APP_DIR:-/opt/pc-supporter}"
INTERNAL_HEALTH_TIMEOUT_SECONDS="${PC_SUPPORTER_INTERNAL_HEALTH_TIMEOUT_SECONDS:-240}"
SERVICE_NAME="pc-supporter-api"
PRESERVE_ENV=false
DRY_RUN=false
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/lightsail-deploy.sh \
    --host ubuntu@<lightsail-ip-or-host> \
    --domain pc-supporter.<ip-with-dashes>.sslip.io

Options:
  --host                 SSH target. Default: ubuntu@3.39.79.1.
  --ssh-key              SSH private key path.
  --ssh-certificate      Temporary OpenSSH certificate path from Lightsail.
  --env-file             Production backend env file. The first deployment can
                         omit this; the remote host then generates admin auth
                         secrets without printing them.
  --domain               HTTPS host. Default: pc-supporter.3-39-79-1.sslip.io.
  --remote-tmp           Remote temporary upload directory.
  --app-dir              Remote application directory.
  PC_SUPPORTER_INTERNAL_HEALTH_TIMEOUT_SECONDS
                         Maximum seconds to wait for the first API start (default: 240).
  --preserve-env         Keep the existing remote /etc/pc-supporter/backend.env.
  --dry-run              Create and inspect the bundle without SSH or AWS writes.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      SSH_TARGET="${2:-}"
      shift 2
      ;;
    --ssh-key)
      SSH_KEY="${2:-}"
      shift 2
      ;;
    --ssh-certificate)
      SSH_CERTIFICATE="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --remote-tmp)
      REMOTE_TMP="${2:-}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --preserve-env)
      PRESERVE_ENV=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "--domain must contain only hostname characters." >&2
  exit 2
fi

if [[ "$APP_DIR" != /* || "$REMOTE_TMP" != /tmp/* ]]; then
  echo "--app-dir must be absolute and --remote-tmp must stay under /tmp." >&2
  exit 2
fi

if [[ ! "$INTERNAL_HEALTH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "PC_SUPPORTER_INTERNAL_HEALTH_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
fi

if [[ "$PRESERVE_ENV" != "true" && -n "$ENV_FILE" && ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 2
fi

for path in "$SSH_KEY" "$SSH_CERTIFICATE"; do
  if [[ -n "$path" && ! -f "$path" ]]; then
    echo "SSH file not found: $path" >&2
    exit 2
  fi
done

require_cmd tar
require_cmd mktemp
require_cmd curl
if [[ "$DRY_RUN" != "true" ]]; then
  require_cmd ssh
  require_cmd scp
fi

if [[ ! -f "$ROOT_DIR/package.json" || ! -f "$ROOT_DIR/package-lock.json" || ! -f "$ROOT_DIR/dist/index.html" ]]; then
  echo "Build the web client first; package.json, package-lock.json, and dist/index.html are required." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/pc-supporter-deploy.XXXXXX)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

BUNDLE="$TMP_DIR/pc-supporter-$RELEASE_ID.tar.gz"
(
  cd "$ROOT_DIR"
  tar \
    --exclude='.DS_Store' \
    --exclude='node_modules' \
    --exclude='data/*.json' \
    --exclude='data/*.lock' \
    --exclude='data/*.lease' \
    --exclude='data/*.tmp' \
    -czf "$BUNDLE" \
    package.json \
    package-lock.json \
    tsconfig.json \
    dist \
    server \
    shared \
    scripts/import-private-catalog.ts
)

echo "pc_supporter_bundle=status=ok release=$RELEASE_ID"
tar -tzf "$BUNDLE" | sed -n '1,36p'

if [[ "$DRY_RUN" == "true" ]]; then
  echo "pc_supporter_deploy=status=ok mode=dry-run release=$RELEASE_ID domain=$DOMAIN"
  exit 0
fi

SSH_ARGS=()
SCP_ARGS=()
if [[ -n "$SSH_KEY" ]]; then
  SSH_ARGS+=(-i "$SSH_KEY")
  SCP_ARGS+=(-i "$SSH_KEY")
fi
if [[ -n "$SSH_CERTIFICATE" ]]; then
  SSH_ARGS+=(-o "CertificateFile=$SSH_CERTIFICATE")
  SCP_ARGS+=(-o "CertificateFile=$SSH_CERTIFICATE")
fi

ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "mkdir -p '$REMOTE_TMP'"
scp "${SCP_ARGS[@]}" "$BUNDLE" "$SSH_TARGET:$REMOTE_TMP/pc-supporter.tar.gz"
if [[ "$PRESERVE_ENV" != "true" && -n "$ENV_FILE" ]]; then
  scp "${SCP_ARGS[@]}" "$ENV_FILE" "$SSH_TARGET:$REMOTE_TMP/backend.env"
fi

ssh "${SSH_ARGS[@]}" "$SSH_TARGET" \
  "RELEASE_ID='$RELEASE_ID' REMOTE_TMP='$REMOTE_TMP' APP_DIR='$APP_DIR' DOMAIN='$DOMAIN' SERVICE_NAME='$SERVICE_NAME' PRESERVE_ENV='$PRESERVE_ENV' HAS_ENV='$([[ -n "$ENV_FILE" ]] && echo true || echo false)' INTERNAL_HEALTH_TIMEOUT_SECONDS='$INTERNAL_HEALTH_TIMEOUT_SECONDS' bash -s" <<'REMOTE'
set -euo pipefail

SERVICE_USER="pc-supporter"
RELEASE_DIR="$APP_DIR/releases/$RELEASE_ID"
ENV_PATH="/etc/pc-supporter/backend.env"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  sudo useradd --system --user-group --home /var/lib/pc-supporter --shell /usr/sbin/nologin "$SERVICE_USER"
fi

sudo mkdir -p "$RELEASE_DIR" "$APP_DIR/shared" /etc/pc-supporter /var/lib/pc-supporter /var/log/pc-supporter
sudo chown -R "$SERVICE_USER:$SERVICE_USER" /var/lib/pc-supporter /var/log/pc-supporter
sudo tar -xzf "$REMOTE_TMP/pc-supporter.tar.gz" -C "$RELEASE_DIR"
sudo chown -R root:root "$RELEASE_DIR"

if [[ "$PRESERVE_ENV" == "true" ]]; then
  if [[ ! -f "$ENV_PATH" ]]; then
    echo "Remote env does not exist; refusing --preserve-env deployment." >&2
    exit 1
  fi
elif [[ "$HAS_ENV" == "true" ]]; then
  sudo install -o root -g "$SERVICE_USER" -m 0640 "$REMOTE_TMP/backend.env" "$ENV_PATH"
elif [[ ! -f "$ENV_PATH" ]]; then
  admin_password="$(openssl rand -hex 32)"
  admin_session_secret="$(openssl rand -hex 32)"
  umask 077
  cat > "$REMOTE_TMP/backend.env.generated" <<ENV
NODE_ENV=production
PORT=4174
PC_SUPPORTER_DATA_DIR=/var/lib/pc-supporter
DANAWA_CRAWL_ON_START=false
BUILD_MONITOR_SCHEDULER_ENABLED=false
CORS_ALLOWED_ORIGINS=capacitor://localhost,https://localhost,http://localhost,https://$DOMAIN
ADMIN_COOKIE_SAMESITE=none
ADMIN_PASSWORD=$admin_password
ADMIN_SESSION_SECRET=$admin_session_secret
ENV
  sudo install -o root -g "$SERVICE_USER" -m 0640 "$REMOTE_TMP/backend.env.generated" "$ENV_PATH"
  rm -f "$REMOTE_TMP/backend.env.generated"
fi

if ! sudo grep -Eq '^ADMIN_PASSWORD=[^[:space:]]+' "$ENV_PATH" || ! sudo grep -Eq '^ADMIN_SESSION_SECRET=[^[:space:]]+' "$ENV_PATH"; then
  echo "Production admin authentication is not configured; refusing public deployment." >&2
  exit 1
fi

install_node() {
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
}
if ! command -v node >/dev/null 2>&1; then
  install_node
else
  node_major_version="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [[ "$node_major_version" -lt 22 ]]; then
    install_node
  fi
fi

lock_hash="$(sha256sum "$RELEASE_DIR/package-lock.json" | awk '{print $1}')"
shared_hash=""
if [[ -f "$APP_DIR/shared/package-lock.sha256" ]]; then
  shared_hash="$(cat "$APP_DIR/shared/package-lock.sha256")"
fi
if [[ ! -x "$APP_DIR/shared/node_modules/.bin/tsx" || "$shared_hash" != "$lock_hash" ]]; then
  sudo install -o root -g root -m 0644 "$RELEASE_DIR/package.json" "$APP_DIR/shared/package.json"
  sudo install -o root -g root -m 0644 "$RELEASE_DIR/package-lock.json" "$APP_DIR/shared/package-lock.json"
  sudo npm ci --prefix "$APP_DIR/shared" --include=dev --no-audit --no-fund
  printf '%s\n' "$lock_hash" | sudo tee "$APP_DIR/shared/package-lock.sha256" >/dev/null
fi
sudo ln -sfn "$APP_DIR/shared/node_modules" "$RELEASE_DIR/node_modules"
sudo ln -sfn "$RELEASE_DIR" "$APP_DIR/current"

NPM_BIN="$(command -v npm)"
sudo install -o root -g root -m 0644 /dev/stdin "/etc/systemd/system/$SERVICE_NAME.service" <<SERVICE
[Unit]
Description=PC Supporter API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR/current
EnvironmentFile=$ENV_PATH
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=$NPM_BIN run start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICE

if ! command -v caddy >/dev/null 2>&1; then
  echo "Caddy is not installed on the KBO Lightsail host; refusing to replace its HTTPS setup." >&2
  exit 1
fi

if ! sudo grep -Fq "# pc-supporter-managed" /etc/caddy/Caddyfile; then
  sudo cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.pc-supporter-backup-$RELEASE_ID"
  cat > "$REMOTE_TMP/pc-supporter.caddy" <<CADDY

# pc-supporter-managed
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:4174
}
CADDY
  sudo tee -a /etc/caddy/Caddyfile < "$REMOTE_TMP/pc-supporter.caddy" >/dev/null
fi

sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl reload caddy

health_body=""
health_deadline=$((SECONDS + INTERNAL_HEALTH_TIMEOUT_SECONDS))
while (( SECONDS < health_deadline )); do
  if health_body="$(curl -fsS --max-time 10 http://127.0.0.1:4174/api/health 2>/dev/null)"; then
    break
  fi
  if ! sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "PC Supporter API stopped before its internal health check completed." >&2
    sudo systemctl status "$SERVICE_NAME" --no-pager -l || true
    sudo journalctl -u "$SERVICE_NAME" -n 120 --no-pager || true
    exit 1
  fi
  sleep 2
done
if [[ -z "$health_body" ]]; then
  echo "PC Supporter API did not become healthy within ${INTERNAL_HEALTH_TIMEOUT_SECONDS}s." >&2
  sudo systemctl status "$SERVICE_NAME" --no-pager -l || true
  sudo journalctl -u "$SERVICE_NAME" -n 120 --no-pager || true
  exit 1
fi
printf '%s\n' "$health_body"
sudo systemctl is-active "$SERVICE_NAME"
sudo systemctl is-active caddy
rm -f "$REMOTE_TMP/pc-supporter.tar.gz" "$REMOTE_TMP/backend.env"
echo "pc_supporter_remote_deploy=status=ok release=$RELEASE_ID"
REMOTE

headers_file="$TMP_DIR/headers.txt"
body_file="$TMP_DIR/health.json"
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 8 -H 'Origin: https://localhost' -D "$headers_file" "https://$DOMAIN/api/health" -o "$body_file"; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    echo "External HTTPS health check failed: https://$DOMAIN/api/health" >&2
    exit 1
  fi
  sleep 2
done

grep -Fi "access-control-allow-origin: https://localhost" "$headers_file" >/dev/null
echo "pc_supporter_external_health=status=ok url=https://$DOMAIN/api/health"
cat "$body_file"
echo
echo "PC_SUPPORTER_API_BASE_URL=https://$DOMAIN"

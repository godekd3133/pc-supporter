#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_TARGET="${PC_SUPPORTER_SSH_TARGET:-ubuntu@3.39.79.1}"
SSH_KEY="${PC_SUPPORTER_SSH_KEY:-}"
SSH_CERTIFICATE="${PC_SUPPORTER_SSH_CERTIFICATE:-}"
ENV_FILE=""
MIGRATION_ENV_FILE=""
DOMAIN="${PC_SUPPORTER_API_DOMAIN:-pc-supporter.3-39-79-1.sslip.io}"
REMOTE_TMP="${PC_SUPPORTER_REMOTE_TMP:-/tmp/pc-supporter-lightsail}"
APP_DIR="${PC_SUPPORTER_REMOTE_APP_DIR:-/opt/pc-supporter}"
INTERNAL_HEALTH_TIMEOUT_SECONDS="${PC_SUPPORTER_INTERNAL_HEALTH_TIMEOUT_SECONDS:-240}"
SERVICE_NAME="pc-supporter-api"
WORKER_SERVICE_NAME="pc-supporter-worker"
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
                         secrets without printing them. It is loaded by API/worker.
  --migration-env-file   Root-only PostgreSQL owner credentials plus runtime-role
                         bootstrap inputs. It is never loaded by API/worker.
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
    --migration-env-file)
      MIGRATION_ENV_FILE="${2:-}"
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

if [[ ! "$APP_DIR" =~ ^/[A-Za-z0-9._/-]+$ || "$APP_DIR" == *"/../"* || "$APP_DIR" == */.. \
  || ! "$REMOTE_TMP" =~ ^/tmp/[A-Za-z0-9._/-]+$ || "$REMOTE_TMP" == "/tmp" || "$REMOTE_TMP" == */ \
  || "$REMOTE_TMP" == *"/../"* || "$REMOTE_TMP" == */.. ]]; then
  echo "--app-dir and --remote-tmp must use safe absolute paths; --remote-tmp must stay under /tmp." >&2
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
if [[ -n "$MIGRATION_ENV_FILE" && ! -f "$MIGRATION_ENV_FILE" ]]; then
  echo "Migration env file not found: $MIGRATION_ENV_FILE" >&2
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
require_cmd rg
if [[ "$DRY_RUN" != "true" ]]; then
  require_cmd ssh
  require_cmd scp
fi

if [[ ! -f "$ROOT_DIR/package.json" || ! -f "$ROOT_DIR/package-lock.json" || ! -f "$ROOT_DIR/dist/index.html" ]]; then
  echo "Build the web client first; package.json, package-lock.json, and dist/index.html are required." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/pc-supporter-deploy.XXXXXX)"
REMOTE_STAGE="$REMOTE_TMP/$(basename "$TMP_DIR")"
REMOTE_STAGE_CREATED=false
REMOTE_STAGE_COMPLETED=false
cleanup() {
  rm -rf "$TMP_DIR"
  if [[ "$REMOTE_STAGE_CREATED" == "true" && "$REMOTE_STAGE_COMPLETED" != "true" ]]; then
    ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "rm -f -- '$REMOTE_STAGE/pc-supporter.tar.gz' '$REMOTE_STAGE/backend.env' '$REMOTE_STAGE/migration.env' '$REMOTE_STAGE/backend.env.generated' '$REMOTE_STAGE/pc-supporter.caddy'; rmdir '$REMOTE_STAGE' 2>/dev/null || true" >/dev/null 2>&1 || true
  fi
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
    db/schema.sql \
    scripts/import-private-catalog.ts \
    scripts/import-file-runtime-state.ts \
    scripts/migrate-postgres.ts \
    scripts/bootstrap-postgres-runtime-role.mjs \
    scripts/postgres-runtime-role-smoke.mjs
)

echo "pc_supporter_bundle=status=ok release=$RELEASE_ID"
BUNDLE_LISTING="$TMP_DIR/pc-supporter-$RELEASE_ID.list"
tar -tzf "$BUNDLE" > "$BUNDLE_LISTING"
sed -n '1,36p' "$BUNDLE_LISTING"
for required_file in \
  db/schema.sql \
  scripts/import-file-runtime-state.ts \
  scripts/migrate-postgres.ts \
  scripts/bootstrap-postgres-runtime-role.mjs \
  scripts/postgres-runtime-role-smoke.mjs; do
  if ! rg -qx "$required_file" "$BUNDLE_LISTING"; then
    echo "Deployment bundle is missing the PostgreSQL startup file: $required_file" >&2
    exit 1
  fi
done
rg '^(db/schema.sql|scripts/migrate-postgres.ts|scripts/bootstrap-postgres-runtime-role.mjs|scripts/postgres-runtime-role-smoke.mjs)$' "$BUNDLE_LISTING"

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

REMOTE_STAGE_CREATED=true
ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "set -eu; umask 077; mkdir -p '$REMOTE_TMP'; test -d '$REMOTE_TMP'; test ! -L '$REMOTE_TMP'; test \"\$(stat -c %u '$REMOTE_TMP')\" = \"\$(id -u)\"; chmod 0700 '$REMOTE_TMP'; install -d -m 0700 '$REMOTE_STAGE'"
scp "${SCP_ARGS[@]}" "$BUNDLE" "$SSH_TARGET:$REMOTE_STAGE/pc-supporter.tar.gz"
if [[ "$PRESERVE_ENV" != "true" && -n "$ENV_FILE" ]]; then
  scp "${SCP_ARGS[@]}" "$ENV_FILE" "$SSH_TARGET:$REMOTE_STAGE/backend.env"
fi
if [[ -n "$MIGRATION_ENV_FILE" ]]; then
  scp "${SCP_ARGS[@]}" "$MIGRATION_ENV_FILE" "$SSH_TARGET:$REMOTE_STAGE/migration.env"
fi
STAGED_CHMOD="chmod 600 '$REMOTE_STAGE/pc-supporter.tar.gz'"
if [[ "$PRESERVE_ENV" != "true" && -n "$ENV_FILE" ]]; then STAGED_CHMOD+=" && chmod 600 '$REMOTE_STAGE/backend.env'"; fi
if [[ -n "$MIGRATION_ENV_FILE" ]]; then STAGED_CHMOD+=" && chmod 600 '$REMOTE_STAGE/migration.env'"; fi
ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "set -eu; $STAGED_CHMOD"

ssh "${SSH_ARGS[@]}" "$SSH_TARGET" \
  "RELEASE_ID='$RELEASE_ID' REMOTE_TMP='$REMOTE_STAGE' APP_DIR='$APP_DIR' DOMAIN='$DOMAIN' SERVICE_NAME='$SERVICE_NAME' WORKER_SERVICE_NAME='$WORKER_SERVICE_NAME' PRESERVE_ENV='$PRESERVE_ENV' HAS_ENV='$([[ -n "$ENV_FILE" ]] && echo true || echo false)' HAS_MIGRATION_ENV='$([[ -n "$MIGRATION_ENV_FILE" ]] && echo true || echo false)' INTERNAL_HEALTH_TIMEOUT_SECONDS='$INTERNAL_HEALTH_TIMEOUT_SECONDS' bash -s" <<'REMOTE'
set -euo pipefail

SERVICE_USER="pc-supporter"
RELEASE_DIR="$APP_DIR/releases/$RELEASE_ID"
ENV_PATH="/etc/pc-supporter/backend.env"
MIGRATION_ENV_PATH="/etc/pc-supporter/migration.env"
API_UNIT_PATH="/etc/systemd/system/$SERVICE_NAME.service"
WORKER_UNIT_PATH="/etc/systemd/system/$WORKER_SERVICE_NAME.service"
ENV_BACKUP_PATH="$ENV_PATH.rollback-$RELEASE_ID"
MIGRATION_ENV_BACKUP_PATH="$MIGRATION_ENV_PATH.rollback-$RELEASE_ID"
API_UNIT_BACKUP_PATH="$API_UNIT_PATH.rollback-$RELEASE_ID"
WORKER_UNIT_BACKUP_PATH="$WORKER_UNIT_PATH.rollback-$RELEASE_ID"
CADDY_BACKUP_PATH="/etc/caddy/Caddyfile.pc-supporter-backup-$RELEASE_ID"
PREVIOUS_RELEASE="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
PREVIOUS_HAS_POSTGRES=false
if [[ -f "$ENV_PATH" ]] && sudo grep -Eq '^DATABASE_URL=[^[:space:]]+' "$ENV_PATH"; then
  PREVIOUS_HAS_POSTGRES=true
fi
ENV_WAS_REPLACED=false
ENV_PREVIOUS_EXISTS=false
MIGRATION_ENV_WAS_REPLACED=false
MIGRATION_ENV_PREVIOUS_EXISTS=false
API_UNIT_PREVIOUS_EXISTS=false
WORKER_UNIT_PREVIOUS_EXISTS=false
RELEASE_SWITCHED=false
CADDY_CONFIG_CHANGED=false

rollback_failed_deployment() {
  local deploy_exit_status=$?
  trap - EXIT
  if [[ "$deploy_exit_status" -eq 0 ]]; then return; fi
  if [[ "$ENV_WAS_REPLACED" == "true" ]]; then
    if [[ "$ENV_PREVIOUS_EXISTS" == "true" ]]; then
      sudo install -o root -g "$SERVICE_USER" -m 0640 "$ENV_BACKUP_PATH" "$ENV_PATH" || true
    else
      sudo rm -f "$ENV_PATH" || true
    fi
  fi
  if [[ "$MIGRATION_ENV_WAS_REPLACED" == "true" ]]; then
    if [[ "$MIGRATION_ENV_PREVIOUS_EXISTS" == "true" ]]; then
      sudo install -o root -g root -m 0600 "$MIGRATION_ENV_BACKUP_PATH" "$MIGRATION_ENV_PATH" || true
    else
      sudo rm -f "$MIGRATION_ENV_PATH" || true
    fi
  fi
  if [[ "$CADDY_CONFIG_CHANGED" == "true" && -f "$CADDY_BACKUP_PATH" ]]; then
    sudo cp -p "$CADDY_BACKUP_PATH" /etc/caddy/Caddyfile || true
  fi
  if [[ "$RELEASE_SWITCHED" == "true" ]]; then
    if [[ "$API_UNIT_PREVIOUS_EXISTS" == "true" ]]; then
      sudo install -o root -g root -m 0644 "$API_UNIT_BACKUP_PATH" "$API_UNIT_PATH" || true
    else
      sudo rm -f "$API_UNIT_PATH" || true
    fi
    if [[ "$WORKER_UNIT_PREVIOUS_EXISTS" == "true" ]]; then
      sudo install -o root -g root -m 0644 "$WORKER_UNIT_BACKUP_PATH" "$WORKER_UNIT_PATH" || true
    else
      sudo rm -f "$WORKER_UNIT_PATH" || true
    fi
    sudo systemctl daemon-reload || true
    if [[ -n "$PREVIOUS_RELEASE" ]]; then
      sudo ln -sfn "$PREVIOUS_RELEASE" "$APP_DIR/current" || true
      sudo systemctl restart "$SERVICE_NAME" || true
      if [[ "$PREVIOUS_HAS_POSTGRES" == "true" && "$WORKER_UNIT_PREVIOUS_EXISTS" == "true" ]]; then
        sudo systemctl restart "$WORKER_SERVICE_NAME" || true
      else
        sudo systemctl disable "$WORKER_SERVICE_NAME" 2>/dev/null || true
        sudo systemctl stop "$WORKER_SERVICE_NAME" 2>/dev/null || true
      fi
      sudo systemctl reload caddy || true
      echo "Deployment failed; restored previous release $PREVIOUS_RELEASE and restarted its saved services." >&2
    else
      sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
      sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
      sudo systemctl disable "$WORKER_SERVICE_NAME" 2>/dev/null || true
      sudo systemctl stop "$WORKER_SERVICE_NAME" 2>/dev/null || true
      echo "Deployment failed without a previous release; disabled the new service units." >&2
    fi
  fi
  cleanup_remote_staging
  exit "$deploy_exit_status"
}
cleanup_remote_staging() {
  rm -f -- "$REMOTE_TMP/pc-supporter.tar.gz" "$REMOTE_TMP/backend.env" "$REMOTE_TMP/migration.env" "$REMOTE_TMP/backend.env.generated" "$REMOTE_TMP/pc-supporter.caddy"
  rmdir "$REMOTE_TMP" 2>/dev/null || true
}
trap rollback_failed_deployment EXIT

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
  if [[ -f "$ENV_PATH" ]]; then
    sudo cp -p "$ENV_PATH" "$ENV_BACKUP_PATH"
    ENV_PREVIOUS_EXISTS=true
  fi
  ENV_WAS_REPLACED=true
  sudo install -o root -g "$SERVICE_USER" -m 0640 "$REMOTE_TMP/backend.env" "$ENV_PATH"
elif [[ ! -f "$ENV_PATH" ]]; then
  admin_password="$(openssl rand -hex 32)"
  admin_session_secret="$(openssl rand -hex 32)"
  rate_limit_hmac_secret="$(openssl rand -hex 32)"
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
RATE_LIMIT_HMAC_SECRET=$rate_limit_hmac_secret
ENV
  ENV_WAS_REPLACED=true
  sudo install -o root -g "$SERVICE_USER" -m 0640 "$REMOTE_TMP/backend.env.generated" "$ENV_PATH"
  rm -f "$REMOTE_TMP/backend.env.generated"
fi

if [[ "$HAS_MIGRATION_ENV" == "true" ]]; then
  if [[ -f "$MIGRATION_ENV_PATH" ]]; then
    sudo cp -p "$MIGRATION_ENV_PATH" "$MIGRATION_ENV_BACKUP_PATH"
    MIGRATION_ENV_PREVIOUS_EXISTS=true
  fi
  MIGRATION_ENV_WAS_REPLACED=true
  sudo install -o root -g root -m 0600 "$REMOTE_TMP/migration.env" "$MIGRATION_ENV_PATH"
fi

if ! sudo grep -Eq '^ADMIN_PASSWORD=[^[:space:]]+' "$ENV_PATH" || ! sudo grep -Eq '^ADMIN_SESSION_SECRET=[^[:space:]]+' "$ENV_PATH"; then
  echo "Production admin authentication is not configured; refusing public deployment." >&2
  exit 1
fi
session_secret_value="$(sudo sed -n 's/^ADMIN_SESSION_SECRET=//p' "$ENV_PATH" | head -n 1)"
session_secret_value="${session_secret_value%\"}"
session_secret_value="${session_secret_value#\"}"
session_secret_value="${session_secret_value%\'}"
session_secret_value="${session_secret_value#\'}"
if [[ "$session_secret_value" == "pc-supporter-local-session-secret" ]]; then
  echo "Production admin authentication cannot use the development session secret; refusing public deployment." >&2
  exit 1
fi
unset session_secret_value

if sudo grep -Eq '^DATABASE_URL=[^[:space:]]+' "$ENV_PATH" && ! sudo grep -Eq '^RATE_LIMIT_HMAC_SECRET=[^[:space:]]{32,}$' "$ENV_PATH"; then
  echo "PostgreSQL-backed rate limiting requires a shared RATE_LIMIT_HMAC_SECRET of at least 32 characters; refusing public deployment." >&2
  exit 1
fi
HAS_POSTGRES=false
SERVICE_PROCESS_ROLE=combined
if sudo grep -Eq '^(DATABASE_MIGRATION_URL|DATABASE_RUNTIME_ROLE|DATABASE_RUNTIME_PASSWORD|POSTGRES_PASSWORD|POSTGRES_OWNER_PASSWORD|POSTGRES_RUNTIME_PASSWORD)=' "$ENV_PATH"; then
  echo "Owner and role-bootstrap credentials must stay in /etc/pc-supporter/migration.env, outside the API/worker EnvironmentFile." >&2
  exit 1
fi
if ! sudo grep -Eq '^DATABASE_URL=[^[:space:]]+' "$ENV_PATH"; then
  echo "DATABASE_URL is required; the application no longer supports file-backed persistence and refuses to start without it." >&2
  exit 1
fi
HAS_POSTGRES=true
SERVICE_PROCESS_ROLE=api
if ! sudo grep -Eq '^PC_SUPPORTER_POSTGRES_DATA_MIGRATION_CONFIRMED=true$' "$ENV_PATH"; then
  echo "Existing file-backed user state is not copied automatically. Set this operator attestation only after reviewing the frozen DATA_DIR manifest, applying each present SQL-backed source, and verifying target readback." >&2
  exit 1
fi

if [[ "$HAS_POSTGRES" == "true" ]]; then
  if [[ ! -f "$MIGRATION_ENV_PATH" ]]; then
    echo "PostgreSQL startup requires root-only /etc/pc-supporter/migration.env with the schema-owner URL and runtime-role inputs." >&2
    exit 1
  fi
  if ! sudo grep -Eq '^DATABASE_MIGRATION_URL=.' "$MIGRATION_ENV_PATH" \
    || ! sudo grep -Eq '^DATABASE_RUNTIME_ROLE=.' "$MIGRATION_ENV_PATH" \
    || ! sudo grep -Eq '^DATABASE_RUNTIME_PASSWORD=.' "$MIGRATION_ENV_PATH"; then
    echo "PostgreSQL migration env must define DATABASE_MIGRATION_URL, DATABASE_RUNTIME_ROLE, and DATABASE_RUNTIME_PASSWORD." >&2
    exit 1
  fi
  if sudo grep -Eq '^(DATABASE_URL|POSTGRES_PASSWORD|POSTGRES_OWNER_PASSWORD)=' "$MIGRATION_ENV_PATH"; then
    echo "The root-only migration env cannot contain an application DATABASE_URL or Compose owner-password key." >&2
    exit 1
  fi
  while IFS= read -r migration_env_key; do
    [[ -z "$migration_env_key" || "$migration_env_key" == \#* ]] && continue
    migration_env_key="${migration_env_key%%=*}"
    case "$migration_env_key" in
      DATABASE_MIGRATION_URL|DATABASE_RUNTIME_ROLE|DATABASE_RUNTIME_PASSWORD|PGPASSWORD|PGHOST|PGPORT|PGDATABASE|PGUSER|PGSSLMODE|PGSSLCERT|PGSSLKEY|PGSSLROOTCERT) ;;
      *)
        echo "The root-only migration env contains an unsupported variable name." >&2
        exit 1
        ;;
    esac
  done < <(sudo sed -n '/^[A-Za-z_][A-Za-z0-9_]*=/p' "$MIGRATION_ENV_PATH")
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
RELEASE_SWITCHED=true

NPM_BIN="$(command -v npm)"
if [[ -f "$API_UNIT_PATH" ]]; then
  sudo cp -p "$API_UNIT_PATH" "$API_UNIT_BACKUP_PATH"
  API_UNIT_PREVIOUS_EXISTS=true
fi
if [[ -f "$WORKER_UNIT_PATH" ]]; then
  sudo cp -p "$WORKER_UNIT_PATH" "$WORKER_UNIT_BACKUP_PATH"
  WORKER_UNIT_PREVIOUS_EXISTS=true
fi

sudo install -o root -g root -m 0644 /dev/stdin "$API_UNIT_PATH" <<SERVICE
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
UnsetEnvironment=DATABASE_MIGRATION_URL DATABASE_RUNTIME_ROLE DATABASE_RUNTIME_PASSWORD POSTGRES_PASSWORD POSTGRES_OWNER_PASSWORD POSTGRES_RUNTIME_PASSWORD
Environment=PC_SUPPORTER_PROCESS_ROLE=$SERVICE_PROCESS_ROLE
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=$NPM_BIN run start
Restart=always
RestartSec=5
TimeoutStopSec=120
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICE

if [[ "$HAS_POSTGRES" == "true" ]]; then
  sudo install -o root -g root -m 0644 /dev/stdin "$WORKER_UNIT_PATH" <<SERVICE
[Unit]
Description=PC Supporter background worker
After=network-online.target $SERVICE_NAME.service
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR/current
EnvironmentFile=$ENV_PATH
UnsetEnvironment=DATABASE_MIGRATION_URL DATABASE_RUNTIME_ROLE DATABASE_RUNTIME_PASSWORD POSTGRES_PASSWORD POSTGRES_OWNER_PASSWORD POSTGRES_RUNTIME_PASSWORD
Environment=PC_SUPPORTER_PROCESS_ROLE=worker
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=$NPM_BIN run worker
Restart=always
RestartSec=5
TimeoutStopSec=120
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICE
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "Caddy is not installed on the KBO Lightsail host; refusing to replace its HTTPS setup." >&2
  exit 1
fi

if ! sudo grep -Fq "# pc-supporter-managed" /etc/caddy/Caddyfile; then
  sudo cp -p /etc/caddy/Caddyfile "$CADDY_BACKUP_PATH"
  cat > "$REMOTE_TMP/pc-supporter.caddy" <<CADDY

# pc-supporter-managed
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:4174
}
CADDY
  CADDY_CONFIG_CHANGED=true
  sudo tee -a /etc/caddy/Caddyfile < "$REMOTE_TMP/pc-supporter.caddy" >/dev/null
fi

sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
if [[ "$HAS_POSTGRES" == "true" ]]; then
  echo "Applying the PostgreSQL schema migration before runtime role provisioning."
  sudo systemd-run \
    --quiet --wait --collect --pipe \
    --unit="pc-supporter-db-migrate-$RELEASE_ID" \
    --property=User=root \
    --property="WorkingDirectory=$APP_DIR/current" \
    --property="EnvironmentFile=$MIGRATION_ENV_PATH" \
    --property=RuntimeMaxSec=300 \
    "$NPM_BIN" run db:migrate
  echo "Provisioning the restricted PostgreSQL runtime role before API/worker startup."
  sudo systemd-run \
    --quiet --wait --collect --pipe \
    --unit="pc-supporter-db-runtime-role-$RELEASE_ID" \
    --property=User=root \
    --property="WorkingDirectory=$APP_DIR/current" \
    --property="EnvironmentFile=$MIGRATION_ENV_PATH" \
    --property=RuntimeMaxSec=300 \
    node scripts/bootstrap-postgres-runtime-role.mjs
  echo "Checking the configured application DATABASE_URL has runtime-only PostgreSQL privileges."
  sudo systemd-run \
    --quiet --wait --collect --pipe \
    --unit="pc-supporter-db-runtime-smoke-$RELEASE_ID" \
    --property="User=$SERVICE_USER" \
    --property="Group=$SERVICE_USER" \
    --property="WorkingDirectory=$APP_DIR/current" \
    --property="EnvironmentFile=$ENV_PATH" \
    --property=RuntimeMaxSec=60 \
    node scripts/postgres-runtime-role-smoke.mjs
fi
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
if [[ "$HAS_POSTGRES" == "true" ]]; then
  sudo systemctl enable "$WORKER_SERVICE_NAME"
  worker_boot_epoch="$(date +%s)"
  sudo systemctl restart "$WORKER_SERVICE_NAME"
else
  sudo systemctl disable "$WORKER_SERVICE_NAME" 2>/dev/null || true
  if sudo systemctl is-active --quiet "$WORKER_SERVICE_NAME"; then
    sudo systemctl stop "$WORKER_SERVICE_NAME"
  fi
fi
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
if [[ "$HAS_POSTGRES" == "true" ]]; then
  worker_data_dir="$(sudo sed -n 's/^PC_SUPPORTER_DATA_DIR=//p' "$ENV_PATH" | head -n 1)"
  worker_data_dir="${worker_data_dir%\"}"
  worker_data_dir="${worker_data_dir#\"}"
  worker_data_dir="${worker_data_dir%\'}"
  worker_data_dir="${worker_data_dir#\'}"
  if [[ -z "$worker_data_dir" ]]; then worker_data_dir="$APP_DIR/current/data"; fi
  worker_health_file="$worker_data_dir/.price-refresh-worker-health.json"
  worker_ready=false
  worker_health_deadline=$((SECONDS + 60))
  while (( SECONDS < worker_health_deadline )); do
    if ! sudo systemctl is-active --quiet "$WORKER_SERVICE_NAME"; then break; fi
    if sudo -u "$SERVICE_USER" env PC_SUPPORTER_WORKER_HEALTH_FILE="$worker_health_file" PC_SUPPORTER_WORKER_BOOT_EPOCH="$worker_boot_epoch" node -e 'const fs=require("node:fs");try{const h=JSON.parse(fs.readFileSync(process.env.PC_SUPPORTER_WORKER_HEALTH_FILE,"utf8"));const last=Date.parse(h.lastDatabaseSuccessAt);const started=Date.parse(h.startedAt);const boot=Number(process.env.PC_SUPPORTER_WORKER_BOOT_EPOCH)*1000;if(h.service!=="pc-supporter-price-refresh-worker"||!Number.isFinite(last)||Date.now()-last>45000||!Number.isFinite(started)||started<boot)process.exit(1)}catch{process.exit(1)}'; then
      worker_ready=true
      break
    fi
    sleep 1
  done
  if [[ "$worker_ready" != "true" ]]; then
    echo "PC Supporter worker process is active but did not report a fresh successful PostgreSQL heartbeat." >&2
    sudo systemctl status "$WORKER_SERVICE_NAME" --no-pager -l || true
    sudo journalctl -u "$WORKER_SERVICE_NAME" -n 120 --no-pager || true
    exit 1
  fi
  sudo systemctl is-active "$WORKER_SERVICE_NAME"
fi
sudo systemctl is-active caddy
cleanup_remote_staging
if [[ "$ENV_PREVIOUS_EXISTS" == "true" ]]; then sudo rm -f "$ENV_BACKUP_PATH"; fi
if [[ "$MIGRATION_ENV_PREVIOUS_EXISTS" == "true" ]]; then sudo rm -f "$MIGRATION_ENV_BACKUP_PATH"; fi
sudo rm -f "$API_UNIT_BACKUP_PATH" "$WORKER_UNIT_BACKUP_PATH"
trap - EXIT
echo "pc_supporter_remote_deploy=status=ok release=$RELEASE_ID"
REMOTE
REMOTE_STAGE_COMPLETED=true

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

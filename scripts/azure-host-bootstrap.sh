#!/usr/bin/env bash
# Run on a fresh, dedicated Azure Ubuntu VM, never on the shared Lightsail host.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sudo bash scripts/azure-host-bootstrap.sh [options]

  --postgres-major 16|17|18  PostgreSQL major (default: 16, matching the source DB).
  --node-version 22.x.y     Pin a Node 22 patch; default: current official 22 LTS.
  --check-only              Validate inputs and fresh-host guards without writes.
  --help                    Show help.

Installs Node 22, PostgreSQL, and stable Caddy on Ubuntu 24.04 amd64.
It creates no Azure resources, DB credentials, app env, or application release.
It never upgrades an Azure for Students subscription to paid billing.
EOF
}

fail() { printf 'pc_supporter_azure_bootstrap: %s\n' "$*" >&2; return 1; }

validate_platform() {
  [[ "$1" == ubuntu && "$2" == 24.04 ]] || {
    fail 'Only Ubuntu 24.04 is supported.'; return 1;
  }
  [[ "$3" == amd64 ]] || {
    fail 'Only amd64/x64 is supported.'; return 1;
  }
}

validate_versions() {
  [[ "$1" =~ ^(16|17|18)$ ]] || {
    fail 'PostgreSQL major must be 16, 17, or 18.'; return 1;
  }
  [[ -z "$2" || "$2" =~ ^22\.[0-9]+\.[0-9]+$ ]] || {
    fail 'Node version must be an explicit 22.x.y patch.'; return 1;
  }
}

main() {
  local postgres_major=16 node_version='' check_only=false
  # SSH may forward an unavailable client locale; use Ubuntu's installed UTF-8 locale.
  export LANG=C.UTF-8 LC_ALL=C.UTF-8
  while (( $# )); do
    case "$1" in
      --postgres-major|--node-version)
        (( $# >= 2 )) || { fail 'A version argument is missing.'; return 2; }
        if [[ "$1" == --postgres-major ]]; then postgres_major="$2"; else node_version="$2"; fi
        shift 2 ;;
      --check-only) check_only=true; shift ;;
      --help|-h) usage; return 0 ;;
      *) fail "Unknown argument: $1"; return 2 ;;
    esac
  done
  validate_versions "$postgres_major" "$node_version" || return 2
  [[ -r /etc/os-release ]] || { fail 'Cannot read the operating system identity.'; return 1; }
  # os-release is the root-owned OS identity, not an application env file.
  local ID='' VERSION_ID=''
  . /etc/os-release
  command -v dpkg >/dev/null || { fail 'dpkg is required.'; return 1; }
  validate_platform "$ID" "$VERSION_ID" "$(dpkg --print-architecture)" || return 1
  command -v systemctl >/dev/null || { fail 'systemd is required.'; return 1; }
  [[ -d /run/systemd/system ]] || { fail 'systemd must be running.'; return 1; }

  # Refuse existing application/DB/web ownership instead of overwriting it.
  local path
  for path in /opt/pc-supporter /etc/pc-supporter /var/lib/pc-supporter /etc/caddy/Caddyfile; do
    [[ ! -e "$path" && ! -L "$path" ]] || {
      fail "Existing $path: this script requires a fresh dedicated host."; return 1;
    }
  done
  ! id pc-supporter >/dev/null 2>&1 || {
    fail 'The pc-supporter service user already exists.'; return 1;
  }
  if [[ -d /etc/postgresql ]] && find /etc/postgresql -name postgresql.conf -print -quit | read -r path; then
    fail 'An existing PostgreSQL cluster must be handled separately.'; return 1
  fi
  local installed_node=''
  if command -v node >/dev/null; then
    installed_node="$(node --version)"
    [[ "$installed_node" =~ ^v22\.[0-9]+\.[0-9]+$ ]] || {
      fail 'Existing Node must be 22.x; refusing replacement.'; return 1;
    }
    [[ -z "$node_version" || "$installed_node" == "v$node_version" ]] || {
      fail 'Existing Node does not match the requested patch.'; return 1;
    }
    command -v npm >/dev/null || { fail 'The existing Node needs npm.'; return 1; }
  fi
  if [[ "$check_only" == true ]]; then
    printf 'pc_supporter_azure_bootstrap=status=ok mode=check-only os=ubuntu-24.04 arch=amd64 postgres=%s\n' "$postgres_major"
    return 0
  fi
  [[ "$EUID" == 0 ]] || { fail 'Run with sudo on the new Azure VM.'; return 1; }
  umask 022
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install --yes ca-certificates curl gnupg xz-utils sudo openssl iproute2 python3

  local work_dir
  work_dir="$(mktemp -d /opt/.pc-supporter-bootstrap.XXXXXX)"
  # Only remove the private temporary directory created by this invocation.
  # mktemp supplies this fixed-prefix path; preserve it after main's locals leave scope.
  trap "rm -rf -- '$work_dir'" EXIT
  local curl_args=(--proto '=https' --tlsv1.2 --fail --silent --show-error --retry 3 --connect-timeout 10 --max-time 180)

  if [[ -z "$installed_node" ]]; then
    local node_base archive checksum_line prefix
    if [[ -z "$node_version" ]]; then
      curl "${curl_args[@]}" https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$work_dir/node-checksums.txt"
      archive="$(awk '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' "$work_dir/node-checksums.txt")"
      [[ "$archive" =~ ^node-v(22\.[0-9]+\.[0-9]+)-linux-x64\.tar\.xz$ ]] || {
        fail 'Official Node 22 x64 checksum entry is missing or ambiguous.'; return 1;
      }
      node_version="${BASH_REMATCH[1]}"
    else
      archive="node-v$node_version-linux-x64.tar.xz"
      curl "${curl_args[@]}" "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$work_dir/node-checksums.txt"
    fi
    node_base="https://nodejs.org/dist/v$node_version"
    checksum_line="$(awk -v file="$archive" '$2 == file {print}' "$work_dir/node-checksums.txt")"
    [[ "$checksum_line" =~ ^[a-f0-9]{64}[[:space:]]+node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]] || {
      fail 'Official Node SHA256 entry is invalid.'; return 1;
    }
    curl "${curl_args[@]}" "$node_base/$archive" -o "$work_dir/$archive"
    (cd "$work_dir"; printf '%s\n' "$checksum_line" | sha256sum --check --status)
    tar -tJf "$work_dir/$archive" > "$work_dir/archive-paths.txt"
    prefix="node-v$node_version-linux-x64"
    awk -v prefix="$prefix/" '
      /^\// || /(^|\/)\.\.(\/|$)/ {bad=1}
      index($0,prefix)!=1 {bad=1}
      END {exit bad}
    ' "$work_dir/archive-paths.txt" || { fail 'Unsafe Node archive paths.'; return 1; }
    [[ ! -e "/opt/$prefix" ]] || { fail 'The Node install prefix already exists.'; return 1; }
    local binary
    for binary in node npm npx corepack; do
      [[ ! -e "/usr/local/bin/$binary" && ! -L "/usr/local/bin/$binary" ]] || {
        fail "Existing /usr/local/bin/$binary: refusing replacement."; return 1;
      }
    done
    tar -xJf "$work_dir/$archive" --no-same-owner --no-same-permissions -C "$work_dir"
    mv "$work_dir/$prefix" "/opt/$prefix"
    for binary in node npm npx corepack; do
      ln -s "/opt/$prefix/bin/$binary" "/usr/local/bin/$binary"
    done
  fi
  [[ "$(node --version)" =~ ^v22\.[0-9]+\.[0-9]+$ ]]
  npm --version >/dev/null

  # Noble's native PostgreSQL 16 matches the source. Other explicit majors use PGDG.
  if [[ "$postgres_major" != 16 ]]; then
    install -d -m 0755 /usr/share/postgresql-common/pgdg
    curl "${curl_args[@]}" https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$work_dir/postgresql.asc"
    install -m 0644 "$work_dir/postgresql.asc" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    cat > /etc/apt/sources.list.d/pc-supporter-pgdg.sources <<'PGDG'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: noble-pgdg
Architectures: amd64
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
PGDG
    apt-get update
  fi
  apt-get install --yes "postgresql-$postgres_major" "postgresql-client-$postgres_major"
  # pg_conftool treats dotted numeric values and prequoted strings differently.
  # Write this one PostgreSQL string literal directly, preserving other settings.
  python3 - "/etc/postgresql/$postgres_major/main/postgresql.conf" <<'PG_LISTEN'
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

def update_listen_addresses(contents):
    pattern = re.compile(
        r"^(?P<indent>[ \t]*)(?:#[ \t]*)?listen_addresses[ \t]*=[ \t]*[^\r\n]*?"
        r"(?P<suffix>[ \t]*(?:#[^\r\n]*)?)(?P<ending>\r?\n|$)",
        re.MULTILINE,
    )
    matches = list(pattern.finditer(contents))
    if len(matches) != 1:
        raise SystemExit("Expected exactly one listen_addresses setting; refusing an ambiguous edit.")
    match = matches[0]
    replacement = (match["indent"] + "listen_addresses = '127.0.0.1'"
                   + match["suffix"] + match["ending"])
    return contents[:match.start()] + replacement + contents[match.end():]

configuration = Path(sys.argv[1])
if configuration.is_symlink() or not configuration.is_file():
    raise SystemExit("Expected the installed PostgreSQL configuration file.")
previous = configuration.stat()
updated = update_listen_addresses(configuration.read_text(encoding="utf-8"))
descriptor, temporary = tempfile.mkstemp(prefix=".pc-supporter-listen.", dir=configuration.parent)
try:
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
        os.fchmod(output.fileno(), stat.S_IMODE(previous.st_mode))
        os.fchown(output.fileno(), previous.st_uid, previous.st_gid)
        output.write(updated)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, configuration)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PG_LISTEN
  pg_conftool "$postgres_major" main set port 5432
  # Parse the full configuration before stopping/restarting the existing cluster.
  [[ "$(sudo -u postgres "/usr/lib/postgresql/$postgres_major/bin/postgres" \
    -D "/var/lib/postgresql/$postgres_major/main" \
    -c "config_file=/etc/postgresql/$postgres_major/main/postgresql.conf" \
    -C listen_addresses)" == 127.0.0.1 ]]
  systemctl enable "postgresql@$postgres_major-main"
  systemctl restart "postgresql@$postgres_major-main"
  "/usr/lib/postgresql/$postgres_major/bin/pg_isready" -h 127.0.0.1 -p 5432 >/dev/null
  [[ "$(sudo -u postgres "/usr/lib/postgresql/$postgres_major/bin/psql" \
    --host=/var/run/postgresql --port=5432 --dbname=postgres -X -At \
    -c 'SHOW listen_addresses')" == 127.0.0.1 ]]
  ss -ltnH '( sport = :5432 )' | awk '$4 != "127.0.0.1:5432" {bad=1} END {exit bad}'

  # Stable Caddy packages and their systemd service, as documented by Caddy.
  apt-get install --yes debian-keyring debian-archive-keyring apt-transport-https
  curl "${curl_args[@]}" https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o "$work_dir/caddy.key"
  gpg --batch --yes --dearmor -o "$work_dir/caddy.gpg" "$work_dir/caddy.key"
  install -m 0644 "$work_dir/caddy.gpg" /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl "${curl_args[@]}" https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o "$work_dir/caddy.list"
  install -m 0644 "$work_dir/caddy.list" /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install --yes caddy
  systemctl stop caddy
  # No public site yet: the existing deploy script appends its managed domain.
  printf '# PC Supporter Azure fresh-host bootstrap; no sites configured.\n' > /etc/caddy/Caddyfile
  chmod 0644 /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl enable caddy
  systemctl start caddy

  useradd --system --user-group --home /var/lib/pc-supporter --shell /usr/sbin/nologin pc-supporter
  install -d -o root -g pc-supporter -m 0750 /etc/pc-supporter
  install -d -o pc-supporter -g pc-supporter -m 0750 /var/lib/pc-supporter /var/log/pc-supporter
  printf 'pc_supporter_azure_bootstrap=status=ok node=%s postgres=%s caddy=%s\n' \
    "$(node --version)" "$postgres_major" "$(caddy version | awk '{print $1}')"
  rm -rf -- "$work_dir"
  trap - EXIT
  printf 'Next: restore only PC Supporter data, install separated private env files, then reuse lightsail-deploy.sh --host --domain.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi

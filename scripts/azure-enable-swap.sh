#!/usr/bin/env bash
# A bounded memory guard for the dedicated PC Supporter Azure VM.
set -euo pipefail

readonly PC_SWAP_FILE=/swapfile-pc-supporter
readonly PC_SWAP_BYTES=2147483648
readonly PC_SWAP_MIN_FREE_BYTES=3221225472
readonly PC_SWAP_MARKER=pc-supporter-azure-swap-2gib
readonly PC_SWAP_FSTAB_LINE='/swapfile-pc-supporter none swap sw 0 0 # pc-supporter-azure-swap-2gib'

usage() {
  cat <<'EOF'
Usage: sudo bash scripts/azure-enable-swap.sh [--check-only]

Only root on Ubuntu 24.04 host pc-supporter-vm may run this helper.
It creates and activates a 2 GiB /swapfile-pc-supporter on ext4 or XFS,
then appends one owned /etc/fstab entry after saving a private backup.
--check-only performs all preflight checks without creating files or changing swap.
At least 3 GiB must be free before creation and for --check-only. A valid,
already active file is idempotent even if free space has subsequently decreased.
Existing files require the exact owned fstab entry, swap signature, size,
root:root ownership, mode 0600, and one hard link. Otherwise execution stops.
Other swap, Azure resources, services, and memory tunables are untouched.
EOF
}

fail() { printf 'pc_supporter_azure_swap: %s\n' "$*" >&2; return 1; }

validate_platform() {
  [[ "$1" == 0 ]] || { fail 'Root is required, including for --check-only.'; return 1; }
  [[ "$2" == Linux && "$3" == ubuntu && "$4" == 24.04 && "$5" == pc-supporter-vm ]] || {
    fail 'Only Ubuntu 24.04 host pc-supporter-vm is authorized.'; return 1;
  }
}

validate_storage() {
  [[ "$1" == ext4 || "$1" == xfs ]] || {
    fail 'The root filesystem must be ext4 or XFS.'; return 1;
  }
  [[ "$2" =~ ^[0-9]+$ ]] || { fail 'Cannot determine available disk space.'; return 1; }
  if [[ "${4:-true}" == true && "$2" -lt "$PC_SWAP_MIN_FREE_BYTES" ]]; then
    fail 'At least 3 GiB of free space on the root filesystem is required.'; return 1;
  fi
  # Preallocated swap files on XFS require Linux 4.18 or later (util-linux swapon).
  [[ "$3" =~ ^([0-9]+)\.([0-9]+) ]] || { fail 'Cannot identify the Linux kernel version.'; return 1; }
  if [[ "$1" == xfs ]] && (( BASH_REMATCH[1] < 4 || (BASH_REMATCH[1] == 4 && BASH_REMATCH[2] < 18) )); then
    fail 'Preallocated XFS swap requires Linux 4.18 or later.'; return 1
  fi
}

# A marker anywhere other than the exact single entry is an ownership conflict.
fstab_registration_state() {
  awk -v target="$PC_SWAP_FILE" -v marker="$PC_SWAP_MARKER" -v expected="$PC_SWAP_FSTAB_LINE" '
    $0 == expected {owned++; next}
    index($0, marker) || ($0 !~ /^[[:space:]]*#/ && $1 == target) {conflict=1}
    END {
      if (conflict || owned > 1) exit 1
      print (owned == 1 ? "registered" : "absent")
    }
  ' "$1" || { fail 'Conflicting or duplicate swap ownership in fstab.'; return 1; }
}

swap_state() {
  awk -v target="$PC_SWAP_FILE" '
    NR == 1 {if ($1 != "Filename" || $2 != "Type") bad=1; next}
    $1 == target {found=1}
    END {if (NR == 0 || bad) exit 1; print (found ? "active" : "inactive")}
  ' /proc/swaps
}

validate_file_metadata() {
  [[ "$1" == "0:0:600:$PC_SWAP_BYTES:1" ]] || {
    fail 'The swap file must be root:root, mode 0600, exactly 2 GiB, with one hard link.'; return 1;
  }
}

validate_owned_file() {
  [[ -f "$PC_SWAP_FILE" && ! -L "$PC_SWAP_FILE" ]] || { fail 'The swap path must be a regular file, not a symlink.'; return 1; }
  validate_file_metadata "$(stat --format='%u:%g:%a:%s:%h' -- "$PC_SWAP_FILE")" || return 1
  [[ "$(blkid --probe --match-tag TYPE --output value -- "$PC_SWAP_FILE")" == swap ]] || {
    fail 'The existing file has no valid swap signature.'; return 1;
  }
  [[ "$(findmnt --noheadings --output FSTYPE --target "$PC_SWAP_FILE")" == "$pc_swap_root_fs" ]] || {
    fail 'The swap file must be on the verified root filesystem.'; return 1;
  }
  [[ "$(stat --format='%d' -- "$PC_SWAP_FILE")" == "$(stat --format='%d' /)" ]] || {
    fail 'The swap file is not on the root filesystem device.'; return 1;
  }
  [[ "$(findmnt --noheadings --output TARGET --target "$PC_SWAP_FILE")" == / ]] || {
    fail 'The swap file is on a separate or bind-mounted filesystem.'; return 1;
  }
}

validate_active_file() {
  local page_bytes expected_kib
  page_bytes="$(getconf PAGESIZE)"
  [[ "$page_bytes" =~ ^[0-9]+$ && "$page_bytes" -gt 0 && "$page_bytes" -lt "$PC_SWAP_BYTES" ]] || {
    fail 'Cannot verify the active swap size.'; return 1;
  }
  expected_kib=$(( (PC_SWAP_BYTES - page_bytes) / 1024 ))
  awk -v target="$PC_SWAP_FILE" -v expected="$expected_kib" '
    NR > 1 && $1 == target {count++; if ($2 != "file" || $3 != expected) bad=1}
    END {exit count != 1 || bad}
  ' /proc/swaps || { fail 'The active swap type or usable size is unexpected.'; return 1; }
}

preflight() {
  local check_only="$1" enforce_free_space=true
  [[ -f /etc/fstab && ! -L /etc/fstab && "$(stat --format='%u:%g:%h' /etc/fstab)" == 0:0:1 ]] || {
    fail 'fstab must be an existing root-owned regular file.'; return 1;
  }
  local fstab_mode
  fstab_mode="$(stat --format='%a' /etc/fstab)"
  [[ "$fstab_mode" =~ ^[0-7]{3,4}$ ]] && (( (8#$fstab_mode & 0022) == 0 )) || {
    fail 'fstab must not be writable by group or others.'; return 1;
  }
  [[ -r /proc/swaps ]] || { fail 'Cannot inspect active swaps.'; return 1; }
  pc_swap_active="$(swap_state)" || { fail 'Cannot reliably identify the active swap state.'; return 1; }
  pc_swap_root_fs="$(findmnt --noheadings --output FSTYPE --target /)"
  local available_bytes
  available_bytes="$(df --block-size=1 --output=avail / | awk 'NR == 2 {print $1}')"
  pc_swap_registration="$(fstab_registration_state /etc/fstab)" || return 1
  if [[ -e "$PC_SWAP_FILE" || -L "$PC_SWAP_FILE" ]]; then
    [[ "$pc_swap_registration" == registered ]] || { fail 'Existing swap path has no owned fstab entry; refusing replacement.'; return 1; }
    validate_owned_file || return 1
    if [[ "$pc_swap_active" == active ]]; then
      validate_active_file || return 1
      if [[ "$check_only" == false ]]; then enforce_free_space=false; fi
    fi
  else
    [[ "$pc_swap_registration" == absent ]] || { fail 'Owned fstab entry exists but its swap file is missing.'; return 1; }
    [[ "$pc_swap_active" == inactive ]] || { fail 'An active swap uses the missing target path.'; return 1; }
  fi
  validate_storage "$pc_swap_root_fs" "$available_bytes" "$(uname -r)" "$enforce_free_space" || return 1
}

# Delete only the inode created by this invocation, and only while it is inactive.
# An active file is retained on later errors; disabling it could itself exhaust RAM.
cleanup_created_file() {
  local exit_status=$? active_state
  trap - EXIT
  if [[ "$pc_swap_created" == true && -f "$PC_SWAP_FILE" && ! -L "$PC_SWAP_FILE" && -r /proc/swaps ]]; then
    if active_state="$(swap_state)" && [[ "$active_state" == inactive && "$(stat --format='%d:%i' -- "$PC_SWAP_FILE")" == "$pc_swap_created_inode" ]]; then
      rm -- "$PC_SWAP_FILE" || true
    fi
  fi
  exit "$exit_status"
}

main() {
  local check_only=false
  while (( $# )); do
    case "$1" in
      --check-only) check_only=true; shift ;;
      --help|-h) usage; return 0 ;;
      *) fail 'Unknown argument. Use --help for usage.' || return 2 ;;
    esac
  done
  [[ "$EUID" == 0 ]] || { fail 'Root is required, including for --check-only.'; return 1; }
  [[ "$(uname -s)" == Linux && -r /etc/os-release ]] || { fail 'Only the authorized Linux VM is supported.'; return 1; }
  local ID='' VERSION_ID=''
  . /etc/os-release
  validate_platform "$EUID" "$(uname -s)" "$ID" "$VERSION_ID" "$(hostname -s)" || return 1
  export LANG=C.UTF-8 LC_ALL=C.UTF-8
  local command_name
  for command_name in awk blkid chmod chown cp df fallocate findmnt flock getconf mkswap mktemp rm sha256sum stat swapon tail; do
    command -v "$command_name" >/dev/null || { fail "Required command is unavailable: $command_name"; return 1; }
  done
  pc_swap_root_fs='' pc_swap_registration='' pc_swap_active=''
  preflight "$check_only" || return 1
  if [[ "$check_only" == true ]]; then
    local active=false
    if [[ "$pc_swap_active" == active ]]; then active=true; fi
    printf 'pc_supporter_azure_swap=status=ok mode=check-only filesystem=%s registration=%s active=%s bytes=%s\n' "$pc_swap_root_fs" "$pc_swap_registration" "$active" "$PC_SWAP_BYTES"
    return 0
  fi
  # Lock the existing fstab inode, without creating a separate persistent lock file.
  local fstab_fd
  exec {fstab_fd}</etc/fstab
  flock --exclusive --timeout 10 "$fstab_fd" || { fail 'Another swap setup holds the fstab lock.'; return 1; }
  preflight false || return 1
  if [[ "$pc_swap_registration" == registered ]]; then
    if [[ "$pc_swap_active" == active ]]; then
      printf 'pc_supporter_azure_swap=status=already-configured bytes=%s\n' "$PC_SWAP_BYTES"
      return 0
    fi
    swapon -- "$PC_SWAP_FILE" || { fail 'Activation failed; the existing owned file and fstab were preserved.'; return 1; }
    validate_active_file || return 1
    printf 'pc_supporter_azure_swap=status=activated-existing bytes=%s\n' "$PC_SWAP_BYTES"
    return 0
  fi

  umask 077
  local backup_dir fstab_sha fstab_inode last_byte
  fstab_inode="$(stat --format='%d:%i' /etc/fstab)"
  fstab_sha="$(sha256sum /etc/fstab | awk '{print $1}')"
  backup_dir="$(mktemp -d /etc/.pc-supporter-swap-fstab.XXXXXX)"
  chmod 0700 "$backup_dir"
  cp -- /etc/fstab "$backup_dir/fstab"
  chown root:root "$backup_dir" "$backup_dir/fstab"
  chmod 0600 "$backup_dir/fstab"
  [[ "$(sha256sum "$backup_dir/fstab" | awk '{print $1}')" == "$fstab_sha" ]] || {
    fail 'fstab changed while its private backup was being made.'; return 1;
  }
  pc_swap_created=false pc_swap_created_inode=''
  trap cleanup_created_file EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  # Exclusive creation prevents any existing path from being truncated.
  (set -o noclobber; : > "$PC_SWAP_FILE") || { fail 'The swap path appeared during setup; refusing replacement.'; return 1; }
  pc_swap_created=true
  pc_swap_created_inode="$(stat --format='%d:%i' -- "$PC_SWAP_FILE")"
  chmod 0600 "$PC_SWAP_FILE"
  chown root:root "$PC_SWAP_FILE"
  fallocate --length "$PC_SWAP_BYTES" -- "$PC_SWAP_FILE"
  mkswap -- "$PC_SWAP_FILE" >/dev/null
  validate_owned_file
  swapon -- "$PC_SWAP_FILE" || { fail 'Activation failed; only this run-created inactive file will be removed.'; return 1; }
  validate_active_file
  [[ -f /etc/fstab && ! -L /etc/fstab && "$(stat --format='%d:%i' /etc/fstab)" == "$fstab_inode" && "$(sha256sum /etc/fstab | awk '{print $1}')" == "$fstab_sha" ]] || {
    fail 'fstab changed concurrently. Active swap was retained; persistence needs manual review.'; return 1;
  }
  # Preserve all original bytes; add a separator only if the last line lacked one.
  last_byte="$(tail --bytes=1 /etc/fstab)"
  if [[ -s /etc/fstab && -n "$last_byte" ]]; then printf '\n' >> /etc/fstab; fi
  printf '%s\n' "$PC_SWAP_FSTAB_LINE" >> /etc/fstab
  [[ "$(fstab_registration_state /etc/fstab)" == registered ]] || {
    fail 'Swap is active, but its fstab persistence needs manual review.'; return 1;
  }
  printf 'pc_supporter_azure_swap=status=configured bytes=%s fstab_backup=%s/fstab\n' "$PC_SWAP_BYTES" "$backup_dir"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi

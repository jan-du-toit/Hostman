#!/usr/bin/env bash
# Sourced by setup-linux.sh. Replaces link paths without following old symlinks.
hostman_install_commands() {
  local command_dir="$1" install_dir="$2" backup_dir="$3"
  local name temporary
  mkdir -p -- "$command_dir" "$backup_dir"
  # Backup both names before modifying either: older installs can link them together.
  for name in hostman hostmanager; do
    if [[ -e "$command_dir/$name" || -L "$command_dir/$name" ]]; then
      [[ ! -d "$command_dir/$name" || -L "$command_dir/$name" ]] || {
        echo "Refusing to replace directory $command_dir/$name" >&2; return 1
      }
      cp -P -- "$command_dir/$name" "$backup_dir/$name"
    fi
  done
  temporary="$(mktemp "$command_dir/.hostman-command-XXXXXXXX")"
  # printf %q makes installation directories safe as shell command arguments.
  {
    printf '#!/usr/bin/env bash\n'
    printf 'export HOSTMAN_PYTHON=/usr/bin/python3\n'
    printf 'exec %q %q "$@"\n' "$install_dir/runtime/node" "$install_dir/current/bin/hostman.mjs"
  } > "$temporary"
  chmod 755 "$temporary"
  mv -Tf -- "$temporary" "$command_dir/hostman"
  temporary="$(mktemp -u "$command_dir/.hostmanager-link-XXXXXXXX")"
  ln -s -- "$command_dir/hostman" "$temporary"
  mv -Tf -- "$temporary" "$command_dir/hostmanager"
}

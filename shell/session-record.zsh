# Source this file from ~/.zshrc.
# It asks which session record to use before claude, copilot, or ai <tool>.

_session_record_launch() {
  local tool="$1"
  shift

  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Could not find $tool on PATH." >&2
    return 127
  fi

  if ! command -v session-record >/dev/null 2>&1; then
    command "$tool" "$@"
    return $?
  fi

  local result_file="${TMPDIR:-/tmp}/session-record-$$-${tool}.json"
  session-record begin --tool "$tool" --terminal-id "$$" --result-file "$result_file" || return $?
  if [[ ! -f "$result_file" ]]; then
    echo "session-record did not record a choice." >&2
    return 1
  fi

  local action="" record_path="" record_id="" instruction_dir="" instruction_file=""
  local shell_exports
  shell_exports="$(session-record export-shell --result-file "$result_file")" || return $?
  eval "$shell_exports"
  rm -f "$result_file"

  if [[ "$action" == "attach" ]]; then
    export SESSION_RECORD_PATH="$record_path"
    export SESSION_RECORD_ID="$record_id"
    export SESSION_RECORD_TOOL="$tool"
    export SESSION_RECORD_TERMINAL="$$"
    if [[ -n "$instruction_dir" ]]; then
      if [[ -n "${COPILOT_CUSTOM_INSTRUCTIONS_DIRS:-}" ]]; then
        export COPILOT_CUSTOM_INSTRUCTIONS_DIRS="${instruction_dir},${COPILOT_CUSTOM_INSTRUCTIONS_DIRS}"
      else
        export COPILOT_CUSTOM_INSTRUCTIONS_DIRS="$instruction_dir"
      fi
    fi
    if [[ "$tool" == "claude" && -n "$instruction_file" ]]; then
      local prompt
      prompt="$(cat "$instruction_file")"
      command claude --append-system-prompt "$prompt" "$@"
      return $?
    fi
  fi

  command "$tool" "$@"
}

claude() { _session_record_launch claude "$@"; }
copilot() { _session_record_launch copilot "$@"; }
ai() {
  if [[ $# -lt 1 ]]; then
    echo "Usage: ai <tool> [arguments]" >&2
    return 1
  fi
  local tool="$1"
  shift
  _session_record_launch "$tool" "$@"
}

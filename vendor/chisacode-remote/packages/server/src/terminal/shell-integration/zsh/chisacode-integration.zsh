if [[ -n "${_CHISACODE_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _CHISACODE_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _CHISACODE_ZSH_COMMAND_ACTIVE=0

function _chisacode_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _chisacode_precmd() {
  local command_status=$?
  if [[ "$_CHISACODE_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _chisacode_osc633 "D;${command_status}"
    _CHISACODE_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _chisacode_osc633 "A"
}

function _chisacode_preexec() {
  _CHISACODE_ZSH_COMMAND_ACTIVE=1
  _chisacode_osc633 "B"
  _chisacode_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _chisacode_precmd
add-zsh-hook preexec _chisacode_preexec

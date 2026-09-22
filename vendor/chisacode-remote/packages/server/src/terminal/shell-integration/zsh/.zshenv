typeset -g CHISACODE_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${CHISACODE_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${CHISACODE_ZSH_ZDOTDIR}"
else
  unset ZDOTDIR
fi

if [[ -n "${ZDOTDIR-}" ]]; then
  if [[ -f "${ZDOTDIR}/.zshenv" ]]; then
    source "${ZDOTDIR}/.zshenv"
  fi
elif [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi

source "${CHISACODE_SHELL_INTEGRATION_DIR}/chisacode-integration.zsh"

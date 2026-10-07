#!/bin/zsh
set -euo pipefail

LAUNCHER_DIR="${0:A:h}"
if [[ -f "$LAUNCHER_DIR/codex-pool-select.py" ]]; then
  SCRIPT="$LAUNCHER_DIR/codex-pool-select.py"
else
  SCRIPT="$HOME/.local/share/codex-pool-select/codex-pool-select.py"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3，请先安装 Python 3。" >&2
  exit 1
fi
python3 "$SCRIPT"
exit_code=$?
echo
(( exit_code == 0 )) && echo "已切换并重启 Codex。" || echo "切换失败，请检查上面的错误信息。" >&2
read "_?按回车关闭窗口..."
exit $exit_code

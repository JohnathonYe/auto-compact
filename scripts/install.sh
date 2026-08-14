#!/usr/bin/env bash
# =============================================================================
# auto-compact 一键安装脚本（热挂载，无需重启 DSH）
#
# 原理：往 profile 的 cordis.patch.yml 写入挂载行 —— DSH 对 patch 文件有
# HMR 热监听，改完立即生效，只需刷新浏览器页面（Cmd+Shift+R）。
#
# 用法：
#   bash scripts/install.sh [版本] [--dry-run]
#
#   版本        npm 版本号/范围，缺省 latest。示例：1.2.0、^1.2.0、latest
#   --dry-run   只打印将要执行的操作，不写任何文件
#   -h/--help   打印本帮助
#
# 环境（均可省略，自动探测）：
#   DSH_HOME    默认 ~/.dsh（Windows Git Bash 下回退 $USERPROFILE/.dsh）
#   PROFILE     默认 web
#
# 说明：
# - 若 profile 已通过官方 bundle 通道（dsh plugin add）安装，脚本跳过写
#   挂载行（避免双挂载：两个 Host 半、两个圆环），提示直接刷新即可。
# - 卸载：pnpm remove auto-compact + 删除 cordis.patch.yml 中的挂载行。
# =============================================================================
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
if [ -z "${DSH_HOME:-}" ] && [ -n "${USERPROFILE:-}" ]; then
  DSH_HOME="$USERPROFILE/.dsh"
fi
PROFILE="${PROFILE:-web}"
DRY_RUN=0
VERSION=""

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --dry-run) DRY_RUN=1 ;;
    -*)
      echo "未知参数: $arg（-h 查看帮助）" >&2
      exit 2
      ;;
    *) VERSION="$arg" ;;
  esac
done

SPEC="${VERSION:-latest}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
MANIFEST="$PROFILE_DIR/package.json"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "错误：profile 目录不存在: $PROFILE_DIR" >&2
  echo "请确认 DSH 已初始化该 profile（或设置 PROFILE 环境变量）。" >&2
  exit 1
fi

echo "==> auto-compact 安装（profile: $PROFILE, 规格: $SPEC）"

# 0) 检测 bundle 通道是否已安装（避免双挂载）
if [ -f "$MANIFEST" ]; then
  if grep -q '"auto-compact"' "$MANIFEST"; then
    echo "==> 检测到已通过官方 bundle 通道安装（profile manifest 含 auto-compact）"
    echo "==> 跳过挂载行写入（避免双挂载）。直接刷新浏览器（Cmd+Shift+R）即可；"
    echo "    若刷新后圆环未出现，说明需要重启 DSH 进程使 bundle 生效。"
    exit 0
  fi
fi

# 1) pnpm 安装依赖
if [ "$DRY_RUN" = 1 ]; then
  echo "==> [dry-run] cd $PROFILE_DIR && pnpm add auto-compact@$SPEC"
else
  echo "==> 安装依赖: pnpm add auto-compact@$SPEC"
  (cd "$PROFILE_DIR" && pnpm add "auto-compact@$SPEC")
fi

# 2) 幂等写入挂载行（patch 通道 → HMR 热加载）
MOUNT_BLOCK=$'- insert:\n    - id: auto-compact\n      name: auto-compact\n'
if grep -q "id: auto-compact" "$PATCH_FILE" 2>/dev/null; then
  echo "==> cordis.patch.yml 已有挂载行，跳过。"
else
  if [ "$DRY_RUN" = 1 ]; then
    echo "==> [dry-run] 追加挂载行到 $PATCH_FILE"
  else
    echo "==> 追加挂载行到 $PATCH_FILE"
    printf '%s' "$MOUNT_BLOCK" >> "$PATCH_FILE"
  fi
fi

echo "==> 完成！"
if [ "$DRY_RUN" = 1 ]; then
  echo "==> [dry-run] 未写任何文件。"
else
  echo "    现在直接刷新浏览器页面（Cmd+Shift+R / Ctrl+Shift+R），"
  echo "    输入区右侧即出现阈值圆环 —— 无需重启 DSH。"
fi

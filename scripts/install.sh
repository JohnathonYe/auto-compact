#!/usr/bin/env bash
# =============================================================================
# auto-compact 一键安装脚本（官方 CLI 方式，macOS / Linux / Windows Git Bash）
#
# 通过 DSH 官方插件命令安装 npm 包并自动挂载：
#   dsh plugin --profile web add auto-compact@<version>
#
# 包内声明了 dsh.bundle.patch（cordis.patch.yml）：CLI 的 bundle 协调会把它
# 自动加进 profile 的 dsh.profile.bundles，下次启动即挂载——无需手动写
# cordis.patch.yml 挂载行。符合仓库硬约束：不修改 DSH 源码，插件永远作为
# 独立包被 profile 引用。
#
# 用法：
#   bash scripts/install.sh [版本] [--restart] [--dry-run]
#   curl -fsSL <raw url>/scripts/install.sh | bash -s [版本] [--restart]
#
#   版本        npm 版本号/范围，缺省为 latest（自动解析为 ^<最新>）。
#               示例：1.2.1、^1.2.1、~1.2.1、latest
#   --restart   装完后尝试 `pm2 restart dsh-web`（无 pm2 时仅打印提示）。
#               注意：重启会断开当前 DSH 页面会话，默认不自动重启。
#   --dry-run   只打印将要执行的操作，不写任何文件。
#   -h/--help   打印本帮助。
#
# 环境（均可省略，脚本会自动探测）：
#   DSH_HOME    默认 ~/.dsh（Windows Git Bash 下回退 $USERPROFILE/.dsh）
#   REGISTRY    默认 https://registry.npmjs.org（发布源；装依赖仍走 pnpm 配置）
#   DSH_CMD     默认优先用 PATH 上的 `dsh`，缺省回退 npx -y --package @deepseek-ai/dsh
#
# 说明：
# - `dsh` 通常不在全局 PATH（DSH 一般经 npx 安装），脚本会自动回退 npx 调用，
#   用户无需手动处理。
# - pnpm 11 的 minimumReleaseAge 会拒绝发布 <24h 的新版本。脚本会预写
#   minimumReleaseAgeExclude（幂等），放行本插件，避免"重跑一次才成功"。
# - 老版本（<1.2.0）用手动挂载行，bundle 通道激活后需移除，否则双挂载
#   （Node 半挂两次、页面两个圆环）。脚本会幂等移除 auto-compact 挂载行。
# - 回滚：dsh plugin --profile web remove auto-compact。
# =============================================================================
set -euo pipefail

# 帮助请求优先处理
for arg in "$@"; do
  if [ "$arg" = "-h" ] || [ "$arg" = "--help" ]; then
    cat <<'EOF'
auto-compact 一键安装脚本

用法：bash scripts/install.sh [版本] [--restart] [--dry-run]

  版本         npm 版本号/范围，缺省 latest（自动解析为最新）。示例：1.2.1、^1.2.1、latest
  --restart    装完后尝试 `pm2 restart dsh-web`（无 pm2 时仅提示）
  --dry-run    只打印将要执行的操作，不写任何文件

环境变量（可省略）：DSH_HOME（默认 ~/.dsh）、REGISTRY（npm 源）、DSH_CMD（dsh 命令）
EOF
    exit 0
  fi
done

DSH_HOME="${DSH_HOME:-${HOME:-${USERPROFILE:-}}/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/web"
WS_YML="$PROFILE_DIR/pnpm-workspace.yaml"
PATCH_YML="$PROFILE_DIR/cordis.patch.yml"
REGISTRY="${REGISTRY:-https://registry.npmjs.org}"
PKG="auto-compact"
DSH_CMD="${DSH_CMD:-dsh}"

RESTART=false
DRY_RUN=false
VERSION_SPEC=""
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=true ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help) : ;;  # 已在上面处理
    -*) echo "未知参数: ${arg}（用 -h 查看用法）" >&2; exit 2 ;;
    *) VERSION_SPEC="$arg" ;;
  esac
done

say()  { printf '\033[32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# 解析用户给的版本 -> CLI 要用的 npm spec（"x.y.z" / "^x.y.z" / latest）
resolve_spec() {
  local given="${1:-latest}"
  case "$given" in
    latest)
      local v=""
      if command -v npm >/dev/null 2>&1; then
        v="$(npm view "$PKG" version --registry="$REGISTRY" 2>/dev/null)" || v=""
      fi
      if [ -z "$v" ] && command -v pnpm >/dev/null 2>&1; then
        v="$(pnpm view "$PKG" version --registry="$REGISTRY" 2>/dev/null)" || v=""
      fi
      if [ -n "$v" ]; then
        printf '%s' "$v"
      else
        warn "无法联网解析最新版本（npm/pnpm 查询失败），回退为 latest，由 pnpm 直接解析。"
        warn "若已知版本号，可显式传入：bash scripts/install.sh 1.2.1"
        printf 'latest'
      fi
      ;;
    *) printf '%s' "$given" ;;
  esac
}

# 组装 dsh CLI 调用：优先 PATH 上的 dsh，缺省 npx 拉官方包
dsh_cli() {
  if command -v "$DSH_CMD" >/dev/null 2>&1; then
    printf '%s' "$DSH_CMD"
  elif command -v npx >/dev/null 2>&1; then
    printf 'npx -y --package @deepseek-ai/dsh dsh'
  else
    die "未找到 dsh 或 npx。请先安装 DSH（并确保 Node/npm 可用），或用 DSH_CMD 指定 dsh 路径。"
  fi
}

# 前置校验
command -v node >/dev/null 2>&1 || die "未找到 node（DSH 运行需要 Node.js ≥ 20），请先安装 Node.js 并加入 PATH。"

[ -d "$PROFILE_DIR" ] || die "找不到 profile 目录：${PROFILE_DIR}（请先安装并运行过一次 dsh web）"
[ -f "$WS_YML" ]      || die "找不到 ${WS_YML}（请先初始化 web profile）"

SPEC="$(resolve_spec "$VERSION_SPEC")"
CLI="$(dsh_cli)"
say "目标：$CLI plugin --profile web add $PKG@${SPEC}（profile: ${PROFILE_DIR}）"

if [ "$DRY_RUN" = true ]; then
  say "[dry-run] 步骤 1：确保 $WS_YML 含 minimumReleaseAgeExclude（${PKG}，放行 <24h 新版本）"
  say "[dry-run] 步骤 2：执行 $CLI plugin --profile web add $PKG@${SPEC}（安装 + bundle 自动注册）"
  say "[dry-run] 步骤 3：校验 dsh.profile.bundles 含 $PKG"
  say "[dry-run] 步骤 4：幂等移除 $PATCH_YML 里旧的 auto-compact 手动挂载行（避免双挂载）"
  if [ "$RESTART" = true ]; then say "[dry-run] 步骤 5：pm2 restart dsh-web"; else say "[dry-run] 步骤 5：提示用户手动重启 DSH"; fi
  exit 0
fi

# 步骤 1：预写 workspace 设置（幂等），放行 <24h 新版本，保证 pnpm 一步成功
WS_RESULT="$(node -e '
const fs = require("fs");
const p = process.argv[1];
let t = fs.readFileSync(p, "utf8");
const before = t;
if (!/^\s*-\s+auto-compact\s*$/m.test(t)) {
  if (/^\s*minimumReleaseAgeExclude:\s*$/m.test(t)) {
    t = t.replace(/^(\s*minimumReleaseAgeExclude:\s*)$/m, "$1\n  - auto-compact");
  } else {
    t += "\nminimumReleaseAgeExclude:\n  - auto-compact\n";
  }
}
if (t !== before) fs.writeFileSync(p, t);
console.log(t === before ? "unchanged" : "updated");
' "$WS_YML")"
[ "$WS_RESULT" = "updated" ] \
  && say "已确保 ${WS_YML}：minimumReleaseAgeExclude（${PKG}）" \
  || say "workspace 设置已就绪，跳过"

# 步骤 2：官方 CLI 安装 + bundle 自动注册（含挂载）
say "执行 $CLI plugin --profile web add $PKG@$SPEC ..."
if ! $CLI plugin --profile web add "$PKG@$SPEC" 2>&1 | tail -n +1; then
  warn "dsh plugin add 失败。已预写 minimumReleaseAgeExclude，仍失败的可能原因："
  warn "  - 网络/登录问题：npm registry 不可达或需要登录。"
  warn "  - 依赖安装冲突：可手动重试 cd $PROFILE_DIR && pnpm install。"
  exit 1
fi

# 校验 bundle 已注册（挂载生效的判据）
if ! node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bundles = p.dsh?.profile?.bundles ?? [];
  process.exit(bundles.includes(process.argv[2]) ? 0 : 1);
' "$PROFILE_DIR/package.json" "$PKG"; then
  warn "auto-compact 未出现在 dsh.profile.bundles 中——挂载未注册。"
  warn "若上面的 pnpm 输出有异常，请检查后重跑本脚本。"
  exit 1
fi
say "bundle 已注册：dsh.profile.bundles 包含 ${PKG}（下次启动自动挂载）"

# 步骤 3：幂等移除旧的 manual 挂载行（避免与 bundle 双挂载）
MOUNT_RESULT="$(node -e '
const fs = require("fs");
const p = process.argv[1];
const lines = fs.readFileSync(p, "utf8").split("\n");
const out = [];
let i = 0;
let removed = false;
while (i < lines.length) {
  const line = lines[i];
  if (/^[ \t]*- insert:\s*$/.test(line)) {
    const block = [line];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "" && !/^-\s/.test(lines[j])) {
      block.push(lines[j]);
      j++;
    }
    if (block.some((l) => /id:\s*auto-compact\b/.test(l))) {
      while (out.length && /^[ \t]*#/.test(out[out.length - 1])) out.pop();
      i = j;
      removed = true;
      continue;
    }
  }
  out.push(line);
  i++;
}
if (!removed) {
  console.log("none");
} else {
  const t = out.join("\n").replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(p, t);
  console.log("removed");
}
' "$PATCH_YML")"
[ "$MOUNT_RESULT" = "removed" ] \
  && say "已从 $PATCH_YML 移除旧的 auto-compact 手动挂载行（bundle 通道接管挂载）" \
  || say "无旧手动挂载行，跳过"

say "安装完成：$PKG@$SPEC"

# 步骤 4：重启提示
if [ "$RESTART" = true ]; then
  if command -v pm2 >/dev/null 2>&1; then
    say "重启 dsh-web（pm2）..."
    pm2 restart dsh-web || warn "pm2 restart 失败，请手动重启 DSH"
  else
    warn "未找到 pm2，请手动重启 DSH（如：pm2 restart dsh-web 或 dsh web）"
  fi
else
  say "下一步：重启 DSH 并硬刷新（Cmd/Ctrl+Shift+R）使插件生效。"
  if command -v pm2 >/dev/null 2>&1; then
    say "本机可用：pm2 restart dsh-web（会短暂断开当前页面会话）"
  fi
fi

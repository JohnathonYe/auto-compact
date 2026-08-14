# auto-compact

**会话级自动上下文压缩插件**（DeepSeek Harness / DSH）

在输入区右侧显示一个阈值圆环：当前会话上下文用量实时显示，拖动滑杆设置该会话的压缩阈值（1%–90%，**默认 50%**）。每当用量超过阈值，插件自动触发上下文压缩（compact）——回合中每走一步之前检查一次，回合结束时再检查一次——压缩摘要注入上下文后会话自然继续，全程无需手动干预，也不发送任何「继续」消息。

## 特性

- 🔴 **会话级阈值**：每个会话独立设置，互不影响（按 `sessionId` 持久化）
- 📊 **实时用量**：与自带 ContextMeter 同源（`useProjection("contextPressure")`），面板打开即实时刷新，无需轮询
- 🎚️ **1%–90% 细腻调节**：步进 1%，适合精细控制（**未设置时默认 50%**）
- 🤖 **全自动**：回合中每步前 + 回合结束自动检测 → 超阈值自动 compact → 摘要注入后自然继续
- 🛡️ **零崩溃风险**：所有检查都在 `agent/pre-step`（waterfall 中间件）与 `agent/turn-stopping`（串行事件）里做，全程 try/catch，绝不抛出
- 💾 **持久化**：阈值存于 `settings.yaml` 的 `auto-compact` 命名空间，重启不丢
- 🧊 **与内置安全网并存**：DSH 自带的 `compaction-basic`（默认 80% 压力阈值）保留为兜底，互不干扰

## 安装

**前置**：已装好 DSH（`dsh web` 能正常运行），Node.js ≥ 20、pnpm ≥ 10。

### 一键安装（推荐，复制粘贴即可）

**macOS / Linux**（Windows 装 Git Bash 或 WSL 也可）：

```bash
curl -fsSL https://raw.githubusercontent.com/JohnathonYe/auto-compact/main/scripts/install.sh | bash
```

脚本自动完成全部步骤：安装 npm 依赖 → 注册官方挂载（`dsh.profile.bundles`）→ 清理旧版残留的挂载行。你只需要：

1. 跑上面这一条命令
2. **重启 DSH**（装完后脚本会提示命令；也可以加上 `--restart` 让它自动重启：`curl ... | bash -s --restart`）
3. 强刷浏览器（macOS `Cmd+Shift+R` / Windows·Linux `Ctrl+Shift+R`），输入区右侧出现阈值圆环 ✅

> 脚本内部已自动处理：`dsh` 命令通常不在全局 PATH（DSH 一般经 npx 安装，直接敲 `dsh` 会报 command not found），脚本会自动改用 npx 调用，无需用户手动处理。

### 或者用

```bash
npx -y --package @deepseek-ai/dsh dsh plugin --profile web add auto-compact
```

装完同样需要重启 DSH + 强刷浏览器。

### 更新 / 卸载

- **更新**：重跑一键安装命令（或手动命令），装完重启 DSH + 强刷浏览器
- **卸载**：`npx -y --package @deepseek-ai/dsh dsh plugin --profile web remove auto-compact`，卸载后重启生效；若曾手动在 `cordis.patch.yml` 写过挂载行，一并删除，避免双挂载（两个 Host 半、两个圆环）

## 使用

1. 点击输入区右侧的圆环，打开面板
2. 面板显示当前会话的实时上下文用量（百分比）
3. 拖动滑杆设置阈值（1%–90%，会话级独立；**未拖动过的新会话默认 50%**，仅当前会话生效，不影响其他会话）
4. 之后每当用量超过阈值（回合中某一步之前，或回合结束时），插件自动执行 compact 并继续

## 工作原理

- **Host 半**（`lib/index.js`）：监听 `agent/pre-step`（回合中每步之前，waterfall 中间件）与 `agent/turn-stopping`（回合结束，串行事件）两个事件，读取当前会话阈值与用量（`tokenMeter.measure()` / `contextPressure` 投影），超阈值时调用 `agentPresets.serviceFor(agent, 'compaction').compactIfNeeded(agent, 'context-overflow', signal)` 执行压缩 —— 走 context-overflow 分支，绕过引擎自身的 0.8 阈值检查，完全由滑杆决定。
- **Client 半**（`lib/client.js`）：在 `conversation.input.right` 槽注册圆环 UI；阈值经自定义 webServer 路由 `/auto-compact/api`（host 侧直写 settings 服务，绕过 DSH `api.settings` 的官方命名空间白名单）读写（`auto-compact.thresholds[sessionId]`）；用量来自 `useProjection("contextPressure")` 实时投影。

## 依赖

- 需要 DSH 的 `compaction-basic`（`@deepseek-ai/dsh-compaction-basic`）处于启用状态 —— 默认预设（standard / code / cordis）均已内置，`minimal` 预设除外
- 所有 peer 依赖随 DSH 自带，无需额外安装

## 许可证

MIT

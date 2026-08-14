# auto-compact

**会话级自动上下文压缩插件**（DeepSeek Harness / DSH）

在输入区右侧显示一个阈值圆环：当前会话上下文用量实时显示，拖动滑杆设置该会话的压缩阈值（1%–90%，**默认 50%**）。每当一个回合结束时，若用量超过阈值，插件自动触发上下文压缩（compact），压缩摘要注入上下文后会话自然继续 —— 全程无需手动干预，也不发送任何「继续」消息。

## 特性

- 🔴 **会话级阈值**：每个会话独立设置，互不影响（按 `sessionId` 持久化）
- 📊 **实时用量**：与自带 ContextMeter 同源（`useProjection("contextPressure")`），面板打开即实时刷新，无需轮询
- 🎚️ **1%–90% 细腻调节**：步进 1%，适合精细控制（**未设置时默认 50%**）
- 🤖 **全自动**：回合结束自动检测 → 超阈值自动 compact → 摘要注入后自然继续
- 🛡️ **零崩溃风险**：所有检查都在 `agent/turn-stopping` 串行事件里做，全程 try/catch，绝不抛出
- 💾 **持久化**：阈值存于 `settings.yaml` 的 `auto-compact` 命名空间，重启不丢
- 🧊 **与内置安全网并存**：DSH 自带的 `compaction-basic`（默认 80% 压力阈值）保留为兜底，互不干扰

## 安装

### 推荐：一键脚本（装完刷新页面就能用，**无需重启**）

```bash
bash scripts/install.sh
```

脚本自动完成两步：安装 npm 依赖 → 把挂载行写进 `cordis.patch.yml`。DSH 对 patch 文件有 **HMR 热监听**，写入立即生效。

### 或手动两步（同样热生效，不用重启）

```bash
cd ~/.dsh/profiles/web
pnpm add auto-compact
```

然后在 `cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: auto-compact
      name: auto-compact
```

### 装完只需一步：强刷浏览器

浏览器强刷页面（macOS `Cmd+Shift+R` / Windows·Linux `Ctrl+Shift+R`），输入区右侧即出现阈值圆环 ✅

> 强刷很重要：插件 Client 半随页面加载注入，普通刷新可能命中缓存导致圆环不出现。

### 备选：官方 bundle 通道（需要重启 DSH）

```bash
dsh plugin --profile web add auto-compact
```

该通道把插件加进 profile 的 `dsh.profile.bundles` 层，但 manifest 不热监听，装完需要重启 DSH 进程才生效。

> 卸载：`pnpm remove auto-compact`（热挂载方式）或 `dsh plugin --profile web remove auto-compact`（bundle 方式），并删除挂载行。切换安装方式前先删掉旧的挂载行/依赖，避免双挂载（两个 Host 半、两个圆环）。

## 使用

1. 点击输入区右侧的圆环，打开面板
2. 面板显示当前会话的实时上下文用量（百分比）
3. 拖动滑杆设置阈值（1%–90%，会话级独立；**未拖动过的新会话默认 50%**，仅当前会话生效，不影响其他会话）
4. 之后每当回合结束时用量超过阈值，插件自动执行 compact 并继续

## 工作原理

- **Host 半**（`lib/index.js`）：监听 `agent/turn-stopping` 事件（回合结束），读取当前会话阈值与用量（`tokenMeter.measure()` / `contextPressure` 投影），超阈值时调用 `agentPresets.serviceFor(agent, 'compaction').compactIfNeeded(agent, 'context-overflow', signal)` 执行压缩 —— 走 context-overflow 分支，绕过引擎自身的 0.8 阈值检查，完全由滑杆决定。
- **Client 半**（`lib/client.js`）：在 `conversation.input.right` 槽注册圆环 UI；阈值经 `api.settings` 读写（`auto-compact.thresholds[sessionId]`）；用量来自 `useProjection("contextPressure")` 实时投影。

## 依赖

- 需要 DSH 的 `compaction-basic`（`@deepseek-ai/dsh-compaction-basic`）处于启用状态 —— 默认预设（standard / code / cordis）均已内置，`minimal` 预设除外
- 所有 peer 依赖随 DSH 自带，无需额外安装

## 许可证

MIT

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

### 推荐：官方插件命令（一条命令，无需手动编辑任何文件）

```bash
dsh plugin --profile web add auto-compact
```

该命令会自动：安装依赖 → 识别包的 `dsh.bundle` 声明 → 把 `auto-compact` 加入 profile 的 `dsh.profile.bundles` 层 → 重启/热加载后插件生效。卸载同理：`dsh plugin --profile web remove auto-compact`。

> profile 名字不是 `web` 时（例如自定义 profile），把 `--profile web` 换成你的 profile 名。

### 备选：手动安装（旧方式）

```bash
cd ~/.dsh/profiles/web
pnpm add auto-compact
```

然后在 `cordis.patch.yml` 中追加插件行：

```yaml
- insert:
    - id: auto-compact
      name: auto-compact
```

> ⚠️ 如果你以前用手动行安装过，改用推荐方式前**务必先删除 `cordis.patch.yml` 里的手动行**，否则会双挂载（两个 Host 半、两个圆环）。

**安装完成后必须强刷浏览器**（macOS `Cmd+Shift+R` / Windows·Linux `Ctrl+Shift+R`）：插件 Client 半随页面加载注入，普通刷新可能命中缓存导致圆环不出现。强刷后输入区右侧即出现阈值圆环。

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

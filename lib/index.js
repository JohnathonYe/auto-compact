// Auto Compact Threshold — host half (formal public plugin)
// 会话级自动压缩：回合结束检查用量，超过会话阈值时自动 compact。
// 阈值通过 settings 命名空间 auto-compact 持久化（client 用 api.settings 读写）。
import z from '@deepseek-ai/schemastery'

export const name = 'auto-compact'
export const inject = ['settings', 'agents', 'agentPresets', 'tokenMeter', 'sessionProjections', 'timer']

export function apply(ctx) {
  const DEFAULT_RATIO = 0.5
  const disposers = []
  const log = (...args) => console.log('[ac]', ...args)
  const logErr = (...args) => console.error('[ac]', ...args)

  // ---- 1. settings 命名空间（schemastery schema） ----
  try {
    const schema = z.object({ thresholds: z.dict(z.number()) })
    const off = ctx.settings.register('auto-compact', schema, { base: { thresholds: {} } })
    if (typeof off === 'function') disposers.push(off)
  } catch (error) {
    logErr('settings register failed', error && error.message ? error.message : String(error))
  }

  // ---- 2. 阈值 / 用量读取 ----
  const readRatio = (sessionId) => {
    try {
      const resolved = ctx.settings.get('auto-compact')
      const thresholds = resolved && resolved.thresholds ? resolved.thresholds : {}
      if (sessionId && typeof thresholds[sessionId] === 'number') return thresholds[sessionId]
    } catch (e) { /* ignore */ }
    return DEFAULT_RATIO
  }
  const contextWindowOf = (session) => {
    try {
      const snap = ctx.sessionProjections.snapshot(session)
      const cp = snap && snap.values ? snap.values.contextPressure : null
      if (cp && typeof cp.contextWindow === 'number' && cp.contextWindow > 0) return cp.contextWindow
    } catch (e) { /* ignore */ }
    return null
  }
  const measureUsage = (session) => {
    try {
      const m = ctx.tokenMeter.measure(session)
      const window = contextWindowOf(session)
      return { total: m.totalTokens, window, percent: window && window > 0 ? m.totalTokens / window : null }
    } catch (e) { return null }
  }

  // ---- 3. 压缩检查（压缩摘要注入上下文，回合自然结束，不发送继续消息） ----
  const maybeCompact = async (agent, signal) => {
    if (!agent || !agent.session) return
    const session = agent.session
    const sessionId = session.id
    const ratio = readRatio(sessionId)
    if (!(ratio > 0) || ratio >= 1) return
    if (!signal || signal.aborted) return
    const engine = ctx.agentPresets.serviceFor(agent, 'compaction')
    if (!engine || typeof engine.compactIfNeeded !== 'function') return
    const usage = measureUsage(session)
    if (!usage || !usage.window || !usage.percent) return
    log(`check ${sessionId}: ratio=${ratio} percent=${Math.round(usage.percent * 100)}% total=${usage.total} window=${usage.window}`)
    if (usage.percent <= ratio) return
    try {
      const result = await engine.compactIfNeeded(agent, 'context-overflow', signal)
      log(`compact ${sessionId}: ${result ? `ok summarySeq=${result.summarySeq} shadowed=${result.shadowedRange.start}-${result.shadowedRange.end}` : 'no-op'}`)
    } catch (error) {
      logErr(`compact ${sessionId} error:`, error && error.message ? error.message : String(error))
    }
  }

  // ---- 4. 挂接所有 agent ----
  const hooked = new Set()
  const hookAgent = (agent) => {
    if (!agent || !agent.ctx || hooked.has(agent)) return
    hooked.add(agent)
    try {
      const off = agent.ctx.on('agent/turn-stopping', (payload) => {
        const signal = payload && payload.signal
        log(`turn-stopping: ${agent.id}`)
        try {
          return maybeCompact(agent, signal)
        } catch (error) {
          logErr('listener error', error && error.message ? error.message : String(error))
        }
      })
      disposers.push(off)
      log(`hooked: ${agent.id}`)
    } catch (error) {
      logErr('hook failed', agent.id, error && error.message ? error.message : String(error))
    }
  }
  const scan = () => {
    try {
      for (const agent of ctx.agents.list()) hookAgent(agent)
    } catch (e) { /* ignore */ }
  }

  // ---- 5. 初始扫描 + 定时补挂 ----
  scan()
  try {
    disposers.push(ctx.timer.interval(scan, 3000))
  } catch (e) { /* ignore */ }

  // ---- 6. 清理 ----
  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try { dispose() } catch (e) { /* ignore */ }
    }
    disposers.length = 0
    hooked.clear()
  })
}

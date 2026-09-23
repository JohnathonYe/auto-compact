// Auto Compact Threshold — host half (formal public plugin)
// 会话级自动压缩：回合中每步之前 + 回合结束都检查用量，超过会话阈值时自动 compact。
//
// 阈值持久化：DSH 0.1.7-alpha.2 移除了 ctx.settings 的 register/get 命名空间 API
// （settings.yaml 也一并移除），这里改用插件自己的 JSON 文件，路径与 DSH 的 home
// 解析一致（$DSH_HOME 或 ~/.dsh）。client 仍走自定义 webServer 路由读写，前端契约不变。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-auto-compact'
// webServer 必须声明在 inject 里：0.1.7 起 apply 在未声明依赖就绪前就会运行，
// 用 ctx.get('webServer') 会拿到 undefined，路由会静默地不注册。
export const inject = ['webServer', 'agents', 'agentPresets', 'tokenMeter', 'sessionProjections', 'timer']

const DEFAULT_RATIO = 0.5

/** Parse a persisted store document, keeping only sane ratios in (0, 1]. */
export function readThresholds(raw) {
  const out = {}
  let parsed
  try { parsed = JSON.parse(raw) } catch (error) { return out }
  const source = parsed && typeof parsed === 'object' && parsed.thresholds && typeof parsed.thresholds === 'object'
    ? parsed.thresholds
    : {}
  for (const key of Object.keys(source)) {
    const value = Number(source[key])
    if (Number.isFinite(value) && value > 0 && value <= 1) out[key] = value
  }
  return out
}

/** DSH home resolution: $DSH_HOME when set, otherwise ~/.dsh. */
function resolveStorePath() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return join(configured !== '' ? configured : join(homedir(), '.dsh'), 'dsh-auto-compact.json')
}

export function apply(ctx) {
  const log = (...args) => console.log('[ac]', ...args)
  const logErr = (...args) => console.error('[ac]', ...args)

  const disposers = []

  // ---- 1. 阈值存储（插件自己的 JSON 文件，跨重启持久） ----
  const storeFile = resolveStorePath()
  let thresholds = {}
  try {
    thresholds = readThresholds(readFileSync(storeFile, 'utf8'))
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      logErr('threshold store load failed', error && error.message ? error.message : String(error))
    }
  }

  const persist = () => {
    try {
      mkdirSync(dirname(storeFile), { recursive: true })
      const tmp = storeFile + '.tmp-' + process.pid
      writeFileSync(tmp, JSON.stringify({ thresholds }, null, 2) + '\n', { mode: 0o600 })
      renameSync(tmp, storeFile)
      return true
    } catch (error) {
      logErr('threshold store write failed', error && error.message ? error.message : String(error))
      return false
    }
  }

  // ---- 2. client 配置通道：自定义 webServer 路由 ----
  // DSH 的 api.settings 只对官方硬编码白名单开放，第三方插件的 namespace 无法
  // 通过它读写；这里注册自己的 HTTP 路由，host 侧直接读写上面的阈值存储。
  const webServer = ctx.webServer ?? ctx.get('webServer')
  if (webServer && typeof webServer.register === 'function') {
    try {
      const isTrusted = (request) => {
        try {
          const host = request.headers && request.headers.host
          if (typeof host !== 'string' || host === '') return false
          const hostUrl = new URL('http://' + host)
          const hostname = hostUrl.hostname
          const loopback = hostname === 'localhost' || hostname === '[::1]' ||
            (hostname.split('.').length === 4 && hostname.split('.')[0] === '127' &&
              hostname.split('.').every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255))
          if (!loopback) return false
          if (request.headers['sec-fetch-site'] === 'cross-site') return false
          const origin = request.headers.origin
          if (origin === undefined) return true
          return new URL(origin).host === hostUrl.host
        } catch (e) { return false }
      }
      const readBody = (req) => new Promise((resolve, reject) => {
        let data = ''
        req.setEncoding('utf8')
        req.on('data', (chunk) => { data += chunk; if (data.length > 65536) { reject(new Error('body too large')); req.destroy() } })
        req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) } })
        req.on('error', reject)
      })
      const writeJson = (res, status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(obj))
      }
      const off = webServer.register({
        kind: 'prefix',
        path: '/dsh-auto-compact/api',
        handler: async (req, res) => {
          if (!isTrusted(req)) return writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
          if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
          let method = ''
          try { method = new URL(req.url || '/', 'http://dsh.internal').pathname.slice('/dsh-auto-compact/api/'.length) } catch (e) { method = '' }
          if (!method || method.includes('/')) return writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method' } })
          try {
            if (method === 'thresholds.get') {
              return writeJson(res, 200, { ok: true, value: thresholds })
            }
            if (method === 'thresholds.set') {
              const payload = await readBody(req)
              const sessionId = payload && typeof payload.sessionId === 'string' ? payload.sessionId : ''
              const ratio = Number(payload && payload.ratio)
              if (!sessionId || !(ratio > 0 && ratio <= 1)) return writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid sessionId or ratio' } })
              thresholds = Object.assign({}, thresholds, { [sessionId]: ratio })
              if (!persist()) return writeJson(res, 500, { ok: false, error: { code: 'rejected', message: 'failed to persist thresholds' } })
              return writeJson(res, 200, { ok: true, value: thresholds })
            }
            return writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown method' } })
          } catch (error) {
            return writeJson(res, 500, { ok: false, error: { code: 'rejected', message: error && error.message ? error.message : String(error) } })
          }
        }
      })
      if (typeof off === 'function') disposers.push(off)
      log('web route registered /dsh-auto-compact/api')
    } catch (error) {
      logErr('web route register failed', error && error.message ? error.message : String(error))
    }
  } else {
    logErr('webServer service unavailable; threshold API disabled')
  }

  // ---- 3. 阈值 / 用量读取 ----
  const readRatio = (sessionId) => {
    const value = sessionId ? thresholds[sessionId] : undefined
    return typeof value === 'number' ? value : DEFAULT_RATIO
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

  // ---- 4. 压缩检查（压缩摘要注入上下文，回合自然结束，不发送继续消息） ----
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
    log('check ' + sessionId + ': ratio=' + ratio + ' percent=' + Math.round(usage.percent * 100) + '% total=' + usage.total + ' window=' + usage.window)
    if (usage.percent <= ratio) return
    try {
      const result = await engine.compactIfNeeded(agent, 'context-overflow', signal)
      log('compact ' + sessionId + ': ' + (result ? 'ok summarySeq=' + result.summarySeq + ' shadowed=' + result.shadowedRange.start + '-' + result.shadowedRange.end : 'no-op'))
    } catch (error) {
      logErr('compact ' + sessionId + ' error:', error && error.message ? error.message : String(error))
    }
  }

  // ---- 5. 回合中途：每步之前也检查（waterfall 前置压缩，压完继续这一步） ----
  try {
    const offPre = ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      if (!signal || signal.aborted) return next()
      try {
        await maybeCompact(agent, signal)
      } catch (error) {
        logErr('pre-step check error', error && error.message ? error.message : String(error))
      }
      return next()
    })
    if (typeof offPre === 'function') disposers.push(offPre)
    log('pre-step hook registered')
  } catch (error) {
    logErr('pre-step hook failed', error && error.message ? error.message : String(error))
  }

  // ---- 6. 挂接所有 agent ----
  const hooked = new Set()
  const hookAgent = (agent) => {
    if (!agent || !agent.ctx || hooked.has(agent)) return
    hooked.add(agent)
    try {
      const off = agent.ctx.on('agent/turn-stopping', (payload) => {
        const signal = payload && payload.signal
        log('turn-stopping: ' + agent.id)
        try {
          return maybeCompact(agent, signal)
        } catch (error) {
          logErr('listener error', error && error.message ? error.message : String(error))
        }
      })
      disposers.push(off)
      log('hooked: ' + agent.id)
    } catch (error) {
      logErr('hook failed', agent.id, error && error.message ? error.message : String(error))
    }
  }
  const scan = () => {
    try {
      for (const agent of ctx.agents.list()) hookAgent(agent)
    } catch (e) { /* ignore */ }
  }

  // ---- 7. 初始扫描 + 定时补挂 ----
  scan()
  try {
    disposers.push(ctx.timer.interval(scan, 3000))
  } catch (e) { /* ignore */ }

  // ---- 8. 清理 ----
  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try { dispose() } catch (e) { /* ignore */ }
    }
    disposers.length = 0
    hooked.clear()
  })
}

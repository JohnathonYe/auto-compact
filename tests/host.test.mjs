import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply, inject, readThresholds } from '../lib/index.js'

function memoryReq(body, options = {}) {
  const stream = new Readable({ read() {} })
  stream.push(body === undefined ? '' : body)
  stream.push(null)
  stream.method = options.method ?? 'POST'
  stream.url = options.url ?? '/dsh-auto-compact/api/thresholds.get'
  stream.headers = options.headers ?? { host: '127.0.0.1:3080' }
  return stream
}

function memoryRes() {
  const out = { status: 0, body: '' }
  return {
    out,
    writeHead(status) { out.status = status },
    end(body) { out.body = body === undefined ? '' : String(body) },
  }
}

async function callRoute(route, body, options) {
  const res = memoryRes()
  await route.handler(memoryReq(body, options), res)
  return { status: res.out.status, json: res.out.body === '' ? null : JSON.parse(res.out.body) }
}

function fakeContext(routes) {
  return {
    webServer: { register(route) { routes.push(route); return () => {} } },
    on: () => () => {},
    agents: { list: () => [] },
    timer: { interval: () => () => {} },
    effect: (fn) => { fn(); return () => {} },
    get: () => undefined,
    sessionProjections: { snapshot: () => null },
    tokenMeter: { measure: () => ({ totalTokens: 0 }) },
    agentPresets: { serviceFor: () => null },
  }
}

test('inject declares webServer so the route actually mounts', () => {
  assert.ok(inject.includes('webServer'), 'webServer must be injected on 0.1.7')
  assert.ok(!inject.includes('settings'), 'the removed settings namespace API must not be required')
})

test('readThresholds keeps only ratios in (0, 1]', () => {
  assert.deepEqual(readThresholds('{"thresholds":{"a":0.4,"b":2,"c":"x","d":1,"e":0}}'), { a: 0.4, d: 1 })
  assert.deepEqual(readThresholds('not json'), {})
  assert.deepEqual(readThresholds('{"thresholds":null}'), {})
})

test('the custom route registers and persists thresholds to the DSH home', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-test-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const routes = []
    apply(fakeContext(routes))
    assert.equal(routes.length, 1)
    const [route] = routes
    assert.equal(route.kind, 'prefix')
    assert.equal(route.path, '/dsh-auto-compact/api')

    const set = await callRoute(route, JSON.stringify({ sessionId: 's1', ratio: 0.7 }), { url: '/dsh-auto-compact/api/thresholds.set' })
    assert.equal(set.status, 200)

    const get = await callRoute(route, JSON.stringify({}), { url: '/dsh-auto-compact/api/thresholds.get' })
    assert.equal(get.status, 200)
    assert.deepEqual(get.json.value, { s1: 0.7 })

    assert.deepEqual(JSON.parse(readFileSync(join(home, 'dsh-auto-compact.json'), 'utf8')).thresholds, { s1: 0.7 })

    const bad = await callRoute(route, JSON.stringify({ sessionId: 's1', ratio: 9 }), { url: '/dsh-auto-compact/api/thresholds.set' })
    assert.equal(bad.status, 400)

    const denied = await callRoute(route, '{}', { headers: { host: 'evil.example.com' } })
    assert.equal(denied.status, 403)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('a fresh process reads back the persisted store', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-test-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const first = []
    apply(fakeContext(first))
    await callRoute(first[0], JSON.stringify({ sessionId: 's2', ratio: 0.35 }), { url: '/dsh-auto-compact/api/thresholds.set' })
    const second = []
    apply(fakeContext(second))
    const get = await callRoute(second[0], '{}', { url: '/dsh-auto-compact/api/thresholds.get' })
    assert.deepEqual(get.json.value, { s2: 0.35 })
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

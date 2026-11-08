const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const Module = require('node:module')
const path = require('node:path')

const { WORKFLOWS } = require('../cloudfunctions/ipcamp-api/lib/catalog')
const { validatePayload } = require('../cloudfunctions/ipcamp-api/lib/compliance')
const { limits, dayKey, assertCapacity } = require('../cloudfunctions/ipcamp-api/lib/hy-budget')
const { TokenhubHyProvider, buildHyRequest, normalizeHyTask, requestTokenhub } = require('../cloudfunctions/ipcamp-api/lib/providers/tokenhub-hy')
const { assertImageData, assertVideoData } = require('../cloudfunctions/ipcamp-api/lib/hy-media')

const textInput = {
  workflowId: 'hy-text-video', topic: '一只小狗在草地上奔跑',
  images: [], sourceType: 'self-owned', authorized: true, aiDisclosure: true,
  ratio: '9:16', resolution: '720p', duration: 5, requestId: 'req-1'
}

test('Hy 文生/图生参数固定5秒720p，图生不透传比例且保留AI标识', () => {
  const text = buildHyRequest({ mode: 'text2video', prompt: '小狗奔跑', images: [], aspectRatio: '9:16' })
  assert.deepEqual(text, { model: 'hy-video-v1.5', prompt: '小狗奔跑', aspect_ratio: '9:16', duration: 5, resolution: '720p', n: 1, footnote: 'AI生成' })
  const image = buildHyRequest({ mode: 'img2video', prompt: '自然转头', images: ['https://media.example/a.png'] })
  assert.equal(image.image_url, 'https://media.example/a.png')
  assert.equal(Object.hasOwn(image, 'aspect_ratio'), false)
  assert.throws(() => buildHyRequest({ mode: 'img2video', prompt: '动起来', images: ['https://a.example/1.png', 'https://a.example/2.png'] }), /一张/)
  assert.throws(() => buildHyRequest({ mode: 'img2video', prompt: '动起来', images: ['https://a.example/1.png'], aspectRatio: '1:1' }), /不能指定/)
})

test('Hy 工作流校验与旧可灵工作流并存', () => {
  const text = validatePayload(textInput, WORKFLOWS['hy-text-video'])
  assert.equal(text.duration, 5)
  assert.equal(text.resolution, '720p')
  const image = validatePayload({ ...textInput, workflowId: 'hy-image-video', images: ['cloud://env/a'], ratio: undefined }, WORKFLOWS['hy-image-video'])
  assert.equal(image.images.length, 1)
  assert.equal(image.ratio, undefined)
  assert.throws(() => validatePayload({ ...textInput, images: ['cloud://env/a'] }, WORKFLOWS['hy-text-video']), /图片数量/)
  assert.throws(() => validatePayload({ ...textInput, workflowId: 'hy-image-video', images: ['cloud://env/a'] }, WORKFLOWS['hy-image-video']), /不能指定比例/)
  assert.throws(() => validatePayload({ ...textInput, duration: 10 }, WORKFLOWS['hy-text-video']), /固定为 5 秒/)
  assert.equal(WORKFLOWS['viral-film'].provider, undefined)
  assert.equal(WORKFLOWS['viral-film'].tokenCost, 89)
})

test('TokenHub Provider 使用顶层 task_id 和四种异步状态', async () => {
  const calls = []
  const provider = new TokenhubHyProvider({ apiKey: 'test-only', request: async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? { task_id: 'hy_123', request_id: 'req' } : { task_id: 'hy_123', status: 'succeeded', videos: [{ url: 'https://media.example/video.mp4' }] }
  } })
  const created = await provider.create({ mode: 'text2video', prompt: '小狗奔跑', images: [], aspectRatio: '16:9' })
  assert.equal(created.providerTaskId, 'hy_123')
  assert.match(calls[0].url, /\/v1\/wand\/hunyuan-video\/generation$/)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only')
  const completed = await provider.query('hy_123')
  assert.equal(completed.outputUrl, 'https://media.example/video.mp4')
  assert.match(calls[1].url, /\/v1\/wand\/hunyuan-video\/tasks\/hy_123$/)
  assert.equal(normalizeHyTask({ status: 'queued' }).status, 'queued')
  assert.equal(normalizeHyTask({ status: 'running' }).status, 'processing')
  assert.equal(normalizeHyTask({ status: 'failed', error: { message: 'secret' } }).status, 'failed')
  assert.throws(() => normalizeHyTask({ status: 'succeeded', videos: [] }), /未返回视频/)
  for (const status of [401, 503]) {
    const rejecting = new TokenhubHyProvider({ apiKey: 'test-only', request: async () => {
      const error = new Error('request failed')
      error.status = status
      throw error
    } })
    await assert.rejects(rejecting.create({ mode: 'text2video', prompt: '小狗奔跑', images: [], aspectRatio: '16:9' }), (error) => {
      assert.equal(error.submissionUncertain === true, status === 503)
      return true
    })
  }
})

function transport(status, body) {
  return {
    request(url, options, onResponse) {
      const req = new EventEmitter()
      req.write = () => {}
      req.end = () => {
        const res = new PassThrough()
        res.statusCode = status
        res.setEncoding('utf8')
        onResponse(res)
        res.end(JSON.stringify(body))
      }
      req.destroy = (error) => req.emit('error', error)
      return req
    }
  }
}

test('TokenHub 401、403、429 与 5xx 错误不泄露 Key', async () => {
  for (const [status, message] of [[401, /API Key/], [403, /权限/], [429, /额度/], [503, /暂时不可用/]]) {
    await assert.rejects(requestTokenhub('https://tokenhub.tencentmaas.com/x', { headers: { Authorization: 'Bearer secret' } }, transport(status, { error: { code: 'X', message: 'secret' } })), (error) => {
      assert.match(error.message, message)
      assert.doesNotMatch(error.message, /secret/)
      assert.equal(error.status, status)
      return true
    })
  }
})

test('Hy 图片/视频验证实际文件头', () => {
  assertImageData({ buffer: Buffer.from('ffd8ff00', 'hex'), contentType: 'image/jpeg' })
  assertImageData({ buffer: Buffer.from('89504e470d0a1a0a', 'hex'), contentType: 'image/png' })
  assert.throws(() => assertImageData({ buffer: Buffer.from('bad'), contentType: 'image/png' }), /JPG 或 PNG/)
  assertVideoData({ buffer: Buffer.from('00000018667479706d703432', 'hex'), contentType: 'video/mp4' })
  assert.throws(() => assertVideoData({ buffer: Buffer.from('not a video'), contentType: 'video/mp4' }), /MP4/)
})

test('北京时间预算、全站并发与单账户并发均受限', () => {
  assert.equal(dayKey(Date.UTC(2026, 10, 7, 16, 0, 0)), '2026-11-08')
  assert.deepEqual(limits({}), { daily: 20, active: 3, perUserActive: 1 })
  assert.deepEqual(limits({ TOKENHUB_DAILY_TASK_LIMIT: '200', TOKENHUB_MAX_ACTIVE_TASKS: '8' }), { daily: 20, active: 3, perUserActive: 1 })
  assert.throws(() => assertCapacity({ submitted: 20, active: 0 }, { hyActive: 0 }), /预算/)
  assert.throws(() => assertCapacity({ submitted: 1, active: 3 }, { hyActive: 0 }), /排队已满/)
  assert.throws(() => assertCapacity({ submitted: 1, active: 1 }, { hyActive: 1 }), /当前混元视频任务/)
})

function fakeCloud() {
  const collections = new Map()
  let currentOpenId = 'u1'
  let initOptions
  const command = { inc: (amount) => ({ __inc: amount }) }
  let chain = Promise.resolve()
  const bucket = (name) => {
    if (!collections.has(name)) collections.set(name, new Map())
    const rows = collections.get(name)
    return {
      doc(id) {
        return {
          async get() {
            if (!rows.has(id)) throw new Error('document does not exist')
            return { data: structuredClone(rows.get(id)) }
          },
          async set({ data }) { rows.set(id, structuredClone(data)) },
          async update({ data }) {
            if (!rows.has(id)) throw new Error('document does not exist')
            const row = rows.get(id)
            for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && Object.hasOwn(value, '__inc')
              ? Number(row[key] || 0) + value.__inc : structuredClone(value)
          }
        }
      },
      where(filter) {
        let ordering = null
        let max = Infinity
        const query = {
          orderBy(field, direction) { ordering = { field, direction }; return query },
          limit(value) { max = value; return query },
          async get() {
            let found = [...rows.values()].filter((row) => Object.entries(filter).every(([key, value]) => row[key] === value))
            if (ordering) found.sort((a, b) => ordering.direction === 'desc' ? b[ordering.field] - a[ordering.field] : a[ordering.field] - b[ordering.field])
            return { data: structuredClone(found.slice(0, max)) }
          }
        }
        return query
      }
    }
  }
  const db = {
    command,
    collection: bucket,
    async createCollection(name) { bucket(name) },
    async runTransaction(fn) {
      const previous = chain
      let unlock
      chain = new Promise((resolve) => { unlock = resolve })
      await previous
      try { return await fn({ collection: bucket }) } finally { unlock() }
    }
  }
  return {
    cloud: {
      DYNAMIC_CURRENT_ENV: 'test', init(value) { initOptions = value }, database: () => db,
      getWXContext: () => ({ OPENID: currentOpenId }),
      async getTempFileURL({ fileList }) { return { fileList: fileList.map((fileID) => ({ fileID, status: 0, tempFileURL: `https://cloud.example/${encodeURIComponent(fileID)}` })) } }
    }, collections, db, setOpenId: (value) => { currentOpenId = value }, getInitOptions: () => initOptions
  }
}

function serviceHarness(providerFor, options = {}) {
  const { cloud, collections, db, setOpenId, getInitOptions } = fakeCloud()
  const apiPath = path.resolve(__dirname, '../cloudfunctions/ipcamp-api/index.js')
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    if (parent && parent.filename === apiPath && request === './lib/providers') return { createProvider: providerFor }
    if (parent && parent.filename === apiPath && request === './lib/hy-media') {
      return { inspectHyImage: async () => {}, persistHyVideo: options.persist || (async () => 'cloud://env/output.mp4') }
    }
    return originalLoad.apply(this, arguments)
  }
  delete require.cache[apiPath]
  let api
  try { api = require(apiPath) } finally { Module._load = originalLoad }
  db.collection('users')
  collections.get('users').set('u1', { registeredAt: 1, nickname: 'test', balance: 500, hyActive: 0 })
  process.env.WORKER_TOKEN = 'worker-test'
  const call = async (action, data) => api.main({ action, data })
  return { api, call, collections, db, setOpenId, getInitOptions }
}

test('任务创建幂等、单账户并发、成功转存并同步作品', async () => {
  let created = 0
  const selected = []
  const h = serviceHarness((name) => {
    selected.push(name)
    return {
      async create() { created += 1; return { providerTaskId: 'hy_1', rawState: 'queued', model: 'hy-video-v1.5' } },
      async query() { return { status: 'succeeded', outputUrl: 'https://video.example/temp.mp4' } }
    }
  })
  assert.equal(h.getInitOptions().timeout, 150000)
  const [one, duplicate] = await Promise.all([h.call('task.create', textInput), h.call('task.create', textInput)])
  assert.equal(one.ok, true)
  assert.equal(duplicate.ok, true)
  assert.equal(created, 1)
  assert.equal(h.collections.get('users').get('u1').balance, 411)
  assert.equal(h.collections.get('users').get('u1').hyActive, 1)
  const busy = await h.call('task.create', { ...textInput, requestId: 'req-2' })
  assert.equal(busy.ok, false)
  assert.match(busy.message, /等待当前/)
  const result = await h.call('worker.sync', { workerToken: 'worker-test' })
  assert.equal(result.data.succeeded, 1)
  const work = await h.call('task.get', { id: one.data.id })
  assert.equal(work.data.status, 'succeeded')
  assert.equal(work.data.outputFileId, 'cloud://env/output.mp4')
  assert.match(work.data.outputUrl, /^https:\/\/cloud\.example/)
  assert.equal(work.data.creationInput.topic, textInput.topic)
  assert.equal(h.collections.get('users').get('u1').hyActive, 0)
  assert.deepEqual(selected, ['tokenhub-hy', 'tokenhub-hy'])
})

test('Hy 失败只退款一次，历史任务仍按原 Provider 查询', async () => {
  const selected = []
  const h = serviceHarness((name) => {
    selected.push(name)
    return name === 'tokenhub-hy'
      ? { async create() { return { providerTaskId: 'hy_failed' } }, async query() { return { status: 'failed', errorMessage: '模型生成失败' } } }
      : { async query() { return { status: 'succeeded', outputUrl: 'https://legacy.example/result.mp4' } } }
  })
  const created = await h.call('task.create', textInput)
  assert.equal(created.ok, true)
  h.collections.get('tasks').set('old-task', { id: 'old-task', ownerOpenId: 'u1', provider: 'kling-direct', providerTaskId: 'old-1', status: 'processing', progress: 20, createdAt: 1 })
  const first = await h.call('worker.sync', { workerToken: 'worker-test' })
  assert.equal(first.data.failed, 1)
  assert.equal(first.data.succeeded, 1)
  assert.equal(h.collections.get('users').get('u1').balance, 500)
  assert.equal(h.collections.get('token_ledger').has(`${created.data.id}_refund`), true)
  const second = await h.call('worker.sync', { workerToken: 'worker-test' })
  assert.equal(second.data.failed, 0)
  assert.equal(h.collections.get('users').get('u1').balance, 500)
  assert.equal(h.collections.get('tasks').get('old-task').outputUrl, 'https://legacy.example/result.mp4')
  assert.ok(selected.includes('kling-direct'))
})

test('明确的 401 创建拒绝退款，重复 requestId 不再次 POST', async () => {
  let calls = 0
  const h = serviceHarness(() => ({ async create() { calls += 1; const error = new Error('Key 无效'); error.status = 401; throw error } }))
  const first = await h.call('task.create', textInput)
  assert.equal(first.ok, false)
  assert.match(first.message, /已退回/)
  assert.equal(h.collections.get('users').get('u1').balance, 500)
  const repeat = await h.call('task.create', textInput)
  assert.equal(repeat.ok, true)
  assert.equal(repeat.data.status, 'failed')
  assert.equal(calls, 1)
})

test('POST 超时或 503 保留扣点并进入人工核对，不自动重发', async () => {
  for (const errorValue of ['timeout', '503']) {
    let calls = 0
    const h = serviceHarness(() => ({ async create() {
      calls += 1
      const error = new Error(errorValue)
      error.submissionUncertain = true
      throw error
    } }))
    const first = await h.call('task.create', textInput)
    assert.equal(first.ok, true)
    assert.equal(first.data.status, 'submission_unknown')
    assert.equal(h.collections.get('users').get('u1').balance, 411)
    assert.equal(h.collections.get('users').get('u1').hyActive, 1)
    const repeat = await h.call('task.create', textInput)
    assert.equal(repeat.data.status, 'submission_unknown')
    assert.equal(calls, 1)
    const worker = await h.call('worker.sync', { workerToken: 'worker-test' })
    assert.equal(worker.data.checked, 0)
  }
})

test('超过30分钟的 Hy 任务由 worker 退款并释放并发位', async () => {
  let queryCount = 0
  const h = serviceHarness(() => ({
    async create() { return { providerTaskId: 'hy_old' } },
    async query() { queryCount += 1; return { status: 'running' } }
  }))
  const created = await h.call('task.create', textInput)
  assert.equal(created.ok, true)
  h.collections.get('tasks').get(created.data.id).createdAt = Date.now() - 31 * 60 * 1000
  const synced = await h.call('worker.sync', { workerToken: 'worker-test' })
  assert.equal(synced.data.failed, 1)
  assert.equal(queryCount, 1)
  assert.equal(h.collections.get('users').get('u1').balance, 500)
  assert.equal(h.collections.get('users').get('u1').hyActive, 0)
})

test('跨北京时间零点的旧任务仍占全站并发位', async () => {
  const originalNow = Date.now
  let simulatedNow = Date.UTC(2026, 10, 8, 15, 59)
  Date.now = () => simulatedNow
  try {
    let sequence = 0
    const h = serviceHarness(() => ({ async create() { sequence += 1; return { providerTaskId: `hy_${sequence}` } } }))
    for (const id of ['u1', 'u2', 'u3']) {
      h.db.collection('users')
      h.collections.get('users').set(id, { registeredAt: 1, balance: 500, hyActive: 0 })
      h.setOpenId(id)
      assert.equal((await h.call('task.create', { ...textInput, requestId: `request-${id}` })).ok, true)
    }
    assert.equal(h.collections.get('hy_video_budget').get('tokenhub-hy_global').active, 3)
    simulatedNow += 2 * 60 * 1000
    h.collections.get('users').set('u4', { registeredAt: 1, balance: 500, hyActive: 0 })
    h.setOpenId('u4')
    const nextDay = await h.call('task.create', { ...textInput, requestId: 'request-u4' })
    assert.equal(nextDay.ok, false)
    assert.match(nextDay.message, /排队已满/)
    assert.equal(h.collections.get('hy_video_budget').get('tokenhub-hy_global').active, 3)
  } finally { Date.now = originalNow }
})

test('转存失败保持任务与扣点，worker 再次轮询后写入作品', async () => {
  let attempts = 0
  const h = serviceHarness(() => ({
    async create() { return { providerTaskId: 'hy_retry' } },
    async query() { return { status: 'succeeded', outputUrl: 'https://video.example/temp.mp4' } }
  }), { persist: async () => {
    attempts += 1
    if (attempts === 1) throw new Error('媒体下载超时')
    return 'cloud://env/retried.mp4'
  } })
  const created = await h.call('task.create', textInput)
  const first = await h.call('worker.sync', { workerToken: 'worker-test' })
  assert.equal(first.data.succeeded, 0)
  assert.equal(h.collections.get('tasks').get(created.data.id).status, 'queued')
  assert.equal(h.collections.get('users').get('u1').balance, 411)
  const second = await h.call('worker.sync', { workerToken: 'worker-test' })
  assert.equal(second.data.succeeded, 1)
  assert.equal(attempts, 2)
  assert.equal(h.collections.get('tasks').get(created.data.id).outputFileId, 'cloud://env/retried.mp4')
  assert.equal(h.collections.get('users').get('u1').balance, 411)
})

test('待核对任务仅 WORKER_TOKEN 可人工关联或一次性退款', async () => {
  let sequence = 0
  const h = serviceHarness(() => ({
    async create() { sequence += 1; const error = new Error('network timeout'); error.submissionUncertain = true; throw error },
    async query() { return { status: 'succeeded', outputUrl: 'https://video.example/temp.mp4' } }
  }))
  const created = await h.call('task.create', textInput)
  const rejected = await h.call('worker.resolveUnknown', { taskId: created.data.id, decision: 'refund', confirmation: 'MANUAL_REFUND_CONFIRMED', workerToken: 'wrong' })
  assert.equal(rejected.ok, false)
  const attached = await h.call('worker.resolveUnknown', { taskId: created.data.id, decision: 'attach', providerTaskId: 'hy_manual', workerToken: 'worker-test' })
  assert.deepEqual(attached.data, { id: created.data.id, status: 'queued' })
  assert.equal((await h.call('worker.sync', { workerToken: 'worker-test' })).data.succeeded, 1)
  const second = await h.call('task.create', { ...textInput, requestId: 'req-2' })
  assert.equal(second.data.status, 'submission_unknown')
  const refund = await h.call('worker.resolveUnknown', { taskId: second.data.id, decision: 'refund', confirmation: 'MANUAL_REFUND_CONFIRMED', workerToken: 'worker-test' })
  assert.equal(refund.data.status, 'failed')
  const repeated = await h.call('worker.resolveUnknown', { taskId: second.data.id, decision: 'refund', confirmation: 'MANUAL_REFUND_CONFIRMED', workerToken: 'worker-test' })
  assert.equal(repeated.data.status, 'failed')
  assert.equal(h.collections.get('users').get('u1').balance, 411)
  assert.equal(sequence, 2)
})

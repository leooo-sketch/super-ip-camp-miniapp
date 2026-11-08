const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const projectRoot = path.join(__dirname, '..')
const { getWorkflowById } = require('../miniprogram/data/workflows')
const { validateCreation } = require('../miniprogram/utils/validator')
const hyVideo = require('../miniprogram/utils/hy-video')

function loadPage(relativePath, modules, wx) {
  let definition
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
  vm.runInNewContext(source, {
    Page(value) { definition = value },
    require(name) {
      if (!(name in modules)) throw new Error(`unexpected require: ${name}`)
      return modules[name]
    },
    wx,
    setTimeout,
    setInterval: () => 1,
    clearInterval: () => {}
  }, { filename: relativePath })
  const instance = { ...definition, data: structuredClone(definition.data) }
  instance.setData = function (changes) {
    for (const [key, value] of Object.entries(changes)) {
      const parts = key.split('.')
      let target = this.data
      for (const part of parts.slice(0, -1)) target = target[part]
      target[parts.at(-1)] = value
    }
  }
  return instance
}

function createPageHarness(overrides = {}) {
  const calls = []
  const wx = {
    setNavigationBarTitle() {},
    showLoading() {},
    hideLoading() {},
    showToast() {},
    redirectTo(options) { calls.push(['redirect', options.url]) },
    switchTab() {},
    showModal() {},
    getStorageSync() { return null },
    removeStorageSync() {},
    chooseMedia: async () => ({ tempFiles: [] }),
    ...overrides.wx
  }
  const page = loadPage('miniprogram/pages/create/index.js', {
    '../../data/workflows': { getWorkflowById },
    '../../utils/validator': { validateCreation },
    '../../utils/hy-video': hyVideo,
    '../../utils/api': {
      ensureRegistered: async () => ({}),
      uploadMedia: async (filePath) => ({ fileId: `cloud://uploaded/${filePath}`, tempPath: filePath }),
      createTask: overrides.createTask || (async (payload) => {
        calls.push(['create', payload])
        return { id: 'task-new' }
      })
    }
  }, wx)
  return { page, calls }
}

test('Hy 文生视频仅提交提示词和比例，固定 5 秒 720p，旧可灵参数保持原状', async () => {
  const { page, calls } = createPageHarness()
  page.onLoad({ workflowId: 'hy-text-video' })
  assert.equal(page.data.showImageUpload, false)
  assert.equal(page.data.showRatio, true)
  assert.equal(page.data.showResolution, false)
  assert.equal(page.data.ratioOptions.length, 5)
  page.setData({ 'form.topic': '清晨的山间云海，镜头缓慢推进', 'form.authorized': true, ratioIndex: 1 })
  await page.submit()
  const hy = calls.find((entry) => entry[0] === 'create')[1]
  assert.equal(hy.workflowId, 'hy-text-video')
  assert.equal(hy.ratio, '16:9')
  assert.equal(hy.duration, 5)
  assert.equal(hy.resolution, '720p')
  assert.deepEqual(Array.from(hy.images), [])
  assert.equal('platform' in hy, false)
  assert.equal('video' in hy, false)
  assert.match(calls.find((entry) => entry[0] === 'redirect')[1], /task-new/)

  const old = createPageHarness()
  old.page.onLoad({ workflowId: 'viral-film' })
  old.page.setData({ 'form.topic': '记录训练第30天', 'form.authorized': true, images: [{ fileId: 'cloud://old.jpg' }] })
  await old.page.submit()
  const kling = old.calls.find((entry) => entry[0] === 'create')[1]
  assert.equal(kling.workflowId, 'viral-film')
  assert.equal(kling.duration, 10)
  assert.equal(kling.resolution, '720p')
  assert.equal(kling.ratio, '9:16')
  assert.equal(kling.platform, '小红书')
})

test('Hy 图生视频只能传一图，不提交画面比例，且兼容无扩展名临时路径', async () => {
  const { page, calls } = createPageHarness({
    wx: { chooseMedia: async () => ({ tempFiles: [{ tempFilePath: 'wxfile://tmp/abc123', size: 1024 }] }) }
  })
  page.onLoad({ workflowId: 'hy-image-video' })
  assert.equal(page.data.showRatio, false)
  assert.equal(page.data.showImageUpload, true)
  assert.equal(page.data.workflow.maxImages, 1)
  await page.chooseImages()
  page.setData({ 'form.topic': '画面中的主体缓慢转头', 'form.authorized': true })
  await page.submit()
  const payload = calls.find((entry) => entry[0] === 'create')[1]
  assert.equal(payload.images.length, 1)
  assert.equal('ratio' in payload, false)
  assert.equal(payload.duration, 5)
  assert.equal(payload.resolution, '720p')
  assert.match(validateCreation({ ...payload, ratio: '9:16' }, getWorkflowById('hy-image-video')), /比例/)
  assert.match(validateCreation({ ...payload, images: ['a', 'b'] }, getWorkflowById('hy-image-video')), /一张/)
})

test('网络不确定时重复点击复用请求编号，输入改变后生成新编号', async () => {
  const ids = []
  const { page } = createPageHarness({
    createTask: async (payload) => { ids.push(payload.requestId); throw new Error('网络连接中断') }
  })
  page.onLoad({ workflowId: 'hy-text-video' })
  page.setData({ 'form.topic': '雨后街道的灯光', 'form.authorized': true })
  await page.submit()
  await page.submit()
  page.setData({ 'form.topic': '海边的日出' })
  await page.submit()
  assert.equal(ids.length, 3)
  assert.equal(ids[0], ids[1])
  assert.notEqual(ids[1], ids[2])
})

test('Hy 任务从自有云存储保存并以原提示词再次创作，重新确认图片授权', async () => {
  const events = []
  let retryDraft = null
  const task = {
    id: 'owned-task', workflowId: 'hy-image-video', workflowTitle: '混元图生视频',
    topic: '让花朵随风摆动', status: 'succeeded', progress: 100,
    outputUrl: 'https://example.test/preview.mp4', outputFileId: 'cloud://own-video.mp4',
    creationInput: { topic: '让花朵随风摆动' }, createdAt: Date.now()
  }
  const page = loadPage('miniprogram/pages/task/index.js', {
    '../../utils/api': { getTask: async () => task, ensureRegistered: async () => ({}) },
    '../../utils/format': { formatDate: () => '今天' },
    '../../utils/hy-video': hyVideo
  }, {
    showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
    cloud: { downloadFile: async ({ fileID }) => { events.push(['download', fileID]); return { tempFilePath: 'wxfile://own-video.mp4' } } },
    saveVideoToPhotosAlbum: async ({ filePath }) => { events.push(['save', filePath]) },
    setStorageSync: (key, value) => { if (key === 'ipcamp_hy_retry_draft') retryDraft = value },
    navigateTo: ({ url }) => events.push(['navigate', url])
  })
  page.setData({ taskId: task.id })
  await page.refresh()
  assert.equal(page.data.isHyTask, true)
  await page.saveVideo()
  page.createAgain()
  assert.deepEqual(events.slice(0, 2), [
    ['download', 'cloud://own-video.mp4'],
    ['save', 'wxfile://own-video.mp4']
  ])
  assert.match(events[2][1], /workflowId=hy-image-video/)
  assert.match(events[2][1], /retry=1/)
  const next = createPageHarness({ wx: {
    getStorageSync: () => retryDraft,
    removeStorageSync: () => { retryDraft = null }
  } })
  next.page.onLoad({ workflowId: 'hy-image-video', retry: '1' })
  assert.equal(next.page.data.form.topic, '让花朵随风摆动')
  assert.equal(next.page.data.images.length, 0)
  assert.equal(next.page.data.form.authorized, false)
})

test('页面提供固定规格、相册保存及再次创作的入口', () => {
  const create = fs.readFileSync(path.join(projectRoot, 'miniprogram/pages/create/index.wxml'), 'utf8')
  const task = fs.readFileSync(path.join(projectRoot, 'miniprogram/pages/task/index.wxml'), 'utf8')
  assert.match(create, /固定生成 5 秒 · 720p/)
  assert.match(create, /wx:if="\{\{showRatio\}\}"/)
  assert.match(create, /wx:if="\{\{showImageUpload\}\}"/)
  assert.match(task, /bindtap="saveVideo"/)
  assert.match(task, /bindtap="createAgain"/)
})

test('提交状态待核对时显示明确警示、停止自动轮询并禁止再次生成', async () => {
  const events = []
  const unknown = {
    id: 'unknown-task', workflowId: 'hy-text-video', workflowTitle: '混元文生视频',
    topic: '山间云海', status: 'submission_unknown', progress: 12,
    errorMessage: '提交结果待人工核对', createdAt: Date.now(), tokenCost: 89
  }
  const page = loadPage('miniprogram/pages/task/index.js', {
    '../../utils/api': { getTask: async () => unknown, ensureRegistered: async () => ({}) },
    '../../utils/format': { formatDate: () => '今天' },
    '../../utils/hy-video': hyVideo
  }, { navigateTo: ({ url }) => events.push(url) })
  page.setData({ taskId: unknown.id })
  page.poller = 1
  await page.refresh()
  assert.equal(page.data.statusText, '提交待核对')
  assert.equal(page.poller, null)
  page.createAgain()
  assert.equal(events.length, 0)

  const taskMarkup = fs.readFileSync(path.join(projectRoot, 'miniprogram/pages/task/index.wxml'), 'utf8')
  const worksMarkup = fs.readFileSync(path.join(projectRoot, 'miniprogram/pages/works/index.wxml'), 'utf8')
  assert.match(taskMarkup, /请勿重复创建或重新生成，联系管理员/)
  assert.match(worksMarkup, /请勿重提 · 联系管理员核查/)
})

test('作品页把待核对任务单独筛选，不误列为生成中或失败', async () => {
  const tasks = [
    { id: 'pending', status: 'processing', createdAt: Date.now() },
    { id: 'unknown', status: 'submission_unknown', createdAt: Date.now() },
    { id: 'failed', status: 'failed', createdAt: Date.now() }
  ]
  const page = loadPage('miniprogram/pages/works/index.js', {
    '../../utils/api': { bootstrap: async () => ({ registered: true }), listTasks: async () => tasks },
    '../../utils/format': { formatDate: () => '今天' }
  }, { showToast() {} })
  await page.loadTasks()
  assert.equal(page.data.tasks.find((item) => item.id === 'unknown').statusText, '提交待核对')
  page.selectFilter({ currentTarget: { dataset: { id: 'submission_unknown' } } })
  assert.deepEqual(Array.from(page.data.visibleTasks, (item) => item.id), ['unknown'])
  page.selectFilter({ currentTarget: { dataset: { id: 'processing' } } })
  assert.deepEqual(Array.from(page.data.visibleTasks, (item) => item.id), ['pending'])
})

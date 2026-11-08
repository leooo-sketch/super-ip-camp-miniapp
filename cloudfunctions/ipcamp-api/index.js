const crypto = require('crypto')
const cloud = require('wx-server-sdk')
const { WORKFLOWS, PACKAGES } = require('./lib/catalog')
const { validatePayload } = require('./lib/compliance')
const { buildDirectorPrompt } = require('./lib/prompt')
const { createProvider } = require('./lib/providers')
const { dayKey, limits, assertCapacity } = require('./lib/hy-budget')
const { inspectHyImage, persistHyVideo } = require('./lib/hy-media')
const { QUESTIONS, QUESTION_MAP } = require('./lib/questions')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 150000 })
const db = cloud.database()
const command = db.command
const CORE_COLLECTIONS = ['users', 'token_ledger', 'tasks', 'orders', 'game_rooms', 'hy_video_budget']
let coreCollectionsReady = null

function isCollectionAlreadyExists(error) {
  const detail = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`
  return /exist|already|collection.*创建过|集合.*存在/i.test(detail)
}

async function ensureCoreCollections() {
  if (coreCollectionsReady) return coreCollectionsReady
  coreCollectionsReady = Promise.all(CORE_COLLECTIONS.map((name) =>
    db.createCollection(name).catch((error) => {
      if (isCollectionAlreadyExists(error)) return null
      throw error
    })
  )).catch((error) => {
    coreCollectionsReady = null
    throw error
  })
  return coreCollectionsReady
}

async function ensureGameRoomsCollection() {
  return ensureCoreCollections()
}

function publicUser(user) {
  return {
    nickname: user.nickname || 'IP主理人',
    avatarUrl: user.avatarUrl || '',
    balance: Number(user.balance || 0),
    plan: user.plan || '基础版',
    loginMethod: user.loginMethod || 'wechat',
    phoneMasked: user.phoneLast4 ? `********${user.phoneLast4}` : '',
    registered: Boolean(user.registeredAt),
    demoMode: false
  }
}

function publicTask(task) {
  const { ownerOpenId, providerTaskId, providerTraceId, providerPollTraceId, requestId, payload,
    hyBudgetId, hySlotReleasedAt, providerCreateStartedAt, syncLeaseId, syncLeaseUntil, lastPollError, ...safeTask } = task
  if (task.provider === 'tokenhub-hy') {
    safeTask.creationInput = {
      topic: task.topic,
      ...(task.workflowId === 'hy-text-video' ? { ratio: task.payload && task.payload.ratio } : {})
    }
  }
  return safeTask
}

async function publicOwnedTask(task) {
  const result = publicTask(task)
  if (!task.outputFileId) return result
  try {
    const files = await cloud.getTempFileURL({ fileList: [task.outputFileId] })
    const first = files && files.fileList && files.fileList[0]
    result.outputUrl = first && Number(first.status) === 0 ? first.tempFileURL : ''
  } catch (error) {
    result.outputUrl = ''
  }
  return result
}

function isMissingDocumentError(error) {
  const detail = `${error && error.code ? error.code : ''} ${error && error.message ? error.message : ''}`
  return /not[ _-]?found|does not exist|document.*不存在|文档.*不存在|-502005/i.test(detail)
}

async function getUser(openid) {
  const ref = db.collection('users').doc(openid)
  try {
    const result = await ref.get()
    return result.data
  } catch (error) {
    if (isMissingDocumentError(error)) return null
    throw error
  }
}

async function ensureRegistered(openid) {
  const user = await getUser(openid)
  if (!user || !user.registeredAt) throw new Error('请先登录后使用')
  return user
}

function safeNickname(value) {
  const nickname = String(value || '').trim().replace(/[<>]/g, '').slice(0, 20)
  if (!nickname) throw new Error('请填写有效昵称')
  return nickname
}

function optionalNickname(value, fallback) {
  const nickname = String(value || '').trim().replace(/[<>]/g, '').slice(0, 20)
  return nickname || fallback || '微信用户'
}

function normalizePhoneResult(result) {
  const payload = result && (result.phoneInfo || result.phone_info || (result.result && (result.result.phoneInfo || result.result.phone_info)))
  if (!payload) throw new Error('手机号授权信息读取失败，请重新授权')
  const phoneNumber = String(payload.purePhoneNumber || payload.pure_phone_number || payload.phoneNumber || payload.phone_number || '').replace(/\D/g, '')
  if (phoneNumber.length < 7 || phoneNumber.length > 20) throw new Error('手机号授权信息无效，请重新授权')
  return {
    phoneHash: crypto.createHash('sha256').update(phoneNumber).digest('hex'),
    phoneLast4: phoneNumber.slice(-4),
    countryCode: String(payload.countryCode || payload.country_code || '86').replace(/\D/g, '').slice(0, 6)
  }
}

async function registerAccount(openid, input) {
  const now = Date.now()
  const nickname = optionalNickname(input.nickname, '微信用户')
  const avatarUrl = /^cloud:\/\//.test(String(input.avatarUrl || '')) ? String(input.avatarUrl) : ''
  const existing = await getUser(openid)
  if (existing && existing.registeredAt) {
    await db.collection('users').doc(openid).update({ data: { nickname, avatarUrl: avatarUrl || existing.avatarUrl || '', loginMethod: existing.loginMethod || 'wechat', updatedAt: now } })
    return { registered: true, welcomeGranted: false, profile: publicUser({ ...existing, nickname, avatarUrl: avatarUrl || existing.avatarUrl || '', loginMethod: existing.loginMethod || 'wechat' }) }
  }
  if (existing) {
    const updated = { ...existing, nickname, avatarUrl, loginMethod: 'wechat', registeredAt: now, welcomeGrantedAt: now, updatedAt: now }
    await db.collection('users').doc(openid).update({ data: {
      nickname,
      avatarUrl,
      loginMethod: 'wechat',
      registeredAt: now,
      welcomeGrantedAt: now,
      updatedAt: now
    } })
    return { registered: true, welcomeGranted: false, profile: publicUser(updated) }
  }

  const welcomeTokens = Math.max(0, Number(process.env.WELCOME_TOKENS || 500))
  const user = {
    nickname,
    avatarUrl,
    balance: welcomeTokens,
    plan: '基础版',
    loginMethod: 'wechat',
    registeredAt: now,
    welcomeGrantedAt: now,
    createdAt: now,
    updatedAt: now
  }
  await db.runTransaction(async (transaction) => {
    await transaction.collection('users').doc(openid).set({ data: user })
    await transaction.collection('token_ledger').doc(`${openid}_welcome`).set({ data: {
      ownerOpenId: openid,
      type: 'welcome_bonus',
      amount: welcomeTokens,
      createdAt: now
    } })
  })
  return { registered: true, welcomeGranted: welcomeTokens > 0, profile: publicUser(user) }
}

async function registerWithPhone(openid, input) {
  const code = String(input.code || '').trim()
  if (!code || code.length > 256) throw new Error('请重新授权手机号')
  const response = await cloud.openapi.phonenumber.getPhoneNumber({ code })
  const phone = normalizePhoneResult(response)
  const now = Date.now()
  const existing = await getUser(openid)
  const nickname = optionalNickname(input.nickname, existing && existing.nickname)
  const avatarUrl = /^cloud:\/\//.test(String(input.avatarUrl || '')) ? String(input.avatarUrl) : (existing && existing.avatarUrl) || ''

  if (existing && existing.registeredAt) {
    const updated = { ...existing, ...phone, nickname, avatarUrl, loginMethod: 'phone', updatedAt: now }
    await db.collection('users').doc(openid).update({ data: { ...phone, nickname, avatarUrl, loginMethod: 'phone', updatedAt: now } })
    return { registered: true, welcomeGranted: false, profile: publicUser(updated) }
  }

  const welcomeTokens = Math.max(0, Number(process.env.WELCOME_TOKENS || 500))
  const user = {
    ...(existing || {}),
    ...phone,
    nickname,
    avatarUrl,
    balance: existing ? Number(existing.balance || 0) : welcomeTokens,
    plan: (existing && existing.plan) || '基础版',
    loginMethod: 'phone',
    registeredAt: now,
    welcomeGrantedAt: now,
    createdAt: (existing && existing.createdAt) || now,
    updatedAt: now
  }
  await db.runTransaction(async (transaction) => {
    const userRef = transaction.collection('users').doc(openid)
    if (existing) await userRef.update({ data: {
      ...phone,
      nickname,
      avatarUrl,
      balance: user.balance,
      plan: user.plan,
      loginMethod: 'phone',
      registeredAt: now,
      welcomeGrantedAt: now,
      updatedAt: now
    } })
    else await userRef.set({ data: user })
    if (!existing && welcomeTokens > 0) {
      await transaction.collection('token_ledger').doc(`${openid}_welcome`).set({ data: {
        ownerOpenId: openid,
        type: 'welcome_bonus',
        amount: welcomeTokens,
        createdAt: now
      } })
    }
  })
  return { registered: true, welcomeGranted: !existing && welcomeTokens > 0, profile: publicUser(user) }
}

async function resolveMedia(fileIds) {
  const values = (Array.isArray(fileIds) ? fileIds : [fileIds]).filter(Boolean)
  const cloudIds = values.filter((value) => String(value).startsWith('cloud://'))
  const urlsById = {}
  if (cloudIds.length) {
    const result = await cloud.getTempFileURL({ fileList: cloudIds })
    for (const item of result.fileList || []) {
      if (item.status !== 0 || !item.tempFileURL) throw new Error('素材临时地址生成失败')
      urlsById[item.fileID] = item.tempFileURL
    }
  }
  return values.map((value) => urlsById[value] || value)
}

function makeTaskId(openid, requestId) {
  return crypto.createHash('sha256').update(`${openid}:${requestId}`).digest('hex').slice(0, 32)
}

async function reserveTask(openid, workflow, payload) {
  const taskId = makeTaskId(openid, payload.requestId)
  return db.runTransaction(async (transaction) => {
    const taskRef = transaction.collection('tasks').doc(taskId)
    try {
      const existing = await taskRef.get()
      if (existing.data.workflowId !== workflow.id) throw new Error('请求编号已用于其他工作流')
      return { task: existing.data, existing: true }
    } catch (error) {
      if (!isMissingDocumentError(error)) throw error
    }

    const userRef = transaction.collection('users').doc(openid)
    const userResult = await userRef.get()
    const user = userResult.data
    if (Number(user.balance || 0) < workflow.tokenCost) throw new Error('创作点余额不足')

    const now = Date.now()
    const hy = workflow.provider === 'tokenhub-hy'
    const hyBudgetId = hy ? `tokenhub-hy_${dayKey(now)}` : ''
    if (hy) {
      const budgetRef = transaction.collection('hy_video_budget').doc(hyBudgetId)
      const globalRef = transaction.collection('hy_video_budget').doc('tokenhub-hy_global')
      let budget = null
      let globalBudget = null
      try { budget = (await budgetRef.get()).data } catch (error) {
        if (!isMissingDocumentError(error)) throw error
      }
      try { globalBudget = (await globalRef.get()).data } catch (error) {
        if (!isMissingDocumentError(error)) throw error
      }
      assertCapacity({ submitted: budget && budget.submitted, active: globalBudget && globalBudget.active }, user, limits())
      const next = {
        provider: 'tokenhub-hy',
        day: dayKey(now),
        submitted: Number(budget && budget.submitted || 0) + 1,
        updatedAt: now
      }
      if (budget) await budgetRef.update({ data: next })
      else await budgetRef.set({ data: next })
      const globalNext = { provider: 'tokenhub-hy', active: Number(globalBudget && globalBudget.active || 0) + 1, updatedAt: now }
      if (globalBudget) await globalRef.update({ data: globalNext })
      else await globalRef.set({ data: globalNext })
    }
    const task = {
      id: taskId,
      ownerOpenId: openid,
      requestId: payload.requestId,
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      topic: payload.topic,
      status: 'queued',
      progress: 5,
      tokenCost: workflow.tokenCost,
      provider: workflow.provider || String(process.env.VIDEO_PROVIDER || 'kling-direct').toLowerCase(),
      providerTaskId: '',
      coverUrl: '',
      outputUrl: '',
      refundedAt: null,
      sourceType: payload.sourceType,
      aiDisclosure: true,
      payload,
      ...(hy ? { hyBudgetId, hySlotReleasedAt: null } : {}),
      createdAt: now,
      updatedAt: now
    }
    await userRef.update({ data: {
      balance: command.inc(-workflow.tokenCost),
      ...(hy ? { hyActive: Number(user.hyActive || 0) + 1 } : {}),
      updatedAt: now
    } })
    await taskRef.set({ data: task })
    await transaction.collection('token_ledger').doc(`${taskId}_debit`).set({ data: {
      ownerOpenId: openid,
      taskId,
      type: 'generation_debit',
      amount: -workflow.tokenCost,
      createdAt: now
    } })
    return { task, existing: false }
  })
}

async function releaseHySlot(transaction, task, now, userChanges = {}) {
  if (task.provider !== 'tokenhub-hy' || !task.hyBudgetId || task.hySlotReleasedAt) return false
  const budgetRef = transaction.collection('hy_video_budget').doc('tokenhub-hy_global')
  const budget = (await budgetRef.get()).data
  await budgetRef.update({ data: { active: Math.max(0, Number(budget.active || 0) - 1), updatedAt: now } })
  const userRef = transaction.collection('users').doc(task.ownerOpenId)
  const user = (await userRef.get()).data
  await userRef.update({ data: { ...userChanges, hyActive: Math.max(0, Number(user.hyActive || 0) - 1), updatedAt: now } })
  return true
}

async function refundTask(taskId, reason, leaseId = '') {
  return db.runTransaction(async (transaction) => {
    const taskRef = transaction.collection('tasks').doc(taskId)
    const taskResult = await taskRef.get()
    const task = taskResult.data
    if (leaseId && task.syncLeaseId !== leaseId) return task
    if (task.refundedAt || task.status === 'succeeded') return task
    const now = Date.now()
    const released = await releaseHySlot(transaction, task, now, { balance: command.inc(task.tokenCost) })
    if (!released) await transaction.collection('users').doc(task.ownerOpenId).update({
      data: { balance: command.inc(task.tokenCost), updatedAt: now }
    })
    await taskRef.update({ data: {
      status: 'failed',
      progress: 100,
      errorMessage: String(reason || '模型生成失败').slice(0, 300),
      refundedAt: now,
      syncLeaseId: '',
      syncLeaseUntil: 0,
      ...(task.provider === 'tokenhub-hy' ? { hySlotReleasedAt: now } : {}),
      updatedAt: now
    } })
    await transaction.collection('token_ledger').doc(`${taskId}_refund`).set({ data: {
      ownerOpenId: task.ownerOpenId,
      taskId,
      type: 'generation_refund',
      amount: task.tokenCost,
      reason: String(reason || 'generation_failed').slice(0, 200),
      createdAt: now
    } })
    return { ...task, status: 'failed', progress: 100, refundedAt: now }
  })
}

async function createTask(openid, input) {
  await ensureRegistered(openid)
  const workflow = WORKFLOWS[input.workflowId]
  if (!workflow) throw new Error('创作工作流不存在')
  if (workflow.enabled === false) throw new Error('该创作工作流正在适配，暂未开放')
  const payload = validatePayload(input, workflow)
  if (typeof payload.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.requestId)) throw new Error('缺少有效的请求编号')

  const reservation = await reserveTask(openid, workflow, payload)
  if (reservation.existing) return publicTask(reservation.task)

  let providerTask
  try {
    const images = await resolveMedia(payload.images)
    if (workflow.provider === 'tokenhub-hy' && images.length) await inspectHyImage(images[0])
    const videoList = payload.video ? await resolveMedia([payload.video]) : []
    const provider = createProvider(reservation.task.provider)
    if (workflow.provider === 'tokenhub-hy') {
      await db.collection('tasks').doc(reservation.task.id).update({ data: { providerCreateStartedAt: Date.now() } })
    }
    providerTask = await provider.create({
      workflowId: workflow.id,
      mode: workflow.providerMode,
      images,
      video: videoList[0],
      prompt: workflow.provider === 'tokenhub-hy' ? payload.topic : buildDirectorPrompt(payload),
      aspectRatio: payload.ratio,
      resolution: payload.resolution,
      duration: payload.duration,
      clientBusinessId: reservation.task.id,
      removeAudio: payload.removeAudio
    })
    if (!providerTask.providerTaskId) throw new Error('视频服务未返回任务编号')
  } catch (error) {
    if (workflow.provider === 'tokenhub-hy' && error.submissionUncertain) {
      const message = '提交结果待人工核对，请勿再次创建；联系运营人员核对 TokenHub 任务与账单'
      await db.collection('tasks').doc(reservation.task.id).update({ data: {
        status: 'submission_unknown', errorMessage: message, updatedAt: Date.now()
      } })
      return publicTask({ ...reservation.task, status: 'submission_unknown', errorMessage: message })
    }
    await refundTask(reservation.task.id, error.message)
    throw new Error(`创建失败，创作点已退回：${error.message}`)
  }
  try {
    await db.collection('tasks').doc(reservation.task.id).update({ data: {
      status: workflow.provider === 'tokenhub-hy' ? 'queued' : 'processing',
      progress: 12,
      providerTaskId: providerTask.providerTaskId,
      providerState: providerTask.rawState,
      providerModel: providerTask.model || '',
      providerTraceId: providerTask.traceId || '',
      updatedAt: Date.now()
    } })
    return publicTask({ ...reservation.task, status: workflow.provider === 'tokenhub-hy' ? 'queued' : 'processing', progress: 12 })
  } catch (error) {
    // The provider may already have accepted and billed this task. Never submit it twice.
    throw new Error('模型任务可能已提交，保存状态失败；请用原请求编号查询任务，不要重复创建')
  }
}

async function getOwnedTask(openid, id) {
  await ensureRegistered(openid)
  if (!id) throw new Error('缺少任务编号')
  const result = await db.collection('tasks').doc(id).get()
  if (!result.data || result.data.ownerOpenId !== openid) throw new Error('任务不存在')
  return publicOwnedTask(result.data)
}

async function listOwnedTasks(openid) {
  await ensureRegistered(openid)
  const result = await db.collection('tasks')
    .where({ ownerOpenId: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()
  return Promise.all(result.data.map(publicOwnedTask))
}

async function createOrder(openid, packageId) {
  const selected = PACKAGES[packageId]
  if (!selected) throw new Error('充值包不存在')
  await ensureRegistered(openid)
  const subMchId = String(process.env.WECHAT_PAY_SUB_MCH_ID || '').trim()
  const envId = String(process.env.PAY_ENV_ID || process.env.TCB_ENV || '').trim()
  if (!envId) throw new Error('未配置 PAY_ENV_ID 或 TCB_ENV')
  if (!subMchId) return { paymentConfigured: false, message: '微信支付商户号尚未绑定' }
  const orderId = `IP${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 32)
  await db.collection('orders').doc(orderId).set({ data: {
    ownerOpenId: openid,
    packageId: selected.id,
    tokens: selected.tokens,
    amountFen: selected.amountFen,
    status: 'pending_payment',
    createdAt: Date.now(),
    updatedAt: Date.now()
  } })
  try {
    const result = await cloud.cloudPay.unifiedOrder({
      body: `超级IP创造营-${selected.name}`,
      outTradeNo: orderId,
      spbillCreateIp: '127.0.0.1',
      subMchId,
      totalFee: selected.amountFen,
      envId,
      functionName: 'ipcamp-pay-callback'
    })
    if (!result || !result.payment) throw new Error('微信支付未返回支付参数')
    await db.collection('orders').doc(orderId).update({ data: { prepayCreatedAt: Date.now(), updatedAt: Date.now() } })
    return { orderId, paymentConfigured: true, paymentParams: result.payment }
  } catch (error) {
    await db.collection('orders').doc(orderId).update({ data: { status: 'payment_create_failed', errorMessage: String(error.message || error).slice(0, 200), updatedAt: Date.now() } })
    throw new Error(`微信支付暂时不可用：${error.message || '下单失败'}`)
  }
}

function paymentStatus() {
  return { configured: Boolean(String(process.env.WECHAT_PAY_SUB_MCH_ID || '').trim()) }
}

const PARTY_GAMES = {
  truth: {
    title: '真心话',
    prompts: ['最近一次让你笑出声的事情是什么？', '如果明天放假，你最想去哪里？', '你最想学会的一项技能是什么？', '你手机里最舍不得删的一张照片是什么？', '如果能和十年前的自己说一句话，你会说什么？']
  },
  spy: {
    title: '谁是卧底',
    pairs: [['牛奶', '豆浆'], ['口红', '唇膏'], ['火锅', '麻辣烫'], ['自行车', '电动车'], ['手机', '平板电脑']]
  },
  draw: {
    title: '你画我猜',
    prompts: ['长颈鹿', '宇航员', '火锅', '滑雪', '熊猫', '闹钟', '旋转木马', '自拍杆']
  },
  dice: {
    title: '骰子挑战',
    prompts: ['说一句绕口令', '模仿一种动物', '夸下一位玩家一句', '讲一个冷笑话', '做一个夸张表情', '指定下一位挑战者']
  },
  bomb: { title: '数字炸弹', prompts: [] }
}

function shuffle(values) {
  const result = values.slice()
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = crypto.randomInt(index + 1)
    const current = result[index]
    result[index] = result[target]
    result[target] = current
  }
  return result
}

function playerId(openid) {
  return crypto.createHash('sha256').update(openid).digest('hex').slice(0, 10)
}

function roomPlayer(openid, user) {
  return {
    openid,
    id: playerId(openid),
    nickname: user.nickname || '微信玩家',
    avatarUrl: user.avatarUrl || '',
    score: 0,
    correctCount: 0,
    answers: {},
    finished: false,
    joinedAt: Date.now()
  }
}

function publicRoom(room, openid) {
  const self = (room.players || []).find((item) => item.openid === openid) || {}
  const safe = {
    id: room.id,
    type: room.type,
    gameId: room.gameId || '',
    gameTitle: room.gameTitle || '',
    status: room.status,
    isOwner: room.ownerOpenId === openid,
    selfId: playerId(openid),
    createdAt: room.createdAt,
    players: (room.players || []).map((item) => ({
      id: item.id,
      nickname: item.nickname,
      avatarUrl: item.avatarUrl || '',
      score: Number(item.score || 0),
      correctCount: Number(item.correctCount || 0),
      answeredCount: Object.keys(item.answers || {}).length,
      finished: Boolean(item.finished)
    })),
    self: {
      id: self.id || playerId(openid),
      score: Number(self.score || 0),
      correctCount: Number(self.correctCount || 0),
      answeredCount: Object.keys(self.answers || {}).length,
      finished: Boolean(self.finished)
    }
  }
  if (room.type === 'quiz') {
    safe.questions = (room.questionIds || []).map((id, index) => {
      const question = QUESTION_MAP[id]
      return question ? { id, q: question.q, a: question.a, tag: question.tag, double: (room.doubleIndices || []).includes(index) } : null
    }).filter(Boolean)
  }
  if (room.type === 'party') {
    const round = room.partyRound || {}
    safe.party = {
      round: Number(room.round || 0),
      prompt: round.prompt || '等待主持人开始',
      activePlayerId: round.activePlayerId || '',
      activeNickname: round.activeNickname || '',
      rangeMin: round.rangeMin,
      rangeMax: round.rangeMax,
      exploded: Boolean(round.exploded)
    }
    safe.secret = round.secrets && round.secrets[openid] ? round.secrets[openid] : ''
  }
  return safe
}

async function getRoom(roomId) {
  if (!roomId) throw new Error('缺少房间号')
  try {
    const result = await db.collection('game_rooms').doc(String(roomId)).get()
    return result.data
  } catch (error) {
    throw new Error('房间不存在或已结束')
  }
}

function buildPartyRound(room, roundNumber) {
  const game = PARTY_GAMES[room.gameId]
  if (!game) throw new Error('聚会游戏不存在')
  const players = room.players || []
  const active = players[roundNumber % players.length]
  const result = { prompt: '', activePlayerId: active.id, activeNickname: active.nickname, secrets: {} }
  if (room.gameId === 'truth') {
    result.prompt = game.prompts[crypto.randomInt(game.prompts.length)]
  } else if (room.gameId === 'spy') {
    const pair = game.pairs[crypto.randomInt(game.pairs.length)]
    const spyIndex = crypto.randomInt(players.length)
    players.forEach((player, index) => { result.secrets[player.openid] = index === spyIndex ? pair[1] : pair[0] })
    result.prompt = '轮流描述你看到的词，不能直接说出答案；描述结束后一起投票。'
  } else if (room.gameId === 'draw') {
    const word = game.prompts[crypto.randomInt(game.prompts.length)]
    result.secrets[active.openid] = word
    result.prompt = `${active.nickname} 是本轮画手，其他人开始猜词。`
  } else if (room.gameId === 'dice') {
    const value = crypto.randomInt(6)
    result.prompt = `${active.nickname} 掷到 ${value + 1}：${game.prompts[value]}`
  } else if (room.gameId === 'bomb') {
    result.rangeMin = 1
    result.rangeMax = 50
    result.bombNumber = crypto.randomInt(1, 51)
    result.prompt = '数字炸弹已藏在 1—50 之间，大家轮流输入数字。'
  }
  return result
}

async function createGameRoom(openid, input) {
  const user = await ensureRegistered(openid)
  await ensureGameRoomsCollection()
  const type = input.type === 'party' ? 'party' : 'quiz'
  const gameId = type === 'party' ? String(input.gameId || '') : ''
  if (type === 'party' && !PARTY_GAMES[gameId]) throw new Error('请选择聚会游戏')
  const id = crypto.randomBytes(5).toString('hex').toUpperCase()
  const now = Date.now()
  const room = {
    id,
    type,
    gameId,
    gameTitle: type === 'party' ? PARTY_GAMES[gameId].title : '王者对决',
    ownerOpenId: openid,
    status: 'waiting',
    players: [roomPlayer(openid, user)],
    questionIds: type === 'quiz' ? shuffle(QUESTIONS.map((item) => item.id)).slice(0, 8) : [],
    doubleIndices: type === 'quiz' ? shuffle([0, 1, 2, 3, 4, 5, 6, 7]).slice(0, 2) : [],
    round: 0,
    partyRound: {},
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 6 * 60 * 60 * 1000
  }
  await db.collection('game_rooms').doc(id).set({ data: room })
  return publicRoom(room, openid)
}

async function joinGameRoom(openid, roomId) {
  const user = await ensureRegistered(openid)
  const room = await getRoom(roomId)
  if (room.status !== 'waiting' && !(room.players || []).some((item) => item.openid === openid)) throw new Error('本局已经开始')
  if ((room.players || []).some((item) => item.openid === openid)) return publicRoom(room, openid)
  if ((room.players || []).length >= 8) throw new Error('房间人数已满')
  room.players.push(roomPlayer(openid, user))
  room.updatedAt = Date.now()
  await db.collection('game_rooms').doc(room.id).update({ data: { players: room.players, updatedAt: room.updatedAt } })
  return publicRoom(room, openid)
}

async function readGameRoom(openid, roomId) {
  await ensureRegistered(openid)
  const room = await getRoom(roomId)
  if (!(room.players || []).some((item) => item.openid === openid)) throw new Error('请先加入房间')
  return publicRoom(room, openid)
}

async function startGameRoom(openid, roomId) {
  await ensureRegistered(openid)
  const room = await getRoom(roomId)
  if (room.ownerOpenId !== openid) throw new Error('只有房主可以开始')
  if (room.status !== 'waiting') return publicRoom(room, openid)
  if ((room.players || []).length < 2) throw new Error('至少邀请 1 位微信好友加入')
  room.status = 'playing'
  room.updatedAt = Date.now()
  if (room.type === 'party') room.partyRound = buildPartyRound(room, 0)
  await db.collection('game_rooms').doc(room.id).update({ data: {
    status: room.status,
    partyRound: room.partyRound,
    updatedAt: room.updatedAt
  } })
  return publicRoom(room, openid)
}

async function answerQuizRoom(openid, input) {
  await ensureRegistered(openid)
  const room = await getRoom(input.roomId)
  if (room.type !== 'quiz' || room.status !== 'playing') throw new Error('当前不在答题阶段')
  const index = Number(input.questionIndex)
  const selected = Number(input.selected)
  if (!Number.isInteger(index) || index < 0 || index >= 8) throw new Error('题号无效')
  const player = (room.players || []).find((item) => item.openid === openid)
  if (!player) throw new Error('你不在当前房间')
  player.answers = player.answers || {}
  if (player.answers[index] !== undefined) throw new Error('本题已经回答')
  if (Object.keys(player.answers).length !== index) throw new Error('请按顺序答题')
  const question = QUESTION_MAP[room.questionIds[index]]
  const correct = selected === question.c
  const awarded = correct ? ((room.doubleIndices || []).includes(index) ? 200 : 100) : 0
  player.answers[index] = selected
  player.score = Number(player.score || 0) + awarded
  player.correctCount = Number(player.correctCount || 0) + (correct ? 1 : 0)
  player.finished = index === 7
  if (room.players.every((item) => item.finished)) room.status = 'finished'
  room.updatedAt = Date.now()
  await db.collection('game_rooms').doc(room.id).update({ data: { players: room.players, status: room.status, updatedAt: room.updatedAt } })
  return { room: publicRoom(room, openid), correct, correctIndex: question.c, awarded }
}

async function nextPartyRound(openid, roomId) {
  await ensureRegistered(openid)
  const room = await getRoom(roomId)
  if (room.type !== 'party' || room.status !== 'playing') throw new Error('当前聚会房间未开始')
  if (room.ownerOpenId !== openid) throw new Error('只有房主可以切换下一轮')
  room.round = Number(room.round || 0) + 1
  room.partyRound = buildPartyRound(room, room.round)
  room.updatedAt = Date.now()
  await db.collection('game_rooms').doc(room.id).update({ data: { round: room.round, partyRound: room.partyRound, updatedAt: room.updatedAt } })
  return publicRoom(room, openid)
}

async function guessPartyNumber(openid, input) {
  await ensureRegistered(openid)
  const room = await getRoom(input.roomId)
  if (room.type !== 'party' || room.gameId !== 'bomb' || room.status !== 'playing') throw new Error('当前不是数字炸弹房间')
  if (!(room.players || []).some((item) => item.openid === openid)) throw new Error('你不在当前房间')
  const guess = Number(input.guess)
  const round = room.partyRound || {}
  if (!Number.isInteger(guess) || guess < round.rangeMin || guess > round.rangeMax) throw new Error(`请输入 ${round.rangeMin}—${round.rangeMax} 之间的整数`)
  const player = room.players.find((item) => item.openid === openid)
  if (guess === round.bombNumber) {
    round.exploded = true
    round.prompt = `${player.nickname} 猜中 ${guess}，炸弹爆了！房主可开启下一轮。`
  } else if (guess < round.bombNumber) {
    round.rangeMin = guess + 1
    round.prompt = `${player.nickname} 猜了 ${guess}，炸弹在更大的数字里。`
  } else {
    round.rangeMax = guess - 1
    round.prompt = `${player.nickname} 猜了 ${guess}，炸弹在更小的数字里。`
  }
  room.partyRound = round
  room.updatedAt = Date.now()
  await db.collection('game_rooms').doc(room.id).update({ data: { partyRound: round, updatedAt: room.updatedAt } })
  return publicRoom(room, openid)
}

async function deleteAccount(openid, confirmation) {
  if (confirmation !== 'DELETE') throw new Error('缺少账号删除确认')
  const user = await getUser(openid)
  if (user && Number(user.hyActive || 0) > 0) throw new Error('当前有混元视频任务待完成或待人工核对，请处理后再注销账户')

  const taskResult = await db.collection('tasks').where({ ownerOpenId: openid }).limit(100).get()
  const fileIds = []
  for (const task of taskResult.data || []) {
    if (task.provider === 'tokenhub-hy' && task.hyBudgetId && !task.hySlotReleasedAt) {
      await db.runTransaction(async (transaction) => {
        const ref = transaction.collection('tasks').doc(task.id)
        const fresh = (await ref.get()).data
        if (!fresh.hySlotReleasedAt) {
          const now = Date.now()
          await releaseHySlot(transaction, fresh, now)
          await ref.update({ data: { hySlotReleasedAt: now, status: 'deleted', syncLeaseId: '', syncLeaseUntil: 0 } })
        }
      })
    }
    if (String(task.outputFileId || '').startsWith('cloud://')) fileIds.push(task.outputFileId)
    const payload = task.payload || {}
    for (const value of [].concat(payload.images || [], payload.video || []).filter(Boolean)) {
      if (String(value).startsWith('cloud://')) fileIds.push(value)
    }
  }

  if (fileIds.length) {
    try {
      await cloud.deleteFile({ fileList: [...new Set(fileIds)] })
    } catch (error) {
      console.warn('删除用户素材失败，将继续删除账户记录', error.message)
    }
  }

  const orderResult = await db.collection('orders').where({ ownerOpenId: openid }).limit(100).get()
  const unpaidOrderIds = (orderResult.data || []).filter((order) => order.status !== 'paid').map((order) => order._id)
  await Promise.all([
    db.collection('tasks').where({ ownerOpenId: openid }).remove(),
    db.collection('token_ledger').where({ ownerOpenId: openid }).remove(),
    db.collection('game_rooms').where({ ownerOpenId: openid }).remove()
  ])
  await Promise.all(unpaidOrderIds.map((id) => db.collection('orders').doc(id).remove()))
  try {
    await db.collection('users').doc(openid).remove()
  } catch (error) {
    // Repeated deletion requests remain idempotent.
  }
  return { deleted: true }
}

const HY_TASK_TIMEOUT_MS = 30 * 60 * 1000
const SYNC_LEASE_MS = 4 * 60 * 1000
const WORKER_PROCESS_BUDGET_MS = 75 * 1000

async function claimTaskForSync(taskId) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('tasks').doc(taskId)
    const task = (await ref.get()).data
    const now = Date.now()
    if (!task || !['queued', 'processing', 'submission_unknown'].includes(task.status) || Number(task.syncLeaseUntil || 0) > now) return null
    const leaseId = crypto.randomBytes(12).toString('hex')
    await ref.update({ data: { syncLeaseId: leaseId, syncLeaseUntil: now + SYNC_LEASE_MS } })
    return { ...task, syncLeaseId: leaseId }
  })
}

async function updateClaimedTask(task, data) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('tasks').doc(task.id)
    const fresh = (await ref.get()).data
    if (!fresh || fresh.syncLeaseId !== task.syncLeaseId || !['queued', 'processing', 'submission_unknown'].includes(fresh.status)) return false
    await ref.update({ data: { ...data, syncLeaseId: '', syncLeaseUntil: 0, updatedAt: Date.now() } })
    return true
  })
}

async function completeClaimedTask(task, state, outputFileId = '') {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection('tasks').doc(task.id)
    const fresh = (await ref.get()).data
    if (!fresh || fresh.syncLeaseId !== task.syncLeaseId || !['queued', 'processing', 'submission_unknown'].includes(fresh.status)) return false
    const now = Date.now()
    await releaseHySlot(transaction, fresh, now)
    await ref.update({ data: {
      status: 'succeeded',
      progress: 100,
      outputUrl: outputFileId ? '' : String(state.outputUrl || ''),
      ...(outputFileId ? { outputFileId } : {}),
      coverUrl: state.coverUrl || '',
      providerPollTraceId: state.traceId || '',
      ...(fresh.provider === 'tokenhub-hy' ? { hySlotReleasedAt: now } : {}),
      syncLeaseId: '', syncLeaseUntil: 0, updatedAt: now
    } })
    return true
  })
}

async function recordPollError(task, error) {
  return updateClaimedTask(task, {
    lastPollError: String(error.message || error).slice(0, 300),
    pollFailures: command.inc(1)
  })
}

function assertWorkerToken(workerToken) {
  if (!process.env.WORKER_TOKEN || workerToken !== process.env.WORKER_TOKEN) throw new Error('无权执行任务同步')
}

async function resolveUnknownTask(input) {
  assertWorkerToken(input.workerToken)
  const taskId = String(input.taskId || '')
  if (!/^[a-f0-9]{32}$/.test(taskId)) throw new Error('无效的任务编号')
  if (input.decision === 'refund') {
    if (input.confirmation !== 'MANUAL_REFUND_CONFIRMED') throw new Error('缺少人工核对确认')
    const result = await db.collection('tasks').doc(taskId).get()
    const task = result.data
    if (task && task.provider === 'tokenhub-hy' && task.status === 'failed' && task.refundedAt) return { id: taskId, status: 'failed' }
    if (!task || task.provider !== 'tokenhub-hy' || task.status !== 'submission_unknown') throw new Error('任务不是待核对状态')
    const refunded = await refundTask(taskId, '运营人员核对后手动退回创作点')
    return { id: taskId, status: refunded.status }
  }
  if (input.decision === 'attach') {
    const providerTaskId = String(input.providerTaskId || '')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(providerTaskId)) throw new Error('无效的 TokenHub 任务编号')
    return db.runTransaction(async (transaction) => {
      const ref = transaction.collection('tasks').doc(taskId)
      const task = (await ref.get()).data
      if (task && task.provider === 'tokenhub-hy' && task.status === 'queued' && task.providerTaskId === providerTaskId) {
        return { id: taskId, status: 'queued' }
      }
      if (!task || task.provider !== 'tokenhub-hy' || task.status !== 'submission_unknown' || task.providerTaskId) {
        throw new Error('任务不是可关联的待核对状态')
      }
      await ref.update({ data: {
        providerTaskId, status: 'queued', progress: 12,
        errorMessage: '', updatedAt: Date.now()
      } })
      return { id: taskId, status: 'queued' }
    })
  }
  throw new Error('不支持的人工核对操作')
}

async function syncTasks(workerToken) {
  assertWorkerToken(workerToken)
  const startedAt = Date.now()
  const [processing, queued, unknown] = await Promise.all([
    db.collection('tasks').where({ status: 'processing' }).orderBy('updatedAt', 'asc').limit(10).get(),
    db.collection('tasks').where({ status: 'queued' }).orderBy('updatedAt', 'asc').limit(10).get(),
    db.collection('tasks').where({ status: 'submission_unknown' }).orderBy('updatedAt', 'asc').limit(10).get()
  ])
  const candidates = [...processing.data, ...queued.data, ...unknown.data]
    .filter((task) => task.status !== 'submission_unknown' || task.providerTaskId)
    .sort((a, b) => Number(a.updatedAt || a.createdAt || 0) - Number(b.updatedAt || b.createdAt || 0))
    .slice(0, 3)
  const summary = { checked: candidates.length, succeeded: 0, failed: 0, processing: 0 }

  for (const item of candidates) {
    if (Date.now() - startedAt >= WORKER_PROCESS_BUDGET_MS) break
    const task = await claimTaskForSync(item.id)
    if (!task) continue
    if (!task.providerTaskId) {
      if (Date.now() - task.createdAt > 10 * 60 * 1000) {
        if (task.provider === 'tokenhub-hy' && task.providerCreateStartedAt) {
          await updateClaimedTask(task, { status: 'submission_unknown', errorMessage: '提交状态待人工核对，请勿再次创建' })
          summary.processing += 1
        } else {
          await refundTask(task.id, '任务未能提交，创作点已退回', task.syncLeaseId)
          summary.failed += 1
        }
      } else {
        await updateClaimedTask(task, { progress: task.progress || 5 })
        summary.processing += 1
      }
      continue
    }
    try {
      const provider = createProvider(task.provider)
      const state = await provider.query(task.providerTaskId)
      if (state.status === 'succeeded') {
        const outputFileId = task.provider === 'tokenhub-hy'
          ? await persistHyVideo(cloud, task.id, state.outputUrl)
          : ''
        if (await completeClaimedTask(task, state, outputFileId)) summary.succeeded += 1
      } else if (state.status === 'failed') {
        await refundTask(task.id, state.errorMessage, task.syncLeaseId)
        summary.failed += 1
      } else if (['queued', 'processing'].includes(state.status)) {
        if (task.provider === 'tokenhub-hy' && Date.now() - task.createdAt > HY_TASK_TIMEOUT_MS) {
          await refundTask(task.id, '混元视频任务超时，创作点已退回', task.syncLeaseId)
          summary.failed += 1
        } else {
          await updateClaimedTask(task, {
            status: state.status,
            progress: Math.max(task.progress || 12, state.progress || 20),
            providerState: state.rawState || state.status,
            providerPollTraceId: state.traceId || ''
          })
          summary.processing += 1
        }
      } else throw new Error('视频服务返回未知任务状态')
    } catch (error) {
      if (task.provider === 'tokenhub-hy' && ([401, 403].includes(error.status) || Date.now() - task.createdAt > HY_TASK_TIMEOUT_MS)) {
        await refundTask(task.id, error.message, task.syncLeaseId)
        summary.failed += 1
      } else {
        await recordPollError(task, error)
        summary.processing += 1
      }
    }
  }
  return summary
}

async function route(event) {
  const action = event.action
  const data = event.data || {}
  await ensureCoreCollections()
  if (action === 'worker.sync') return syncTasks(data.workerToken)
  if (action === 'worker.resolveUnknown') return resolveUnknownTask(data)

  const context = cloud.getWXContext()
  const openid = context.OPENID
  if (!openid) throw new Error('无法识别当前微信用户')

  if (action === 'bootstrap') {
    const user = await getUser(openid)
    return { registered: Boolean(user && user.registeredAt), profile: user && user.registeredAt ? publicUser(user) : null }
  }
  if (action === 'account.register') return registerAccount(openid, data)
  if (action === 'account.register.phone') return registerWithPhone(openid, data)
  if (action === 'wallet.get') return publicUser(await ensureRegistered(openid))
  if (action === 'task.create') return createTask(openid, data)
  if (action === 'task.list') return listOwnedTasks(openid)
  if (action === 'task.get') return getOwnedTask(openid, data.id)
  if (action === 'order.create') return createOrder(openid, data.packageId)
  if (action === 'payment.status') return paymentStatus()
  if (action === 'game.room.create') return createGameRoom(openid, data)
  if (action === 'game.room.join') return joinGameRoom(openid, data.roomId)
  if (action === 'game.room.get') return readGameRoom(openid, data.roomId)
  if (action === 'game.room.start') return startGameRoom(openid, data.roomId)
  if (action === 'game.quiz.answer') return answerQuizRoom(openid, data)
  if (action === 'game.party.next') return nextPartyRound(openid, data.roomId)
  if (action === 'game.party.guess') return guessPartyNumber(openid, data)
  if (action === 'account.delete') return deleteAccount(openid, data.confirmation)
  throw new Error('不支持的操作')
}

exports.main = async (event) => {
  try {
    return { ok: true, data: await route(event || {}) }
  } catch (error) {
    console.error('ipcamp-api error', { action: event && event.action, message: error.message, stack: error.stack })
    return { ok: false, message: error.message || '服务暂时不可用' }
  }
}

exports._test = { makeTaskId, resolveMedia, publicUser, publicTask }

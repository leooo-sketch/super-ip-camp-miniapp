const { workflows } = require('../data/workflows')

const PROFILE_KEY = 'ipcamp_demo_profile'
const TASKS_KEY = 'ipcamp_demo_tasks'
const REGISTERED_KEY = 'ipcamp_demo_registered'

function getDemoProfile() {
  const cached = wx.getStorageSync(PROFILE_KEY)
  if (cached) return cached
  const profile = {
    nickname: 'IP主理人',
    balance: 500,
    plan: '基础版',
    registered: true,
    demoMode: true
  }
  wx.setStorageSync(PROFILE_KEY, profile)
  return profile
}

function getDemoTasks() {
  return wx.getStorageSync(TASKS_KEY) || []
}

function saveDemoTasks(tasks) {
  wx.setStorageSync(TASKS_KEY, tasks)
}

function createDemoTask(payload) {
  const profile = getDemoProfile()
  const workflow = workflows.find((item) => item.id === payload.workflowId)
  if (!workflow) throw new Error('工作流不存在')
  if (profile.balance < workflow.tokenCost) throw new Error('创作点余额不足')

  profile.balance -= workflow.tokenCost
  wx.setStorageSync(PROFILE_KEY, profile)

  const now = Date.now()
  const task = {
    id: `demo_${now}`,
    workflowId: workflow.id,
    workflowTitle: workflow.title,
    topic: payload.topic,
    status: 'processing',
    progress: 12,
    tokenCost: workflow.tokenCost,
    provider: '演示引擎',
    createdAt: now,
    updatedAt: now,
    outputUrl: '',
    coverUrl: '/assets/creator-studio-open-source.jpg',
    demoMode: true,
    payload
  }
  const tasks = getDemoTasks()
  tasks.unshift(task)
  saveDemoTasks(tasks)
  return task
}

function hydrateDemoTask(task) {
  if (!task || task.status !== 'processing') return task
  const elapsed = Date.now() - task.createdAt
  if (elapsed >= 12000) {
    return Object.assign({}, task, {
      status: 'succeeded',
      progress: 100,
      previewOnly: true,
      updatedAt: Date.now()
    })
  }
  const progress = Math.min(92, 12 + Math.floor(elapsed / 140))
  return Object.assign({}, task, { progress, updatedAt: Date.now() })
}

function topUpDemo(tokens) {
  const profile = getDemoProfile()
  profile.balance += tokens
  wx.setStorageSync(PROFILE_KEY, profile)
  return profile
}

function deleteDemoAccount() {
  wx.removeStorageSync(PROFILE_KEY)
  wx.removeStorageSync(TASKS_KEY)
  wx.removeStorageSync(REGISTERED_KEY)
  return { deleted: true }
}

module.exports = {
  getDemoProfile,
  getDemoTasks,
  createDemoTask,
  hydrateDemoTask,
  topUpDemo,
  deleteDemoAccount
}

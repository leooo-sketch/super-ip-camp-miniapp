const { getTask, ensureRegistered } = require('../../utils/api')
const { formatDate } = require('../../utils/format')

const STATUS_TEXT = {
  queued: '排队中',
  processing: '生成中',
  succeeded: '已完成',
  failed: '生成失败'
}

Page({
  data: {
    taskId: '',
    task: null,
    statusText: '',
    createdAtText: '',
    errorMessage: ''
  },

  async onLoad(options) {
    this.setData({ taskId: options.id || '' })
    const profile = await ensureRegistered(`/pages/task/index?id=${options.id || ''}`)
    if (!profile) return
    this.refresh()
  },

  onShow() {
    this.startPolling()
  },

  onHide() {
    this.stopPolling()
  },

  onUnload() {
    this.stopPolling()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  startPolling() {
    this.stopPolling()
    this.poller = setInterval(() => this.refresh(), 2500)
  },

  stopPolling() {
    if (this.poller) clearInterval(this.poller)
    this.poller = null
  },

  async refresh() {
    if (!this.data.taskId) return
    try {
      const task = await getTask(this.data.taskId)
      if (!task) throw new Error('任务不存在')
      this.setData({
        task,
        statusText: STATUS_TEXT[task.status] || task.status,
        createdAtText: formatDate(task.createdAt),
        errorMessage: ''
      })
      if (task.status === 'succeeded' || task.status === 'failed') this.stopPolling()
    } catch (error) {
      this.setData({ errorMessage: error.message || '任务读取失败' })
    }
  },

  copyTaskId() {
    wx.setClipboardData({ data: this.data.taskId })
  },

  openWorks() {
    wx.switchTab({ url: '/pages/works/index' })
  }
})

const { getTask, ensureRegistered } = require('../../utils/api')
const { formatDate } = require('../../utils/format')
const { isHyWorkflow } = require('../../utils/hy-video')

const STATUS_TEXT = {
  queued: '排队中',
  processing: '生成中',
  submission_unknown: '提交待核对',
  succeeded: '已完成',
  failed: '生成失败'
}

Page({
  data: {
    taskId: '',
    task: null,
    statusText: '',
    createdAtText: '',
    errorMessage: '',
    isHyTask: false,
    savingVideo: false
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
        isHyTask: isHyWorkflow(task),
        statusText: STATUS_TEXT[task.status] || task.status,
        createdAtText: formatDate(task.createdAt),
        errorMessage: ''
      })
      if (['succeeded', 'failed', 'submission_unknown'].includes(task.status)) this.stopPolling()
    } catch (error) {
      this.setData({ errorMessage: error.message || '任务读取失败' })
    }
  },

  copyTaskId() {
    wx.setClipboardData({ data: this.data.taskId })
  },

  openWorks() {
    wx.switchTab({ url: '/pages/works/index' })
  },

  async saveVideo() {
    const task = this.data.task
    if (!this.data.isHyTask || !task || task.status !== 'succeeded' || !task.outputFileId || this.data.savingVideo) return
    this.setData({ savingVideo: true })
    wx.showLoading({ title: '正在保存', mask: true })
    try {
      const download = await wx.cloud.downloadFile({ fileID: task.outputFileId })
      if (!download || !download.tempFilePath) throw new Error('视频下载失败，请刷新作品后重试')
      await wx.saveVideoToPhotosAlbum({ filePath: download.tempFilePath })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (error) {
      const message = String(error && (error.errMsg || error.message) || '')
      if (/auth|authorize|permission|deny|权限|授权/i.test(message)) {
        wx.showModal({
          title: '需要相册权限',
          content: '保存视频需要允许访问相册。可在微信设置中开启后重试。',
          confirmText: '打开设置',
          success: (result) => { if (result.confirm) wx.openSetting() }
        })
      } else {
        wx.showToast({ title: error.message || '保存失败，请稍后重试', icon: 'none', duration: 3000 })
      }
    } finally {
      wx.hideLoading()
      this.setData({ savingVideo: false })
    }
  },

  createAgain() {
    const task = this.data.task
    if (!task || !this.data.isHyTask || !['succeeded', 'failed'].includes(task.status)) return
    const input = task.creationInput || {}
    wx.setStorageSync('ipcamp_hy_retry_draft', {
      workflowId: task.workflowId,
      topic: String(input.topic || task.topic || '').slice(0, 240),
      ratio: String(input.ratio || '')
    })
    wx.navigateTo({ url: `/pages/create/index?workflowId=${task.workflowId}&retry=1` })
  }
})

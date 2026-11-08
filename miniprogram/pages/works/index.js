const { bootstrap, listTasks } = require('../../utils/api')
const { formatDate } = require('../../utils/format')

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'processing', label: '生成中' },
  { id: 'submission_unknown', label: '待核对' },
  { id: 'succeeded', label: '已完成' },
  { id: 'failed', label: '失败' }
]

const STATUS_TEXT = { queued: '排队中', processing: '生成中', submission_unknown: '提交待核对', succeeded: '已完成', failed: '失败' }

Page({
  data: { filters: FILTERS, activeFilter: 'all', tasks: [], visibleTasks: [], loading: true, registered: false },

  onShow() {
    this.loadTasks()
  },

  onPullDownRefresh() {
    this.loadTasks().finally(() => wx.stopPullDownRefresh())
  },

  async loadTasks() {
    this.setData({ loading: true })
    try {
      const state = await bootstrap()
      if (!state || !state.registered) {
        this.setData({ registered: false, tasks: [], visibleTasks: [], loading: false })
        return
      }
      const tasks = (await listTasks()).map((task) => ({
        ...task,
        createdAtText: formatDate(task.createdAt),
        statusText: STATUS_TEXT[task.status] || task.status
      }))
      this.setData({ registered: true, tasks, loading: false })
      this.applyFilter()
    } catch (error) {
      this.setData({ loading: false })
      wx.showToast({ title: error.message || '作品读取失败', icon: 'none' })
    }
  },

  selectFilter(event) {
    this.setData({ activeFilter: event.currentTarget.dataset.id })
    this.applyFilter()
  },

  applyFilter() {
    const { tasks, activeFilter } = this.data
    const visibleTasks = activeFilter === 'all'
      ? tasks
      : tasks.filter((task) => activeFilter === 'processing'
        ? ['queued', 'processing'].includes(task.status)
        : task.status === activeFilter)
    this.setData({ visibleTasks })
  },

  openTask(event) {
    wx.navigateTo({ url: `/pages/task/index?id=${event.currentTarget.dataset.id}` })
  },

  startCreating() {
    wx.switchTab({ url: '/pages/home/index' })
  },

  openLogin() {
    wx.switchTab({ url: '/pages/profile/index' })
  }
})

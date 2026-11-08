const { getWorkflowById } = require('../../data/workflows')
const { validateCreation } = require('../../utils/validator')
const { createTask, uploadMedia, ensureRegistered } = require('../../utils/api')
const { isHyWorkflow, isHyTextVideo, isHyImageVideo, buildCreationPayload } = require('../../utils/hy-video')

const PLATFORM_OPTIONS = ['小红书', '视频号', '抖音', 'B站']
const STYLE_OPTIONS = ['真实纪实', '轻商业质感', '训练日志', '口播叙事']
const RATIO_OPTIONS = ['9:16', '16:9', '1:1']
const HY_RATIO_OPTIONS = ['9:16', '16:9', '1:1', '4:3', '3:4']
const RESOLUTION_OPTIONS = ['720p', '1080p']
const SOURCE_OPTIONS = ['本人原创', '已获书面授权']
const RETRY_DRAFT_KEY = 'ipcamp_hy_retry_draft'

Page({
  data: {
    workflow: {},
    hasAudience: false,
    hasScene: false,
    hasRemoveAudio: false,
    isHyWorkflow: false,
    isHyTextVideo: false,
    isHyImageVideo: false,
    showPlatform: true,
    showStyle: true,
    showRatio: true,
    showResolution: true,
    showImageUpload: true,
    showSourcePicker: true,
    topicLabel: '一句话创意',
    rightsSectionTitle: '3. 权利确认',
    images: [],
    video: null,
    platformOptions: PLATFORM_OPTIONS,
    styleOptions: STYLE_OPTIONS,
    ratioOptions: RATIO_OPTIONS,
    resolutionOptions: RESOLUTION_OPTIONS,
    sourceOptions: SOURCE_OPTIONS,
    platformIndex: 0,
    styleIndex: 0,
    ratioIndex: 0,
    resolutionIndex: 0,
    sourceIndex: 0,
    form: {
      topic: '',
      audience: '关注个人成长与健身的人群',
      scene: '',
      removeAudio: true,
      authorized: false,
      aiDisclosure: true
    },
    submitting: false
  },

  onLoad(options) {
    const workflow = getWorkflowById(options.workflowId)
    if (!workflow.enabled) {
      wx.showModal({
        title: '功能适配中',
        content: '该创作工作流正在适配模型能力，暂未开放。请先使用“一键创作爆款视频”。',
        showCancel: false,
        success: () => wx.switchTab({ url: '/pages/home/index' })
      })
      return
    }
    const hyWorkflow = isHyWorkflow(workflow)
    const hyTextVideo = isHyTextVideo(workflow)
    const hyImageVideo = isHyImageVideo(workflow)
    const ratioOptions = hyTextVideo ? HY_RATIO_OPTIONS : RATIO_OPTIONS
    const storedRetry = options.retry === '1' ? wx.getStorageSync(RETRY_DRAFT_KEY) : null
    if (options.retry === '1') wx.removeStorageSync(RETRY_DRAFT_KEY)
    const retry = storedRetry && storedRetry.workflowId === workflow.id ? storedRetry : {}
    const retryRatio = String(retry.ratio || '')
    const retryTopic = String(retry.topic || '').slice(0, 240)
    this.setData({
      workflow,
      hasAudience: workflow.fields.includes('audience'),
      hasScene: workflow.fields.includes('scene'),
      hasRemoveAudio: workflow.fields.includes('removeAudio'),
      isHyWorkflow: hyWorkflow,
      isHyTextVideo: hyTextVideo,
      isHyImageVideo: hyImageVideo,
      showPlatform: workflow.fields.includes('platform'),
      showStyle: workflow.fields.includes('style'),
      showRatio: workflow.fields.includes('ratio'),
      showResolution: workflow.fields.includes('resolution'),
      showImageUpload: workflow.maxImages > 0,
      showSourcePicker: !hyTextVideo,
      topicLabel: hyImageVideo ? '画面运动提示词' : (hyTextVideo ? '画面提示词' : '一句话创意'),
      rightsSectionTitle: workflow.maxImages > 0 ? '3. 权利确认' : '2. 内容权利确认',
      ratioOptions,
      ratioIndex: ratioOptions.includes(retryRatio) ? ratioOptions.indexOf(retryRatio) : 0,
      'form.topic': retryTopic
    })
    wx.setNavigationBarTitle({ title: workflow.shortTitle })
    ensureRegistered(`/pages/create/index?workflowId=${workflow.id}`)
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: event.detail.value })
  },

  handlePicker(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`${field}Index`]: Number(event.detail.value) })
  },

  handleSwitch(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: event.detail.value })
  },

  async chooseImages() {
    const remaining = this.data.workflow.maxImages - this.data.images.length
    if (remaining <= 0) {
      wx.showToast({ title: `最多上传 ${this.data.workflow.maxImages} 张`, icon: 'none' })
      return
    }
    try {
      const result = await wx.chooseMedia({
        count: remaining,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })
      if (this.data.isHyImageVideo && result.tempFiles.some((file) => {
        const path = String(file.tempFilePath || '')
        const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(path)
        return Number(file.size || 0) > 10 * 1024 * 1024 ||
          (extension && !['jpg', 'jpeg', 'png'].includes(extension[1].toLowerCase()))
      })) throw new Error('请选择一张不超过 10MB 的 JPG 或 PNG 图片')
      wx.showLoading({ title: '正在上传', mask: true })
      const uploaded = []
      for (const file of result.tempFiles) {
        uploaded.push(await uploadMedia(file.tempFilePath, 'image'))
      }
      this.setData({ images: this.data.images.concat(uploaded) })
    } catch (error) {
      wx.showToast({ title: error.message || '图片上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async chooseVideo() {
    const result = await wx.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: 10
    })
    wx.showLoading({ title: '正在上传', mask: true })
    try {
      const uploaded = await uploadMedia(result.tempFiles[0].tempFilePath, 'video')
      this.setData({ video: uploaded })
    } catch (error) {
      wx.showToast({ title: error.message || '视频上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  removeImage(event) {
    const index = Number(event.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  removeVideo() {
    this.setData({ video: null })
  },

  async submit() {
    if (this.data.submitting) return
    const rawPayload = {
      workflowId: this.data.workflow.id,
      topic: this.data.form.topic.trim(),
      audience: this.data.form.audience.trim(),
      scene: this.data.form.scene.trim(),
      platform: PLATFORM_OPTIONS[this.data.platformIndex],
      style: STYLE_OPTIONS[this.data.styleIndex],
      ratio: RATIO_OPTIONS[this.data.ratioIndex],
      resolution: RESOLUTION_OPTIONS[this.data.resolutionIndex],
      duration: 10,
      sourceType: this.data.sourceIndex === 0 ? 'self-owned' : 'licensed',
      removeAudio: this.data.form.removeAudio,
      authorized: this.data.form.authorized,
      aiDisclosure: this.data.form.aiDisclosure,
      images: this.data.images.map((item) => item.fileId),
      video: this.data.video ? this.data.video.fileId : '',
      requestId: ''
    }
    const signature = JSON.stringify({
      workflowId: rawPayload.workflowId,
      topic: rawPayload.topic,
      ratio: rawPayload.ratio,
      images: rawPayload.images,
      sourceType: rawPayload.sourceType,
      authorized: rawPayload.authorized,
      aiDisclosure: rawPayload.aiDisclosure
    })
    if (!this.pendingRequestId || this.pendingSignature !== signature || !this.data.isHyWorkflow) {
      this.pendingRequestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`
      this.pendingSignature = signature
    }
    rawPayload.requestId = this.pendingRequestId
    const payload = buildCreationPayload(rawPayload, this.data.workflow)
    const validationMessage = validateCreation(payload, this.data.workflow)
    if (validationMessage) {
      wx.showToast({ title: validationMessage, icon: 'none', duration: 3000 })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在创建', mask: true })
    try {
      const task = await createTask(payload)
      this.pendingRequestId = ''
      wx.redirectTo({ url: `/pages/task/index?id=${task.id}` })
    } catch (error) {
      if (/已退回|余额不足|未配置|未开通|演示模式/.test(String(error.message || ''))) this.pendingRequestId = ''
      wx.showToast({ title: error.message || '创建失败', icon: 'none', duration: 3000 })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  }
})

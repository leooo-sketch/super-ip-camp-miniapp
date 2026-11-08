const BLOCKED_PATTERNS = [
  /明星.{0,4}换脸/i,
  /冒充.{0,4}(本人|他人|真人)/i,
  /盗用|偷拍|未授权/i,
  /去水印.{0,4}(搬运|复刻)/i,
  /规避.{0,4}(版权|侵权|审核)/i
]

function validatePayload(payload, workflow) {
  if (!payload || !workflow) throw new Error('无效的工作流请求')
  if (payload.authorized !== true) throw new Error('必须确认素材为本人所有或已取得明确授权')
  if (payload.aiDisclosure !== true) throw new Error('必须同意在发布时标注 AI 生成或 AI 辅助创作')
  if (!['self-owned', 'licensed'].includes(payload.sourceType)) throw new Error('素材来源不符合要求')
  const topic = String(payload.topic || '').trim()
  if (!topic || topic.length > 240) throw new Error('创作主题应为 1-240 个字符')
  const descriptiveText = [topic, payload.audience, payload.scene, payload.style].filter(Boolean).join(' ')
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(descriptiveText))) throw new Error('创作描述涉及仿冒或规避权利要求')
  const images = Array.isArray(payload.images) ? payload.images.filter(Boolean) : []
  if (images.length < workflow.minImages || images.length > workflow.maxImages) {
    throw new Error(`图片数量应为 ${workflow.minImages}-${workflow.maxImages} 张`)
  }
  if (workflow.requiresVideo && !payload.video) throw new Error('该工作流需要一段本人拍摄或已授权参考视频')
  const mediaIds = images.concat(payload.video ? [payload.video] : [])
  if (mediaIds.some((value) => !String(value).startsWith('cloud://'))) {
    throw new Error('素材必须先上传到当前小程序的云存储')
  }
  if (workflow.provider === 'tokenhub-hy') {
    if (payload.video) throw new Error('混元视频工作流不接受参考视频')
    if (workflow.providerMode === 'img2video') {
      if (payload.ratio) throw new Error('图生视频画面比例由图片决定，不能指定比例')
    } else if (!['9:16', '16:9', '1:1', '4:3', '3:4'].includes(payload.ratio)) {
      throw new Error('不支持的文生视频画面比例')
    }
    if (payload.duration !== undefined && Number(payload.duration) !== 5) throw new Error('混元视频固定为 5 秒')
    if (payload.resolution !== undefined && payload.resolution !== '720p') throw new Error('混元视频固定为 720p')
    return { ...payload, topic, images, duration: 5, resolution: '720p', ratio: workflow.providerMode === 'img2video' ? undefined : payload.ratio }
  }
  if (!['9:16', '16:9', '1:1'].includes(payload.ratio)) throw new Error('不支持的画面比例')
  if (!['720p', '1080p'].includes(payload.resolution)) throw new Error('不支持的清晰度')
  const duration = Number(payload.duration || 10)
  if (!Number.isInteger(duration) || duration < 5 || duration > 15) throw new Error('视频时长应为 5-15 秒')
  return { ...payload, topic, images, duration }
}

module.exports = { validatePayload, BLOCKED_PATTERNS }

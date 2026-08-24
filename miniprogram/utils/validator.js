const BLOCKED_TERMS = ['明星换脸', '冒充本人', '盗用', '去水印搬运', '规避版权']

function validateCreation(payload, workflow) {
  if (!payload.authorized) {
    return '请确认上传素材为本人所有或已获得明确授权'
  }
  if (!payload.aiDisclosure) {
    return '请同意在发布时标注 AI 生成或 AI 辅助创作'
  }
  if (!String(payload.topic || '').trim()) {
    return '请填写本条视频的主题'
  }
  if (BLOCKED_TERMS.some((term) => String(payload.topic || '').includes(term))) {
    return '当前描述涉及仿冒或规避版权，请改用本人原创或已授权素材'
  }
  const imageCount = Array.isArray(payload.images) ? payload.images.length : 0
  if (workflow.minImages && imageCount < workflow.minImages) {
    return `请至少上传 ${workflow.minImages} 张本人或已授权图片`
  }
  if (workflow.mediaMode === 'video-and-images' && !payload.video) {
    return '请上传本人拍摄或已明确授权的参考视频'
  }
  return ''
}

module.exports = { validateCreation, BLOCKED_TERMS }

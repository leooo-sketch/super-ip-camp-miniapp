function buildDirectorPrompt(payload) {
  const parts = [
    `创作主题：${payload.topic}`,
    payload.audience ? `目标观众：${payload.audience}` : '',
    payload.scene ? `场景：${payload.scene}` : '',
    `平台：${payload.platform || '小红书'}`,
    `风格：${payload.style || '真实纪实'}`,
    '使用用户提供并确认有权使用的人物形象。保持自然面部特征、真实皮肤纹理和稳定身份一致性。',
    '重新设计镜头运动、动作衔接、服装细节和环境，不复制参考素材中的独特表演或受保护表达。',
    '身体比例自然，肌肉线条符合真实训练状态，避免夸张增肌、肢体变形、闪烁和塑料皮肤。',
    '竖屏短视频节奏，前3秒有明确视觉钩子，画面干净，无文字水印、无平台标识。'
  ]
  return parts.filter(Boolean).join('\n')
}

module.exports = { buildDirectorPrompt }

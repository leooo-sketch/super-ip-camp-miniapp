const HY_TEXT_VIDEO = 'hy-text-video'
const HY_IMAGE_VIDEO = 'hy-image-video'

function isHyWorkflow(workflow) {
  return Boolean(workflow && [HY_TEXT_VIDEO, HY_IMAGE_VIDEO].includes(workflow.workflowId || workflow.id))
}

function isHyTextVideo(workflow) {
  return Boolean(workflow && (workflow.workflowId || workflow.id) === HY_TEXT_VIDEO)
}

function isHyImageVideo(workflow) {
  return Boolean(workflow && (workflow.workflowId || workflow.id) === HY_IMAGE_VIDEO)
}

function buildCreationPayload(payload, workflow) {
  if (!isHyWorkflow(workflow)) return payload
  const textVideo = isHyTextVideo(workflow)
  return {
    workflowId: workflow.id,
    topic: payload.topic,
    ...(textVideo ? { ratio: payload.ratio } : {}),
    resolution: '720p',
    duration: 5,
    images: textVideo ? [] : payload.images,
    sourceType: payload.sourceType,
    authorized: payload.authorized,
    aiDisclosure: payload.aiDisclosure,
    requestId: payload.requestId
  }
}

module.exports = {
  isHyWorkflow,
  isHyTextVideo,
  isHyImageVideo,
  buildCreationPayload
}

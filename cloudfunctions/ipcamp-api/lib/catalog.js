const WORKFLOWS = {
  'fashion-video': {
    id: 'fashion-video',
    title: 'AI穿搭视频工作流',
    tokenCost: 159,
    enabled: false,
    providerMode: 'img2video',
    minImages: 2,
    maxImages: 8,
    requiresVideo: false
  },
  'viral-film': {
    id: 'viral-film',
    title: '一键创作爆款视频',
    tokenCost: 89,
    enabled: true,
    providerMode: 'img2video',
    minImages: 1,
    maxImages: 1,
    requiresVideo: false
  },
  'same-style': {
    id: 'same-style',
    title: '授权素材同款重构',
    tokenCost: 199,
    enabled: false,
    providerMode: 'trending',
    minImages: 1,
    maxImages: 7,
    requiresVideo: true
  },
  'ip-avatar': {
    id: 'ip-avatar',
    title: '固定IP形象短片',
    tokenCost: 129,
    enabled: false,
    providerMode: 'img2video',
    minImages: 3,
    maxImages: 7,
    requiresVideo: false
  }
}

const PACKAGES = {
  starter: { id: 'starter', name: '轻量包', tokens: 300, amountFen: 2900 },
  creator: { id: 'creator', name: '创作者包', tokens: 980, amountFen: 7900 },
  studio: { id: 'studio', name: '工作室包', tokens: 2280, amountFen: 15900 }
}

module.exports = { WORKFLOWS, PACKAGES }

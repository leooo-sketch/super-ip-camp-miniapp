const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram', 'app.json'), 'utf8'))
const runtimeConfig = require(path.join(root, 'miniprogram', 'config.js'))
const cloudbase = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
const { WORKFLOWS } = require(path.join(root, 'cloudfunctions', 'ipcamp-api', 'lib', 'catalog.js'))
const errors = []

if (!project.appid || project.appid === 'touristappid') {
  errors.push('project.config.json 仍是 touristappid，请填写微信公众平台的小程序 AppID')
}
if (!String(runtimeConfig.CLOUD_ENV_ID || '').trim() || String(runtimeConfig.CLOUD_ENV_ID).startsWith('your-')) {
  errors.push('miniprogram/config.js 未填写真实 CLOUD_ENV_ID')
}
if (!String(cloudbase.envId || '').trim() || cloudbase.envId !== runtimeConfig.CLOUD_ENV_ID) {
  errors.push('cloudbaserc.json 的 envId 必须与小程序真实 CLOUD_ENV_ID 一致')
}
if (!String(runtimeConfig.AI_REGISTRATION_NUMBER || '').trim()) {
  errors.push('miniprogram/config.js 未填写所用生成式 AI 服务的登记/备案号')
}
if (appConfig.__usePrivacyCheck__ !== true) {
  errors.push('app.json 未启用隐私检查')
}
if (!(appConfig.pages || []).includes('pages/wallet/index')) {
  errors.push('正式版缺少充值创作点页面')
}
if (!fs.existsSync(path.join(root, 'cloudfunctions', 'ipcamp-pay-callback', 'index.js'))) {
  errors.push('缺少微信支付服务端回调函数')
}
if (Object.values(WORKFLOWS).some((workflow) => workflow.enabled && workflow.provider === 'tokenhub-hy') &&
    process.env.HY_AI_COMPLIANCE_CONFIRMED !== 'true') {
  errors.push('Hy 视频 AI 服务类目、供应商备案/合作材料和隐私指引尚需管理员人工核验；核验完成后运行检查时设置 HY_AI_COMPLIANCE_CONFIRMED=true')
}

if (errors.length) {
  console.error(`上线检查未通过：\n- ${errors.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`上线检查通过：AppID ${project.appid}，云环境 ${runtimeConfig.CLOUD_ENV_ID}`)
}

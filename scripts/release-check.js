const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram', 'app.json'), 'utf8'))
const runtimeConfig = require(path.join(root, 'miniprogram', 'config.js'))
const errors = []

if (!project.appid || project.appid === 'touristappid') {
  errors.push('project.config.json 仍是 touristappid，请填写微信公众平台的小程序 AppID')
}
if (!String(runtimeConfig.CLOUD_ENV_ID || '').trim()) {
  errors.push('miniprogram/config.js 未填写 CLOUD_ENV_ID')
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

if (errors.length) {
  console.error(`上线检查未通过：\n- ${errors.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`上线检查通过：AppID ${project.appid}，云环境 ${runtimeConfig.CLOUD_ENV_ID}`)
}

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

test('正式版从可浏览首页进入，并注册登录与充值页面', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram', 'app.json'), 'utf8'))
  assert.equal(app.pages[0], 'pages/home/index')
  assert.ok(app.pages.includes('pages/login/index'))
  assert.ok(app.pages.includes('pages/wallet/index'))
})

test('我的页面同时提供微信与手机号授权登录', () => {
  const profile = fs.readFileSync(path.join(root, 'miniprogram', 'pages', 'profile', 'index.wxml'), 'utf8')
  assert.match(profile, /微信登录/)
  assert.match(profile, /open-type="getPhoneNumber"/)
  assert.match(profile, /手机号授权登录/)
})

test('云函数安装服务端依赖并对调用故障显示友好提示', () => {
  const cloudbase = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'))
  const apiFunction = cloudbase.functions.find((item) => item.name === 'ipcamp-api')
  const apiPackage = JSON.parse(fs.readFileSync(path.join(root, 'cloudfunctions', 'ipcamp-api', 'package.json'), 'utf8'))
  const clientApi = fs.readFileSync(path.join(root, 'miniprogram', 'utils', 'api.js'), 'utf8')
  assert.equal(apiFunction.installDependency, true)
  assert.ok(apiPackage.dependencies['wx-server-sdk'])
  assert.match(clientApi, /-504002/)
  assert.match(clientApi, /云服务启动失败，请检查云函数依赖与运行日志/)
})

test('支付到账只由独立服务端回调增加创作点', () => {
  const client = fs.readFileSync(path.join(root, 'miniprogram', 'pages', 'wallet', 'index.js'), 'utf8')
  const callback = fs.readFileSync(path.join(root, 'cloudfunctions', 'ipcamp-pay-callback', 'index.js'), 'utf8')
  assert.match(client, /wx\.requestPayment/)
  assert.doesNotMatch(client, /balance\s*[:=]\s*.*\+/)
  assert.match(callback, /status === 'paid'/)
  assert.match(callback, /amount mismatch/)
  assert.match(callback, /balance: command\.inc/)
})

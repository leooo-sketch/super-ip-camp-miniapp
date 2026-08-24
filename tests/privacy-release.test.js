const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8')
}

test('登录页面不再使用“登录即同意”并提供主动勾选与协议入口', () => {
  const login = read('miniprogram', 'pages', 'login', 'index.wxml')
  const profile = read('miniprogram', 'pages', 'profile', 'index.wxml')
  for (const source of [login, profile]) {
    assert.doesNotMatch(source, /登录即表示同意/)
    assert.match(source, /checkbox-group/)
    assert.match(source, /我已阅读并同意/)
    assert.match(source, /《用户服务协议》/)
    assert.match(source, /《隐私保护指引》/)
    assert.match(source, /open-type="agreePrivacyAuthorization"/)
  }
})

test('登录前不再主动 wx.login，应用启动时不自动 bootstrap', () => {
  const loginJs = read('miniprogram', 'pages', 'login', 'index.js')
  const profileJs = read('miniprogram', 'pages', 'profile', 'index.js')
  const appJs = read('miniprogram', 'app.js')
  assert.doesNotMatch(loginJs, /wx\.login\s*\(/)
  assert.doesNotMatch(profileJs, /wx\.login\s*\(/)
  assert.doesNotMatch(appJs, /await\s+bootstrap\s*\(/)
})

test('所有前端云调用与上传均经过隐私同意检查', () => {
  const api = read('miniprogram', 'utils', 'api.js')
  assert.match(api, /await requirePrivacyReady\(\)/)
  assert.match(api, /privacyRequired: true/)
  assert.match(api, /async function uploadMedia[\s\S]*await requirePrivacyReady\(\)/)
})

test('未完成的同款重构与固定IP工作流在前后端都关闭', () => {
  const workflows = read('miniprogram', 'data', 'workflows.js')
  const catalog = read('cloudfunctions', 'ipcamp-api', 'lib', 'catalog.js')
  const sameStyleFront = workflows.slice(workflows.indexOf("id: 'same-style'"), workflows.indexOf("id: 'ip-avatar'"))
  const ipAvatarFront = workflows.slice(workflows.indexOf("id: 'ip-avatar'"), workflows.indexOf("id: 'fitness-diary'"))
  const sameStyleBack = catalog.slice(catalog.indexOf("'same-style':"), catalog.indexOf("'ip-avatar':"))
  const ipAvatarBack = catalog.slice(catalog.indexOf("'ip-avatar':"), catalog.indexOf('const PACKAGES'))
  assert.match(sameStyleFront, /enabled: false/)
  assert.match(ipAvatarFront, /enabled: false/)
  assert.match(sameStyleBack, /enabled: false/)
  assert.match(ipAvatarBack, /enabled: false/)
})

test('正式图生视频只接收一张首帧图，避免多图被误认为全部参与生成', () => {
  const workflows = read('miniprogram', 'data', 'workflows.js')
  const viralFront = workflows.slice(workflows.indexOf("id: 'viral-film'"), workflows.indexOf("id: 'same-style'"))
  assert.match(viralFront, /maxImages: 1/)
})

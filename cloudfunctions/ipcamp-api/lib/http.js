const https = require('https')

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 30000
    }, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { raw += chunk })
      response.on('end', () => {
        let data = {}
        try { data = raw ? JSON.parse(raw) : {} } catch (error) {
          reject(new Error(`视频服务返回了无效响应 (${response.statusCode})`))
          return
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const message = data.message || data.error || `视频服务请求失败 (${response.statusCode})`
          reject(new Error(String(message)))
          return
        }
        resolve(data)
      })
    })
    request.on('timeout', () => request.destroy(new Error('视频服务请求超时')))
    request.on('error', reject)
    if (options.body) request.write(JSON.stringify(options.body))
    request.end()
  })
}

module.exports = { requestJson }

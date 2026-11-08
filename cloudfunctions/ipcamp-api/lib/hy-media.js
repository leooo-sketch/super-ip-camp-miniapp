const https = require('https')
const net = require('net')

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024

function publicHttpsUrl(value) {
  const url = new URL(String(value || ''))
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
    !host.includes('.') || net.isIP(host) || /(?:^|\.)(?:localhost|local|internal)$/.test(host)) {
    throw new Error('媒体地址须为公网 HTTPS 地址')
  }
  return url
}

function downloadLimited(value, options = {}, redirects = 0) {
  const url = publicHttpsUrl(value)
  const maxBytes = options.maxBytes || MAX_VIDEO_BYTES
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: options.timeout || 90000 }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume()
        if (redirects >= 2 || !response.headers.location) {
          reject(new Error('媒体地址重定向过多'))
          return
        }
        let next
        try { next = new URL(response.headers.location, url).toString() } catch (error) {
          reject(new Error('媒体跳转地址无效'))
          return
        }
        downloadLimited(next, options, redirects + 1).then(resolve, reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`媒体下载失败 (${response.statusCode})`))
        return
      }
      const length = Number(response.headers['content-length'] || 0)
      if (length > maxBytes) {
        response.resume()
        reject(new Error('媒体文件超过允许大小'))
        return
      }
      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) response.destroy(new Error('媒体文件超过允许大小'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        if (!size) {
          reject(new Error('媒体文件为空'))
          return
        }
        resolve({ buffer: Buffer.concat(chunks, size), contentType: String(response.headers['content-type'] || '').split(';')[0].toLowerCase() })
      })
      response.on('error', reject)
    })
    const timer = setTimeout(() => request.destroy(new Error('媒体下载超时')), options.timeout || 90000)
    request.on('close', () => clearTimeout(timer))
    request.on('timeout', () => request.destroy(new Error('媒体下载超时')))
    request.on('error', reject)
  })
}

function assertImageData(media) {
  const { buffer, contentType } = media
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  if (!jpeg && !png) throw new Error('参考图片须为 JPG 或 PNG')
  if (contentType && !['image/jpeg', 'image/png', 'application/octet-stream'].includes(contentType)) {
    throw new Error('参考图片类型不正确')
  }
}

function assertVideoData(media) {
  const { buffer, contentType } = media
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') throw new Error('模型返回的不是 MP4 视频')
  if (contentType && !['video/mp4', 'application/mp4', 'application/octet-stream'].includes(contentType)) {
    throw new Error('模型视频类型不正确')
  }
}

async function inspectHyImage(url, download = downloadLimited) {
  const media = await download(url, { maxBytes: MAX_IMAGE_BYTES, timeout: 30000 })
  if (media.buffer.length > MAX_IMAGE_BYTES) throw new Error('参考图片不能超过 10MB')
  assertImageData(media)
}

async function persistHyVideo(cloud, taskId, url, download = downloadLimited) {
  const media = await download(url, { maxBytes: MAX_VIDEO_BYTES, timeout: 45000 })
  if (media.buffer.length > MAX_VIDEO_BYTES) throw new Error('生成视频超过存储大小限制')
  assertVideoData(media)
  let timer
  const uploaded = await Promise.race([
    cloud.uploadFile({ cloudPath: `ipcamp/hy-video/${taskId}.mp4`, fileContent: media.buffer }),
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('生成视频转存超时')), 40000) })
  ]).finally(() => clearTimeout(timer))
  if (!uploaded || !uploaded.fileID) throw new Error('生成视频转存云存储失败')
  return uploaded.fileID
}

module.exports = { publicHttpsUrl, downloadLimited, assertImageData, assertVideoData, inspectHyImage, persistHyVideo, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES }

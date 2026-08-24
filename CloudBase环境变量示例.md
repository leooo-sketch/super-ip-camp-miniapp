# CloudBase 环境变量示例

## ipcamp-api

```text
VIDEO_PROVIDER=kling-direct
KLING_API_KEY=请在CloudBase控制台填写真实密钥
WORKER_TOKEN=请生成至少32位随机字符串
WELCOME_TOKENS=500
```

## ipcamp-worker

```text
WORKER_TOKEN=必须与ipcamp-api中的WORKER_TOKEN完全一致
```

## 注意

- 不要把 `KLING_API_KEY` 写入 `miniprogram/config.js` 或任何前端文件。

## 通过 Dify 编排（推荐）

```text
VIDEO_PROVIDER=dify
DIFY_WORKFLOW_API_KEY=请填写已发布 Workflow 的 App API Key
DIFY_API_BASE_URL=https://api.dify.ai/v1
DIFY_ALLOWED_HOSTS=api.dify.ai
DIFY_USER_PREFIX=ipcamp
```

切换到 Dify 后，`KLING_API_KEY` 应从 CloudBase 移到 Python 模型服务；CloudBase 只保存 Dify Workflow Key。回滚时将 `VIDEO_PROVIDER` 改回 `kling-direct` 即可。
- 不要把真实密钥提交到公开 Git 仓库。
- 如暂不启用支付，可不配置支付相关环境变量。

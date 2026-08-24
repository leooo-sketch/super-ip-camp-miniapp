# Dify Workflow

导入 `ipcamp-ai-router.yml` 后，只需配置两个 Workflow 环境变量：

- `MODEL_SERVICE_BASE_URL`：已部署的 Python 模型服务 HTTPS 根地址。
- `MODEL_SERVICE_TOKEN`：与 Python 服务 `MODEL_SERVICE_TOKEN` 完全一致的内部令牌。

先使用 Python 服务的 `MODEL_PROVIDER=mock` 完成端到端联调，再切换 `kling-direct`。工作流发布并创建 API Key 后，将 Key 仅写入 CloudBase 的 `DIFY_WORKFLOW_API_KEY`，禁止写进小程序源码。

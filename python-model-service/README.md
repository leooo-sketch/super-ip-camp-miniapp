# Python 模型服务

该服务位于 Dify Workflow 的 HTTP 请求节点之后，统一模型创建/查询协议。默认 `MODEL_PROVIDER=mock`，联调通过后改为 `kling-direct`。

## API

- `GET /healthz`：健康检查。
- `POST /v1/tasks/dispatch`：`operation=create|query`，请求头必须包含 `X-Internal-Token`。

生产环境必须通过 HTTPS 暴露，并限制仅允许 Dify 出站访问；`MODEL_SERVICE_TOKEN` 与模型密钥只放服务端环境变量。

## LangSmith Deployment

项目通过 `langgraph.json` 复用当前 FastAPI 服务：

- Dify 仍调用 `POST /v1/tasks/dispatch`，无需改变请求/响应契约。
- `ipcamp_model_service` 是不接触提示词和素材的健康检查图，用于 LangSmith Studio/Deployment 验证。
- 手工追踪只记录操作类型、业务工作流、模型供应商、状态和进度，不记录提示词、素材 URL、内部令牌或结果 URL。

在 LangSmith 从 GitHub 部署时，将 API 配置路径设为 `python-model-service/langgraph.json`，并在部署环境中配置：

```text
MODEL_SERVICE_TOKEN=<至少32字节随机令牌>
MODEL_PROVIDER=mock
KLING_API_KEY=
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=super-ip-camp-model-service
```

联调成功后再将 `MODEL_PROVIDER` 切换为 `kling-direct` 并设置真实 `KLING_API_KEY`。

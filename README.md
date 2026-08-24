# 超级 IP 创造营微信小程序

一个面向个人 IP 视频创作的微信小程序示例项目。项目保留 CloudBase 业务后端，将 AI 调用抽象为 Provider，并使用 Dify Workflow 可视化管理 AI 路由；独立 Python 模型服务可部署到 LangSmith Deployment 或其他容器平台。

## 架构

```text
微信小程序
  → CloudBase ipcamp-api / ipcamp-worker
  → Dify Workflow
  → HTTPS /v1/tasks/dispatch
  → Python 模型服务
  → 可灵等模型供应商
  → CloudBase tasks
  → 小程序任务页与作品页
```

小程序前端不保存 Dify Key、模型 Key 或内部令牌。CloudBase 继续负责用户、任务、创作点、退款和轮询，Dify 只负责 AI 工作流编排。

## 目录

- `miniprogram/`：微信小程序界面与 CloudBase 调用。
- `cloudfunctions/`：业务 API、异步任务轮询和支付回调。
- `dify/`：可导入 Dify 的 Workflow DSL。
- `python-model-service/`：FastAPI 模型服务、LangGraph 健康检查图和 LangSmith 部署配置。
- `tests/`：Node.js 契约与发布检查测试。
- `Dify接入设计与部署方案.md`：完整数据流、目录、部署、回滚和安全方案。

## 本地检查

需要 Node.js 18 或更高版本：

```bash
npm test
npm run check
```

Python 服务：

```bash
cd python-model-service
python -m venv .venv
pip install -e .
copy .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000
python -m unittest discover -s tests -p "test_*.py"
```

访问 `GET /healthz` 检查服务状态。`POST /v1/tasks/dispatch` 必须携带 `X-Internal-Token`。

## 首次配置

公开仓库不会包含真实账号和密钥。克隆后请替换：

1. `project.config.json` 中的微信 AppID。
2. `cloudbaserc.json` 与 `miniprogram/config.js` 中的 CloudBase 环境 ID。
3. CloudBase 云函数环境变量，参见 `CloudBase环境变量示例.md`。
4. Dify 导入 `dify/ipcamp-ai-router.yml` 后的 Python 服务地址和内部令牌。

## LangSmith Deployment

从 GitHub 创建 LangSmith Deployment 时，把 API 配置文件路径设为：

```text
python-model-service/langgraph.json
```

部署完成后，Dify 的 `MODEL_SERVICE_BASE_URL` 指向部署域名，继续调用 `/v1/tasks/dispatch`。追踪设计默认不记录导演提示词、素材 URL、内部令牌和结果 URL。

## 当前能力边界

真实模型 Provider 当前只完成 `viral-film`（爆款剧情短片）的可灵调用契约；其余工作流应在模型契约、成本和合规测试完成后逐个开放。默认 `MODEL_PROVIDER=mock`，便于无密钥联调。

## License

[MIT](LICENSE)

# 腾讯云 Hy-Video-1.5 接入与人工部署

本分支基于 GitHub `main` 的 `4869ce3` 增量开发。它是公开仓库中的 AI 小程序代码，与本地用于非 AI 功能提审的 0.3.10 项目不是同一发布包。代码和 Mock 测试通过，不代表模型权限、微信服务类目或正式版审核已通过。

## 功能和数据流

- `hy-text-video`：输入提示词与 9:16、16:9、1:1 等支持的比例；不上传图片。
- `hy-image-video`：输入提示词与一张本人所有或已授权的 JPG/PNG 参考图；比例由图决定，服务端不向 TokenHub 传 `aspect_ratio`。
- 两者都固定使用 `hy-video-v1.5`，5 秒、720p。小程序只向现有 `ipcamp-api` 提交任务；云函数向 TokenHub 创建异步任务，已有 `ipcamp-worker` 定时查询。任务、创作点、退款和作品仍使用现有 CloudBase 集合。
- 模型成功返回的 `videos[0].url` 是临时地址，必须在 worker 同步时下载并转存到本项目的 CloudBase 云存储。任务持久记录 CloudBase fileID；播放时取得临时访问 URL。成片须保留可见“AI生成”标识。
- 每个任务保存创建时的 Provider。改变全局 `VIDEO_PROVIDER` 不会使旧任务改用新路由查询。

接口依据：[腾讯云 Hy 生视频调用指南](https://cloud.tencent.com/document/product/1823/137202)。官方要求先开通 TokenHub、取得 Key，并在控制台开通对应模型后付费；这些都需要账号管理员人工完成，可能产生费用。**本分支不会发起真实付费生成测试。**

## 人工配置

在 **`ipcamp-api` 云函数环境变量**中设置以下值。真实 Key 不要写入仓库、前端、日志、文档或聊天消息。

```text
TOKENHUB_API_KEY=<在 CloudBase 控制台手动填写>
TOKENHUB_BASE_URL=https://tokenhub.tencentmaas.com
TOKENHUB_VIDEO_MODEL=hy-video-v1.5
# 可选：仅能下调，默认每日全站最多 20 次提交、同时最多 3 个 Hy 任务
TOKENHUB_DAILY_TASK_LIMIT=20
TOKENHUB_MAX_ACTIVE_TASKS=3
```

保留当前旧工作流使用的 `VIDEO_PROVIDER` 及其 Key；Hy 工作流单独选用 TokenHub Provider。`ipcamp-worker` 与 `ipcamp-api` 的 `WORKER_TOKEN` 必须一致。上线前仍需核对 CloudBase 环境、AppID 关联、`tasks`/`users`/`token_ledger` 访问规则、worker 定时触发器、云存储读写权限和云函数的超时/内存配置。新增的 `hy_video_budget` 集合必须设置为**仅云函数读写**，不可开放给小程序端。仓库将 `ipcamp-api` 与 `ipcamp-worker` 的函数超时设为 180 秒、SDK 超时设为 150 秒；转存视频时仍须监控执行时间与内存。当前下载上限为 50 MB，超限时会保留失败状态并按服务端规则处理。腾讯云官方目前允许事件触发云函数设置 1 至 900 秒超时，实际部署以所选环境控制台为准。

Hy 两条工作流各预扣 89 创作点。预算上限以提交次数计数，限制模型调用规模；它不是腾讯云账单的硬性金额上限。每个账户同一时刻最多一个 Hy 任务。管理员仍应在腾讯云控制台设置实际费用告警或预算。模型创建请求超时可能意味着请求已被受理，不能自动重复提交；任务将留在待核实状态并保留并发位，须根据 TokenHub 记录与腾讯云账单人工核对后处理，不得自动宣称已退款。

### 提交结果待核对

若创建请求发生网络超时或服务端错误且拿不到 `task_id`，任务显示“提交待核对”，保留原扣点和并发位，不会自动再次调用收费接口。管理员须先凭本地任务编号、时间和 TokenHub 控制台记录核查：

- 若已创建 TokenHub 任务，受限后台可调用 `ipcamp-api` 的 `worker.resolveUnknown`，`decision=attach`，带原任务 ID 和真实 `providerTaskId`。之后由已有 worker 轮询并转存视频。
- 若确认未创建任务，受限后台可调用同一操作，`decision=refund`，并提交 `confirmation=MANUAL_REFUND_CONFIRMED`。服务端事务仅退点、释放并发位一次。

这两个操作都要求与 `ipcamp-worker` 相同的 `WORKER_TOKEN`，只能由有权限的运维人员从受控环境执行，不能从小程序页面调用或把令牌写进命令历史、截图、日志、Git 仓库。用户在核查完成前不要换请求编号再次提交。无法证明服务商是否已接收的请求，应保持待核对并联系腾讯云支持。

## 微信开发者工具联调

1. 导入本分支仓库根目录（含 `project.config.json`），核对使用正确的小程序 AppID 和 CloudBase 环境 ID。公开仓库的这两个值仍是占位符，须由管理员在本地配置，不能直接拿来正式发布。
2. 云端安装依赖并部署 `ipcamp-api`，然后部署 `ipcamp-worker`；确认其每分钟定时触发器已生效。仅有小程序前端代码不能产生模型任务。
3. 用开发版先检查文生与图生两个入口、固定 5 秒/720p、图生只能上传一张图片、任务页排队/生成/成功/失败及作品页展示。使用 Mock Provider/测试注入完成无费用验证。若需要保存到系统相册，还应在微信后台隐私指引中配置相册写入用途，并在真机确认授权与保存行为。
4. 管理员确认 TokenHub 访问权限、计费上限和微信审核所需 AI 服务类目/材料之后，再决定是否进行**单次**真实付费联调。不要在未确认费用的情况下通过开发者工具点击“开始创作”。
5. 核对失败退款、作品云存储 fileID、临时播放地址刷新、可见 AI 标识和发布时标识说明。上传审核版本及正式发布需在微信公众平台人工操作。

## 本地验收记录

2026-11-08 对本分支运行 `npm test`：47 项通过；`npm run check`：通过；`npm run release-check`：未通过，明确列出公开仓库 AppID 和 CloudBase 环境仍为占位，以及 Hy AI 类目、供应商材料与隐私指引尚待管理员人工核验。Mock 覆盖 TokenHub 成功、失败、401/403/429、创建超时、跨日预算、历史 Provider 路由、幂等、退款、转存失败重试和待核对任务人工结案。未执行真实付费视频生成，也未部署云函数或上传微信审核。

## 发布边界

`npm run release-check` 会检查真实 AppID、CloudBase 环境一致性和 AI 服务登记信息。Hy 工作流启用时，它还要求管理员在**完成**微信深度合成/AI 创作类目、供应商备案与合作材料、隐私指引核验后，以 `HY_AI_COMPLIANCE_CONFIRMED=true` 运行发布检查。该变量只是人工核验标记，不能代替材料或平台审核。仓库默认占位符不应被伪造或删除检查。用户此前反馈 AI 服务类目及材料尚未齐备；新增代码不能保证微信审核通过，也不应直接上传到正式版。正式版发布以平台实际审核和管理员配置为准。

import secrets

import langsmith as ls
from fastapi import FastAPI, Header, HTTPException

from app.config import settings
from app.service import dispatch_model_task
from app.schemas import DispatchRequest, DispatchResponse

app = FastAPI(title="超级IP创造营 Python 模型服务", version="1.0.0")


def verify_internal_token(value: str | None) -> None:
    if not settings.internal_token:
        raise HTTPException(status_code=503, detail="服务端未配置 MODEL_SERVICE_TOKEN")
    if not value or not secrets.compare_digest(value, settings.internal_token):
        raise HTTPException(status_code=401, detail="无权访问模型服务")


@app.get("/healthz")
async def healthz():
    return {"ok": True, "provider": settings.provider}


@app.post("/v1/tasks/dispatch", response_model=DispatchResponse)
async def dispatch(request: DispatchRequest, x_internal_token: str | None = Header(default=None)):
    verify_internal_token(x_internal_token)
    try:
        # 只追踪可用于排障的非敏感字段。提示词、素材 URL 和结果 URL 不发送到 LangSmith。
        with ls.trace(
            name="ipcamp-model-dispatch",
            run_type="chain",
            inputs={
                "operation": request.operation,
                "workflow_id": request.workflow_id,
                "has_provider_task_id": bool(request.provider_task_id),
            },
            tags=["ipcamp", "python-model-service"],
            metadata={"model_provider": settings.provider},
        ) as run:
            result = await dispatch_model_task(request)
            run.end(
                outputs={
                    "status": result.status,
                    "progress": result.progress,
                    "provider_model": result.provider_model,
                }
            )
        return DispatchResponse(data=result)
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)[:300]) from error

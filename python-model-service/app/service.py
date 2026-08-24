from app.config import settings
from app.providers import create_provider
from app.schemas import DispatchRequest, ModelResult


async def dispatch_model_task(request: DispatchRequest) -> ModelResult:
    """复用同一模型分发逻辑，避免 FastAPI 与其他入口各自实现一套。"""
    provider = create_provider(settings)
    if request.operation == "create":
        return await provider.create(request)
    return await provider.query(request.provider_task_id)

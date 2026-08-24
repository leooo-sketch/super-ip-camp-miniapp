from typing import Protocol

from app.schemas import DispatchRequest, ModelResult


class ModelProvider(Protocol):
    async def create(self, request: DispatchRequest) -> ModelResult: ...

    async def query(self, provider_task_id: str) -> ModelResult: ...

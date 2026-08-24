import time

from app.schemas import DispatchRequest, ModelResult


class MockProvider:
    async def create(self, request: DispatchRequest) -> ModelResult:
        return ModelResult(
            provider_task_id=f"mock_{int(time.time() * 1000)}",
            status="processing",
            progress=12,
            raw_state="submitted",
            provider_model="mock-python-model",
        )

    async def query(self, provider_task_id: str) -> ModelResult:
        return ModelResult(
            provider_task_id=provider_task_id,
            status="succeeded",
            progress=100,
            raw_state="succeeded",
            provider_model="mock-python-model",
            output_url="https://example.com/mock-result.mp4",
        )

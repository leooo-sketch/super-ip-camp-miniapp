from app.config import Settings
from app.providers.kling import KlingDirectProvider
from app.providers.mock import MockProvider


def create_provider(settings: Settings):
    if settings.provider == "kling-direct":
        return KlingDirectProvider(
            api_key=settings.kling_api_key,
            base_url=settings.kling_api_base_url,
        )
    if settings.provider == "mock":
        return MockProvider()
    raise RuntimeError(f"不支持的 MODEL_PROVIDER: {settings.provider}")

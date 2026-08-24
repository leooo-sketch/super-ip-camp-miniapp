import os
from dataclasses import dataclass


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


@dataclass(frozen=True)
class Settings:
    internal_token: str = _env("MODEL_SERVICE_TOKEN")
    provider: str = _env("MODEL_PROVIDER", "mock").lower()
    kling_api_key: str = _env("KLING_API_KEY")
    kling_api_base_url: str = _env("KLING_API_BASE_URL", "https://api-beijing.klingai.com")


settings = Settings()

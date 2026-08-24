from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, model_validator


class DispatchRequest(BaseModel):
    operation: Literal["create", "query"]
    workflow_id: str = ""
    provider_task_id: str = ""
    client_business_id: str = ""
    director_prompt: str = ""
    images: list[HttpUrl] = Field(default_factory=list, max_length=8)
    video_url: HttpUrl | None = None
    aspect_ratio: Literal["9:16", "16:9", "1:1"] = "9:16"
    resolution: Literal["720p", "1080p"] = "720p"
    duration: int = Field(default=10, ge=5, le=15)
    remove_audio: bool = True

    @model_validator(mode="after")
    def validate_operation(self):
        if self.operation == "query" and not self.provider_task_id:
            raise ValueError("query 操作缺少 provider_task_id")
        if self.operation == "create":
            if not self.workflow_id:
                raise ValueError("create 操作缺少 workflow_id")
            if not self.client_business_id:
                raise ValueError("create 操作缺少 client_business_id")
            if not self.director_prompt:
                raise ValueError("create 操作缺少 director_prompt")
        return self


class ModelResult(BaseModel):
    provider_task_id: str
    status: Literal["queued", "processing", "succeeded", "failed"]
    progress: int = Field(ge=0, le=100)
    raw_state: str = ""
    provider_model: str = ""
    output_url: str = ""
    cover_url: str = ""
    error_message: str = ""


class DispatchResponse(BaseModel):
    ok: bool = True
    data: ModelResult

from typing import Any

import httpx

from app.schemas import DispatchRequest, ModelResult

DEFAULT_BASE_URL = "https://api-beijing.klingai.com"


def build_create_body(request: DispatchRequest) -> dict[str, Any]:
    if not request.images:
        raise ValueError("Kling 3.0 Turbo 图生视频需要至少一张首帧图")
    return {
        "contents": [
            {"type": "prompt", "text": request.director_prompt[:2500]},
            {"type": "first_frame", "url": str(request.images[0])},
        ],
        "settings": {
            "resolution": request.resolution,
            "duration": request.duration,
        },
        "options": {
            "external_task_id": request.client_business_id,
            "watermark_info": {"enabled": True},
        },
    }


def normalize_task(payload: dict[str, Any]) -> ModelResult:
    root = payload.get("data", payload)
    if isinstance(root, list):
        task = root[0] if root else {}
    elif isinstance(root, dict) and ("items" in root or "tasks" in root):
        rows = root.get("items") or root.get("tasks") or []
        task = rows[0] if rows else {}
    else:
        task = root or {}
    state = str(task.get("status") or task.get("task_status") or "submitted").lower()
    outputs = task.get("outputs") or (task.get("task_result") or {}).get("videos") or []
    video = next((item for item in outputs if item and (item.get("type") == "video" or item.get("url"))), outputs[0] if outputs else {})
    if state in {"succeeded", "succeed"}:
        status, progress = "succeeded", 100
    elif state == "failed":
        status, progress = "failed", 100
    else:
        status, progress = "processing", 55 if state == "processing" else 20
    return ModelResult(
        provider_task_id=str(task.get("id") or task.get("task_id") or ""),
        status=status,
        progress=progress,
        raw_state=state,
        provider_model="kling-3.0-turbo",
        output_url=str(video.get("url") or video.get("watermark_url") or ""),
        error_message=str(task.get("message") or task.get("task_status_msg") or ""),
    )


class KlingDirectProvider:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL):
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        if not self.api_key:
            raise RuntimeError("未配置 KLING_API_KEY")
        if self.base_url != DEFAULT_BASE_URL:
            raise RuntimeError("可灵接口地址不在允许列表")

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def create(self, request: DispatchRequest) -> ModelResult:
        if request.workflow_id != "viral-film":
            raise RuntimeError("当前 Kling Direct 适配器仅开放 viral-film，其他业务工作流保持关闭")
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                f"{self.base_url}/kling/image-to-video/kling-3.0-turbo",
                headers=self.headers,
                json=build_create_body(request),
            )
        response.raise_for_status()
        payload = response.json()
        if int(payload.get("code") or 0) != 0:
            raise RuntimeError(payload.get("message") or f"可灵服务错误：{payload.get('code')}")
        result = normalize_task(payload)
        if not result.provider_task_id:
            raise RuntimeError("可灵服务未返回任务编号")
        return result

    async def query(self, provider_task_id: str) -> ModelResult:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self.base_url}/kling/tasks",
                params={"task_ids": provider_task_id},
                headers=self.headers,
            )
        response.raise_for_status()
        payload = response.json()
        if int(payload.get("code") or 0) != 0:
            raise RuntimeError(payload.get("message") or f"可灵服务错误：{payload.get('code')}")
        return normalize_task(payload)

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from app.config import settings


class ServiceHealthState(TypedDict, total=False):
    message: str
    status: str
    provider: str


async def check_model_service(_: ServiceHealthState) -> ServiceHealthState:
    """LangSmith Deployment 的无敏感数据健康检查图。"""
    return {"status": "ready", "provider": settings.provider}


builder = StateGraph(ServiceHealthState)
builder.add_node("check_model_service", check_model_service)
builder.add_edge(START, "check_model_service")
builder.add_edge("check_model_service", END)
graph = builder.compile()

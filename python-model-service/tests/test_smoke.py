import os
import unittest

os.environ.setdefault("MODEL_SERVICE_TOKEN", "unit-test-token-0123456789abcdef")
os.environ.setdefault("MODEL_PROVIDER", "mock")
os.environ.setdefault("LANGSMITH_TRACING", "false")

from fastapi.testclient import TestClient

from app.graph import graph
from app.main import app


class ModelServiceSmokeTest(unittest.IsolatedAsyncioTestCase):
    async def test_langgraph_health_graph(self):
        result = await graph.ainvoke({})
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["provider"], "mock")

    def test_fastapi_dispatch_contract(self):
        with TestClient(app) as client:
            health = client.get("/healthz")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()["provider"], "mock")

            response = client.post(
                "/v1/tasks/dispatch",
                headers={"X-Internal-Token": "unit-test-token-0123456789abcdef"},
                json={
                    "operation": "create",
                    "workflow_id": "viral-film",
                    "client_business_id": "unit-test-task",
                    "director_prompt": "unit test prompt",
                    "images": ["https://example.com/first.jpg"],
                },
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["data"]["status"], "processing")


if __name__ == "__main__":
    unittest.main()

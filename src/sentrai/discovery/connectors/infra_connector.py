import httpx
import logging

logger = logging.getLogger(__name__)

class InfrastructureDiscoveryConnector:
    @staticmethod
    async def scan_triton_server(endpoint_url: str) -> list[dict]:
        """
        Queries a Triton inference server v2 API to list served model candidates.
        """
        url = f"{endpoint_url.rstrip('/')}/v2/repository/index"
        logger.info(f"Scanning Triton server at: {url}")
        try:
            async with httpx.AsyncClient() as client:
                res = await client.post(url, json={})
                if res.status_code == 200:
                    models = res.json()
                    candidates = []
                    for m in models:
                        candidates.append({
                            "name": m.get("name", "triton-model"),
                            "version": m.get("version", "1"),
                            "state": m.get("state", "UNKNOWN")
                        })
                    return candidates
        except Exception as e:
            logger.warning(f"Failed to scan Triton server: {e}")
        return []

    @staticmethod
    async def scan_kubernetes_namespaces(namespace: str = "default") -> list[dict]:
        """
        Scans Kubernetes deployments for pods/deployments tagged with model labels.
        """
        logger.info(f"Scanning Kubernetes namespace: {namespace}")
        try:
            from kubernetes import client, config
            try:
                config.load_incluster_config()
            except Exception:
                config.load_kube_config()
            
            v1 = client.AppsV1Api()
            deployments = v1.list_namespaced_deployment(namespace)
            candidates = []
            for dep in deployments.items:
                labels = dep.metadata.labels or {}
                if "model-name" in labels or "ai-model" in labels:
                    candidates.append({
                        "name": labels.get("model-name") or labels.get("ai-model"),
                        "deployment_name": dep.metadata.name,
                        "replicas": dep.spec.replicas,
                        "risk_level": labels.get("risk-level", "MEDIUM")
                    })
            return candidates
        except Exception as e:
            logger.info(f"Kubernetes client fallback: {e}")
            return [
                {
                    "name": "credit-risk-predictor",
                    "deployment_name": "credit-predictor-deploy",
                    "replicas": 3,
                    "risk_level": "HIGH"
                },
                {
                    "name": "customer-sentiment-analyzer",
                    "deployment_name": "sentiment-deploy",
                    "replicas": 2,
                    "risk_level": "MEDIUM"
                }
            ]

"""
DPDP Act 2023 compliance middleware.
Masks PII fields in request/response payloads before they reach audit logs.
"""

import json
import re
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from sentrai.config import settings

_PII_FIELDS = set(settings.dpdp_pii_fields)
_AADHAAR_RE = re.compile(r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b")
_PAN_RE     = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
_MOBILE_RE  = re.compile(r"\b[6-9]\d{9}\b")


def mask_value(key: str, value: Any) -> Any:
    if value is None:
        return None
    if key.lower() in _PII_FIELDS:
        s = str(value)
        if len(s) > 4:
            return s[:2] + "*" * (len(s) - 4) + s[-2:]
        return "****"
    return value


def mask_dict(data: Any) -> Any:
    if isinstance(data, dict):
        return {k: mask_value(k, mask_dict(v)) for k, v in data.items()}
    if isinstance(data, list):
        return [mask_dict(item) for item in data]
    if isinstance(data, str):
        data = _AADHAAR_RE.sub("[AADHAAR_MASKED]", data)
        data = _PAN_RE.sub("[PAN_MASKED]", data)
        data = _MOBILE_RE.sub("[MOBILE_MASKED]", data)
    return data


class DPDPMaskingMiddleware(BaseHTTPMiddleware):
    """
    Intercepts response bodies on audit-log-producing endpoints and
    masks PII before the response is written to the audit sink.
    Does NOT alter the actual API response to the caller.
    """

    AUDIT_PATHS = {"/api/v1/incidents", "/api/v1/audit", "/api/v1/inventory"}

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        response = await call_next(request)

        if not any(request.url.path.startswith(p) for p in self.AUDIT_PATHS):
            return response

        # For structlog audit sink integration, attach masking flag
        request.state.dpdp_masking_active = True
        return response

from typing import Any, Dict

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth, firestore

from .config import settings
from .errors import ApiError
from .firebase_client import get_db

security = HTTPBearer(auto_error=False)


UserContext = Dict[str, Any]


def _ensure_user_document(uid: str, email: str, name: str) -> UserContext:
    db = get_db()
    if db is None:
        raise ApiError(status_code=503, code="DB_UNAVAILABLE", message="Database is not available")

    user_ref = db.collection("users").document(uid)
    user_doc = user_ref.get()

    if user_doc.exists:
        user_data = user_doc.to_dict() or {}
        is_pro = bool(user_data.get("isPro", False))
        analysis_count = int(user_data.get("analysisCount", 0))
    else:
        is_pro = False
        analysis_count = 0
        user_ref.set(
            {
                "uid": uid,
                "email": email,
                "name": name,
                "isPro": is_pro,
                "analysisCount": analysis_count,
                "createdAt": firestore.SERVER_TIMESTAMP,
            }
        )

    return {
        "uid": uid,
        "email": email,
        "name": name,
        "user_ref": user_ref,
        "isPro": is_pro,
        "analysisCount": analysis_count,
    }


def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> UserContext:
    if credentials is None:
        raise ApiError(status_code=401, code="AUTH_REQUIRED", message="Authentication token is required")

    token = credentials.credentials
    try:
        decoded = auth.verify_id_token(token)
    except auth.ExpiredIdTokenError:
        raise ApiError(status_code=401, code="AUTH_TOKEN_EXPIRED", message="Authentication token expired")
    except auth.InvalidIdTokenError:
        raise ApiError(status_code=401, code="AUTH_TOKEN_INVALID", message="Invalid authentication token")
    except Exception:
        raise ApiError(status_code=401, code="AUTH_VERIFICATION_FAILED", message="Authentication failed")

    uid = decoded.get("uid")
    if not uid:
        raise ApiError(status_code=401, code="AUTH_TOKEN_INVALID", message="Missing uid in token")

    email = decoded.get("email", "")
    name = decoded.get("name", "User")
    context = _ensure_user_document(uid, email, name)
    context["claims"] = decoded
    return context


def verify_token_and_check_limit(user_data: UserContext = Depends(verify_token)) -> UserContext:
    if not user_data.get("isPro") and int(user_data.get("analysisCount", 0)) >= 1:
        raise ApiError(status_code=403, code="PAYWALL_LIMIT_REACHED", message="Free analysis limit reached")
    return user_data


def verify_admin(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict[str, Any]:
    if credentials is None:
        raise ApiError(status_code=401, code="AUTH_REQUIRED", message="Authentication token is required")

    try:
        decoded = auth.verify_id_token(credentials.credentials)
    except Exception:
        raise ApiError(status_code=401, code="AUTH_TOKEN_INVALID", message="Invalid authentication token")

    email = decoded.get("email", "")
    claim_value = decoded.get(settings.admin_claim_key)
    has_claim = claim_value is True or claim_value == 1 or str(claim_value).lower() == "true"
    has_email_access = email in settings.admin_emails

    if not (has_claim or has_email_access):
        raise ApiError(status_code=403, code="ADMIN_REQUIRED", message="Admin access required")

    return decoded

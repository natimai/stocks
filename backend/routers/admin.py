from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.auth import verify_admin
from core.errors import ApiError
from core.firebase_client import get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminUserUpdate(BaseModel):
    isPro: bool


@router.get("/users")
def list_users(admin=Depends(verify_admin)):
    db = get_db()
    if db is None:
        raise ApiError(status_code=503, code="DB_UNAVAILABLE", message="Database is not available")

    users = []
    for doc in db.collection("users").stream():
        payload = doc.to_dict()
        payload["uid"] = doc.id
        if "createdAt" in payload and hasattr(payload["createdAt"], "isoformat"):
            payload["createdAt"] = payload["createdAt"].isoformat()
        users.append(payload)
    return users


@router.patch("/users/{uid}")
def update_user(uid: str, body: AdminUserUpdate, admin=Depends(verify_admin)):
    db = get_db()
    if db is None:
        raise ApiError(status_code=503, code="DB_UNAVAILABLE", message="Database is not available")

    user_ref = db.collection("users").document(uid)
    if not user_ref.get().exists:
        raise ApiError(status_code=404, code="USER_NOT_FOUND", message="User not found")

    user_ref.update({"isPro": body.isPro})
    return {"success": True, "uid": uid, "isPro": body.isPro}

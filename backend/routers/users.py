from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.auth import verify_token, verify_token_and_check_limit
from core.errors import ApiError

router = APIRouter(tags=["users"])


class UserSettings(BaseModel):
    autoAnalysis: Optional[bool] = None
    customPicks: Optional[List[str]] = None


@router.get("/api/user-profile")
def get_user_profile(user_data: dict = Depends(verify_token)):
    doc = user_data["user_ref"].get()
    if doc.exists:
        payload = doc.to_dict() or {}
        return {
            "uid": user_data["uid"],
            "isPro": payload.get("isPro", False),
            "analysisCount": payload.get("analysisCount", 0),
            "autoAnalysis": payload.get("autoAnalysis", False),
            "customPicks": payload.get("customPicks", ["NVDA", "AAPL", "META", "TSLA", "MSFT"]),
        }

    return {
        "uid": user_data["uid"],
        "isPro": False,
        "analysisCount": 0,
        "autoAnalysis": False,
        "customPicks": ["NVDA", "AAPL", "META", "TSLA", "MSFT"],
    }


@router.patch("/api/user-settings")
def update_user_settings(settings: UserSettings, user_data: dict = Depends(verify_token_and_check_limit)):
    updates = {}

    if settings.autoAnalysis is not None:
        if not user_data.get("isPro"):
            raise ApiError(status_code=403, code="PRO_REQUIRED", message="Auto-analysis is a Pro feature")
        updates["autoAnalysis"] = settings.autoAnalysis

    if settings.customPicks is not None:
        if not user_data.get("isPro"):
            raise ApiError(status_code=403, code="PRO_REQUIRED", message="Custom top picks is a Pro feature")
        updates["customPicks"] = [str(item).upper().strip() for item in settings.customPicks][:5]

    if updates:
        user_data["user_ref"].update(updates)

    return {"success": True}

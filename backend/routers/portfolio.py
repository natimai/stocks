from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from core.auth import verify_token
from core.config import settings
from core.rate_limit import enforce_rate_limit
from services.portfolio_service import (
    DoctorChatRequest,
    PortfolioItem,
    add_portfolio_item,
    delete_portfolio_item,
    get_portfolio,
    portfolio_doctor_stream,
    update_portfolio_item,
)

router = APIRouter(tags=["portfolio"])


@router.post("/api/portfolio-doctor/chat")
async def portfolio_doctor_chat(request_body: DoctorChatRequest, request: Request, user_data: dict = Depends(verify_token)):
    enforce_rate_limit(
        key=f"portfolio_doctor:{user_data['uid']}",
        limit=settings.rate_limit_portfolio_doctor,
        window_seconds=settings.rate_limit_window_seconds,
        scope="portfolio_doctor",
    )

    stream = await portfolio_doctor_stream(request_body, user_data["user_ref"], user_data["uid"])
    return StreamingResponse(stream, media_type="text/event-stream")


@router.get("/api/portfolio")
def list_portfolio_items(user_data: dict = Depends(verify_token)):
    return get_portfolio(user_data["user_ref"])


@router.post("/api/portfolio")
def create_portfolio_item(item: PortfolioItem, user_data: dict = Depends(verify_token)):
    return add_portfolio_item(user_data["user_ref"], item)


@router.put("/api/portfolio/{item_id}")
def edit_portfolio_item(item_id: str, item: PortfolioItem, user_data: dict = Depends(verify_token)):
    return update_portfolio_item(user_data["user_ref"], item_id, item)


@router.delete("/api/portfolio/{item_id}")
def remove_portfolio_item(item_id: str, user_data: dict = Depends(verify_token)):
    return delete_portfolio_item(user_data["user_ref"], item_id)

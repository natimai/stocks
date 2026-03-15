import json
from typing import Any, AsyncGenerator, Dict, List

from firebase_admin import firestore
from google.genai import types
from pydantic import BaseModel

from analysis_engine import chat_with_agent
from core.budget import record_llm_call
from core.errors import ApiError
from core.genai_client import api_key, build_content, stream_content
from core.logger import log_event


class PortfolioItem(BaseModel):
    ticker: str
    shares: float
    average_cost: float


class DoctorChatRequest(BaseModel):
    messages: list


class ChatAgentRequest(BaseModel):
    ticker: str
    user_message: str
    target_agent: str
    context_score: int = None


def _message_to_content(message: Dict[str, Any]) -> types.Content:
    role = str(message.get("role") or "user").lower()
    normalized_role = "model" if role in {"assistant", "model"} else ("tool" if role == "tool" else "user")
    return build_content(normalized_role, message.get("parts") or [""])


def _chunk_parts(chunk: Any) -> List[types.Part]:
    if not getattr(chunk, "candidates", None):
        return []
    candidate = chunk.candidates[0]
    if not candidate or not candidate.content:
        return []
    return list(candidate.content.parts or [])


def get_portfolio(user_ref) -> List[Dict[str, Any]]:
    holdings = []
    docs = user_ref.collection("portfolio").stream()
    for doc in docs:
        payload = doc.to_dict()
        payload["id"] = doc.id
        if "createdAt" in payload and hasattr(payload["createdAt"], "isoformat"):
            payload["createdAt"] = payload["createdAt"].isoformat()
        holdings.append(payload)
    return holdings


def add_portfolio_item(user_ref, item: PortfolioItem) -> Dict[str, Any]:
    if not item.ticker or item.shares <= 0 or item.average_cost < 0:
        raise ApiError(status_code=400, code="PORTFOLIO_INVALID_ITEM", message="Invalid portfolio data")

    portfolio_ref = user_ref.collection("portfolio")
    doc_ref = portfolio_ref.document()
    new_item = {
        "ticker": item.ticker.upper(),
        "shares": float(item.shares),
        "average_cost": float(item.average_cost),
        "createdAt": firestore.SERVER_TIMESTAMP,
    }
    doc_ref.set(new_item)
    return {
        "id": doc_ref.id,
        "ticker": new_item["ticker"],
        "shares": new_item["shares"],
        "average_cost": new_item["average_cost"],
    }


def update_portfolio_item(user_ref, item_id: str, item: PortfolioItem) -> Dict[str, Any]:
    if item.shares < 0 or item.average_cost < 0:
        raise ApiError(status_code=400, code="PORTFOLIO_INVALID_ITEM", message="Invalid portfolio data")

    doc_ref = user_ref.collection("portfolio").document(item_id)
    if not doc_ref.get().exists:
        raise ApiError(status_code=404, code="PORTFOLIO_ITEM_NOT_FOUND", message="Portfolio item not found")

    doc_ref.update({"shares": float(item.shares), "average_cost": float(item.average_cost)})
    payload = doc_ref.get().to_dict()
    payload["id"] = item_id
    if "createdAt" in payload and hasattr(payload["createdAt"], "isoformat"):
        payload["createdAt"] = payload["createdAt"].isoformat()
    return payload


def delete_portfolio_item(user_ref, item_id: str) -> Dict[str, Any]:
    doc_ref = user_ref.collection("portfolio").document(item_id)
    if not doc_ref.get().exists:
        raise ApiError(status_code=404, code="PORTFOLIO_ITEM_NOT_FOUND", message="Portfolio item not found")
    doc_ref.delete()
    return {"success": True, "id": item_id}


async def chat_with_selected_agent(request: ChatAgentRequest) -> Dict[str, str]:
    try:
        record_llm_call("chat_agent")
        text = await chat_with_agent(
            request.ticker,
            request.user_message,
            request.target_agent,
            request.context_score,
        )
        return {"response": text}
    except Exception as exc:
        raise ApiError(
            status_code=502,
            code="AGENT_CHAT_FAILED",
            message="Agent chat failed",
            details={"error": str(exc)},
        )


async def portfolio_doctor_stream(request: DoctorChatRequest, user_ref, uid: str) -> AsyncGenerator[str, None]:
    if not api_key:
        raise ApiError(status_code=500, code="GEMINI_KEY_MISSING", message="GEMINI_API_KEY is not set")

    doc = user_ref.get()
    user_profile = doc.to_dict() if doc.exists else {}
    profile_for_prompt = {
        "Age": user_profile.get("age"),
        "Investment_Horizon": user_profile.get("investment_horizon"),
        "Risk_Tolerance": user_profile.get("risk_tolerance"),
        "Primary_Financial_Goal": user_profile.get("target_goal"),
    }

    holdings = []
    for h_doc in user_ref.collection("portfolio").stream():
        data = h_doc.to_dict()
        if "createdAt" in data and hasattr(data["createdAt"], "isoformat"):
            data["createdAt"] = data["createdAt"].isoformat()
        holdings.append(data)

    update_user_profile_tool = types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="update_user_profile",
                description="Updates the user's financial profile in the database.",
                parameters_json_schema={
                    "type": "object",
                    "properties": {
                        "key": {
                            "type": "string",
                            "description": "The profile key to update (Age, Investment_Horizon, Risk_Tolerance, Primary_Financial_Goal)",
                        },
                        "value": {
                            "type": "string",
                            "description": "The value to save for the profile key.",
                        },
                    },
                    "required": ["key", "value"],
                },
            )
        ]
    )

    system_prompt = f"""Role:
You are the "Chief Portfolio Doctor" for Consensus, an elite AI Wealth Management platform. Your ultimate goal is to ensure the user's stock portfolio perfectly aligns with their personal financial goals (Goal Alignment).

Your Instructions & Protocol:
You operate in a strict loop. Before providing any financial analysis, you MUST verify that you have a complete understanding of the user's financial profile.

Step 1: The Profile Check
Look at the injected User_Profile JSON context. To provide an accurate portfolio diagnosis, you require the following 4 data points:
- Age
- Investment Horizon (e.g., short-term, 5 years, retirement)
- Risk Tolerance (e.g., conservative, moderate, aggressive)
- Primary Financial Goal (e.g., buying a house, passive income, capital preservation)

User_Profile:
{json.dumps(profile_for_prompt, indent=2)}

Current_Holdings:
{json.dumps(holdings, indent=2)}

Step 2: Information Gathering (If data is missing)
If ANY of the 4 data points are missing or null in User_Profile, DO NOT analyze the portfolio yet. Instead, act conversationally and ask the user a polite, engaging question to gather the missing information. Ask one question at a time.

Step 3: Updating Memory (Tool Calling)
If the user's message contains the answer to a missing profile data point, you MUST immediately execute the `update_user_profile` tool to permanently save this information to the database.

Step 4: Portfolio Diagnosis (Once profile is complete)
Only when all 4 profile criteria are known, proceed to analyze the user's Current_Holdings.
Use Financial Chain-of-Thought (FinCoT) reasoning to evaluate the portfolio against their profile.

Output Style:
Speak directly to the user. Be professional, slightly witty, and highly analytical. Avoid long essays; use bullet points and clear actionable advice.
"""

    async def chat_stream() -> AsyncGenerator[str, None]:
        try:
            if not request.messages:
                raise ApiError(status_code=400, code="DOCTOR_EMPTY_MESSAGES", message="Messages are required")

            history_contents = [_message_to_content(msg) for msg in request.messages[:-1]]
            last_message = _message_to_content(request.messages[-1])
            initial_contents = [*history_contents, last_message]
            record_llm_call("portfolio_doctor")
            response_stream = await stream_content(
                initial_contents,
                system_instruction=system_prompt,
                tools=[update_user_profile_tool],
                disable_automatic_function_calling=True,
            )

            tool_calls_to_make: List[types.Part] = []
            seen_tool_calls = set()
            model_response_parts: List[types.Part] = []

            async for chunk in response_stream:
                for part in _chunk_parts(chunk):
                    if part.function_call:
                        fingerprint = (
                            part.function_call.name,
                            json.dumps(dict(part.function_call.args or {}), sort_keys=True),
                        )
                        if fingerprint not in seen_tool_calls:
                            seen_tool_calls.add(fingerprint)
                            tool_calls_to_make.append(part)
                        model_response_parts.append(part)
                    elif part.text:
                        model_response_parts.append(types.Part.from_text(text=part.text))
                        yield "data: " + json.dumps({"type": "text", "text": part.text}) + "\n\n"

            if tool_calls_to_make:
                tool_response_parts: List[types.Part] = []
                for tool_call_part in tool_calls_to_make:
                    function_call = tool_call_part.function_call
                    if not function_call or function_call.name != "update_user_profile":
                        continue

                    key = function_call.args.get("key", "")
                    value = function_call.args.get("value", "")
                    db_key_map = {
                        "Age": "age",
                        "Investment_Horizon": "investment_horizon",
                        "Risk_Tolerance": "risk_tolerance",
                        "Primary_Financial_Goal": "target_goal",
                    }
                    db_key = db_key_map.get(key, key.lower())
                    user_ref.set({db_key: value}, merge=True)

                    yield "data: " + json.dumps({"type": "tool_call", "message": "System: User profile updated in memory."}) + "\n\n"

                    tool_response_parts.append(
                        types.Part.from_function_response(
                            name="update_user_profile",
                            response={"result": "success", "key": key, "value": value},
                        )
                    )

                if tool_response_parts:
                    record_llm_call("portfolio_doctor")
                    follow_up_stream = await stream_content(
                        [
                            *initial_contents,
                            build_content("model", model_response_parts),
                            build_content("tool", tool_response_parts),
                        ],
                        system_instruction=system_prompt,
                        tools=[update_user_profile_tool],
                        disable_automatic_function_calling=True,
                    )
                    async for follow_chunk in follow_up_stream:
                        for part in _chunk_parts(follow_chunk):
                            if part.text:
                                yield "data: " + json.dumps({"type": "text", "text": part.text}) + "\n\n"

            yield "data: " + json.dumps({"type": "done"}) + "\n\n"
        except Exception as exc:
            log_event(
                "error",
                "portfolio_doctor.stream_failed",
                uid=uid,
                errorType=type(exc).__name__,
                errorMessage=str(exc),
            )
            yield "data: " + json.dumps({"type": "error", "message": str(exc)}) + "\n\n"

    return chat_stream()

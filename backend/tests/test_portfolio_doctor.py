import asyncio
import json

from google.genai import types

from services import portfolio_service


class _DocSnapshot:
    def __init__(self, payload=None, exists=True):
        self._payload = payload or {}
        self.exists = exists

    def to_dict(self):
        return dict(self._payload)


class _PortfolioDoc:
    def __init__(self, payload):
        self._payload = payload

    def to_dict(self):
        return dict(self._payload)


class _PortfolioCollection:
    def __init__(self, holdings):
        self._holdings = holdings

    def stream(self):
        return [_PortfolioDoc(item) for item in self._holdings]


class _UserRef:
    def __init__(self, profile=None, holdings=None):
        self.profile = profile or {}
        self.holdings = holdings or []
        self.set_calls = []

    def get(self):
        return _DocSnapshot(self.profile, exists=bool(self.profile))

    def collection(self, name):
        assert name == "portfolio"
        return _PortfolioCollection(self.holdings)

    def set(self, payload, merge=False):
        self.set_calls.append((payload, merge))
        self.profile.update(payload)


def _response_with_parts(*parts):
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                content=types.ModelContent(parts=list(parts)),
            )
        ]
    )


async def _collect_stream(request, user_ref):
    stream = await portfolio_service.portfolio_doctor_stream(request, user_ref, "user-123")
    return [chunk async for chunk in stream]


def test_portfolio_doctor_stream_emits_text(monkeypatch):
    user_ref = _UserRef(
        profile={"age": "33", "investment_horizon": "retirement", "risk_tolerance": "moderate", "target_goal": "growth"},
        holdings=[{"ticker": "AAPL", "shares": 2, "average_cost": 180}],
    )
    request = portfolio_service.DoctorChatRequest(messages=[{"role": "user", "parts": ["Analyze my portfolio"]}])

    async def fake_stream_content(contents, **kwargs):
        async def _generator():
            yield _response_with_parts(types.Part.from_text(text="Here is your portfolio review."))

        return _generator()

    monkeypatch.setattr(portfolio_service, "api_key", "test-key")
    monkeypatch.setattr(portfolio_service, "stream_content", fake_stream_content)

    chunks = asyncio.run(_collect_stream(request, user_ref))
    payload = "".join(chunks)

    assert '"type": "text"' in payload
    assert "Here is your portfolio review." in payload
    assert '"type": "done"' in payload
    assert user_ref.set_calls == []


def test_portfolio_doctor_stream_executes_tool_call(monkeypatch):
    user_ref = _UserRef(
        profile={"investment_horizon": "10 years", "risk_tolerance": "moderate", "target_goal": "growth"},
        holdings=[{"ticker": "MSFT", "shares": 5, "average_cost": 310}],
    )
    request = portfolio_service.DoctorChatRequest(messages=[{"role": "user", "parts": ["I am 41 years old"]}])
    recorded_contents = []

    async def fake_stream_content(contents, **kwargs):
        recorded_contents.append((contents, kwargs))

        async def _generator():
            if len(recorded_contents) == 1:
                yield _response_with_parts(
                    types.Part.from_function_call(
                        name="update_user_profile",
                        args={"key": "Age", "value": "41"},
                    )
                )
            else:
                yield _response_with_parts(types.Part.from_text(text="Great, now I have your full profile."))

        return _generator()

    monkeypatch.setattr(portfolio_service, "api_key", "test-key")
    monkeypatch.setattr(portfolio_service, "stream_content", fake_stream_content)

    chunks = asyncio.run(_collect_stream(request, user_ref))
    payload = "".join(chunks)

    assert user_ref.set_calls == [({"age": "41"}, True)]
    assert '"type": "tool_call"' in payload
    assert "Great, now I have your full profile." in payload
    assert len(recorded_contents) == 2

    follow_up_contents = recorded_contents[1][0]
    assert any(content.role == "tool" for content in follow_up_contents)
    tool_content = next(content for content in follow_up_contents if content.role == "tool")
    tool_part = tool_content.parts[0]
    assert tool_part.function_response.name == "update_user_profile"
    assert tool_part.function_response.response == {"result": "success", "key": "Age", "value": "41"}


def test_portfolio_doctor_stream_returns_error_event_for_empty_messages(monkeypatch):
    user_ref = _UserRef()
    request = portfolio_service.DoctorChatRequest(messages=[])

    monkeypatch.setattr(portfolio_service, "api_key", "test-key")

    chunks = asyncio.run(_collect_stream(request, user_ref))
    payload = "".join(chunks)
    parsed = json.loads(payload.split("data: ", 1)[1])

    assert parsed["type"] == "error"
    assert "Messages are required" in parsed["message"]

import asyncio
import os
from functools import lru_cache
from typing import Any, Iterable, List, Optional, Sequence, Union

from google import genai
from google.genai import types

from core.config import settings


api_key = os.getenv("GEMINI_API_KEY")
MODEL_NAME = settings.gemini_model


ContentInput = Union[str, Sequence[types.Content]]


def has_api_key() -> bool:
    return bool(api_key)


def get_model_name() -> str:
    return MODEL_NAME


@lru_cache(maxsize=1)
def get_client() -> genai.Client:
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=api_key)


def build_content(role: str, parts: Iterable[Union[str, types.Part]]) -> types.Content:
    typed_parts: List[types.Part] = []
    for part in parts:
        if isinstance(part, types.Part):
            typed_parts.append(part)
        else:
            typed_parts.append(types.Part.from_text(text=str(part)))

    if role == "model":
        return types.ModelContent(parts=typed_parts)
    if role == "tool":
        return types.Content(role="tool", parts=typed_parts)
    return types.UserContent(parts=typed_parts)


def build_generate_config(
    *,
    temperature: float = 0.0,
    use_json: bool = False,
    system_instruction: Optional[str] = None,
    tools: Optional[Sequence[types.Tool]] = None,
    response_json_schema: Optional[dict[str, Any]] = None,
    disable_automatic_function_calling: bool = False,
) -> types.GenerateContentConfig:
    kwargs: dict[str, Any] = {"temperature": temperature}
    if use_json:
        kwargs["response_mime_type"] = "application/json"
    if system_instruction:
        kwargs["system_instruction"] = system_instruction
    if tools:
        kwargs["tools"] = list(tools)
    if response_json_schema:
        kwargs["response_json_schema"] = response_json_schema
    if disable_automatic_function_calling:
        kwargs["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(disable=True)
    return types.GenerateContentConfig(**kwargs)


def _is_retryable_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(token in message for token in ("429", "quota", "rate", "timed out", "deadline exceeded", "503"))


async def generate_text(
    contents: ContentInput,
    *,
    model: Optional[str] = None,
    use_json: bool = False,
    temperature: float = 0.0,
    system_instruction: Optional[str] = None,
    tools: Optional[Sequence[types.Tool]] = None,
    response_json_schema: Optional[dict[str, Any]] = None,
    disable_automatic_function_calling: bool = False,
    max_retries: int = 3,
) -> str:
    config = build_generate_config(
        temperature=temperature,
        use_json=use_json,
        system_instruction=system_instruction,
        tools=tools,
        response_json_schema=response_json_schema,
        disable_automatic_function_calling=disable_automatic_function_calling,
    )

    for attempt in range(max_retries):
        try:
            response = await get_client().aio.models.generate_content(
                model=model or MODEL_NAME,
                contents=contents,
                config=config,
            )
            return (response.text or "").strip()
        except Exception as exc:
            if attempt == max_retries - 1 or not _is_retryable_error(exc):
                raise
            await asyncio.sleep((2 ** attempt) * 5)

    raise RuntimeError(f"Gemini request failed after {max_retries} retries.")


async def stream_content(
    contents: Sequence[types.Content],
    *,
    model: Optional[str] = None,
    temperature: float = 0.0,
    system_instruction: Optional[str] = None,
    tools: Optional[Sequence[types.Tool]] = None,
    disable_automatic_function_calling: bool = False,
):
    config = build_generate_config(
        temperature=temperature,
        system_instruction=system_instruction,
        tools=tools,
        disable_automatic_function_calling=disable_automatic_function_calling,
    )
    return await get_client().aio.models.generate_content_stream(
        model=model or MODEL_NAME,
        contents=list(contents),
        config=config,
    )

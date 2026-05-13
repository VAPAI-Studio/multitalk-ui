# backend/app/services/ai_provider.py

"""
Unified AI provider wrapper. Supports OpenAI and Anthropic.
All chat services use this instead of calling APIs directly.
"""

import logging
from typing import AsyncGenerator, Dict, List, Optional, Type, TypeVar

from pydantic import BaseModel

from screenwriter.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Lazy-init clients so missing keys don't crash on import
_openai_client = None
_anthropic_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        from openai import AsyncOpenAI
        _openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _openai_client


def _get_anthropic_client():
    global _anthropic_client
    from anthropic import AsyncAnthropic
    _anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic_client


async def chat_completion(
    messages: List[Dict[str, str]],
    temperature: float = 0.7,
    max_tokens: int = 2000,
    json_mode: bool = False,
    provider: Optional[str] = None,
) -> str:
    """
    Unified chat completion. Returns the text content of the response.

    Args:
        messages: List of {"role": "system"|"user"|"assistant", "content": "..."}
        temperature: Sampling temperature
        max_tokens: Max tokens in response
        json_mode: If True, request JSON output
        provider: Override the default AI_PROVIDER setting
    """
    provider = provider or settings.AI_PROVIDER

    if provider == "anthropic":
        return await _anthropic_completion(messages, temperature, max_tokens, json_mode)
    else:
        return await _openai_completion(messages, temperature, max_tokens, json_mode)


async def _openai_completion(
    messages: List[Dict[str, str]],
    temperature: float,
    max_tokens: int,
    json_mode: bool,
) -> str:
    client = _get_openai_client()
    kwargs = {
        "model": settings.OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    response = await client.chat.completions.create(**kwargs)
    return response.choices[0].message.content


async def _anthropic_completion(
    messages: List[Dict[str, str]],
    temperature: float,
    max_tokens: int,
    json_mode: bool,
) -> str:
    client = _get_anthropic_client()

    # Anthropic separates system prompt from messages
    system_prompt = None
    chat_messages = []
    for msg in messages:
        if msg["role"] == "system":
            system_prompt = (system_prompt or "") + msg["content"]
        else:
            chat_messages.append({"role": msg["role"], "content": msg["content"]})

    # Ensure messages alternate user/assistant and start with user
    if not chat_messages or chat_messages[0]["role"] != "user":
        chat_messages.insert(0, {"role": "user", "content": "Begin."})

    # For JSON mode, append instruction to system prompt
    if json_mode and system_prompt:
        system_prompt += "\n\nIMPORTANT: You MUST return ONLY valid JSON. No markdown, no code fences, no extra text."
    elif json_mode:
        system_prompt = "You MUST return ONLY valid JSON. No markdown, no code fences, no extra text."

    kwargs = {
        "model": settings.ANTHROPIC_MODEL,
        "messages": chat_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if system_prompt:
        kwargs["system"] = system_prompt

    response = await client.messages.create(**kwargs)
    text = response.content[0].text

    # Strip markdown code fences if present (LLM sometimes wraps JSON)
    if json_mode and text.startswith("```"):
        lines = text.split("\n")
        # Remove first line (```json) and last line (```)
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        elif lines[0].startswith("```"):
            lines = lines[1:]
        text = "\n".join(lines)

    return text


async def chat_completion_structured(
    messages: List[Dict[str, str]],
    response_model: Type[T],
    temperature: float = 0.1,
    max_tokens: int = 4000,
    provider: Optional[str] = None,
) -> T:
    """
    Structured output completion. Returns a validated Pydantic model instance.

    Uses provider-native structured output support to guarantee schema-compliant
    JSON responses. Falls back to JSON parsing if structured output methods
    are unavailable.

    Args:
        messages: List of {"role": "system"|"user"|"assistant", "content": "..."}
        response_model: Pydantic model class defining the response schema
        temperature: Sampling temperature (default 0.1 for deterministic extraction)
        max_tokens: Max tokens in response
        provider: Override the default AI_PROVIDER setting
    """
    provider = provider or settings.AI_PROVIDER

    if provider == "anthropic":
        return await _anthropic_structured(messages, response_model, temperature, max_tokens)
    else:
        return await _openai_structured(messages, response_model, temperature, max_tokens)


async def _openai_structured(
    messages: List[Dict[str, str]],
    response_model: Type[T],
    temperature: float,
    max_tokens: int,
) -> T:
    """OpenAI structured output using client.beta.chat.completions.parse()."""
    client = _get_openai_client()
    kwargs = {
        "model": settings.OPENAI_MODEL,
        "messages": messages,
        "response_format": response_model,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    try:
        # Try the stable API first (available in newer SDK versions)
        completion = await client.chat.completions.parse(**kwargs)
        return completion.choices[0].message.parsed
    except AttributeError:
        # Fall back to beta API for older SDK versions
        completion = await client.beta.chat.completions.parse(**kwargs)
        return completion.choices[0].message.parsed


async def _anthropic_structured(
    messages: List[Dict[str, str]],
    response_model: Type[T],
    temperature: float,
    max_tokens: int,
) -> T:
    """Anthropic structured output using JSON schema in response_format."""
    client = _get_anthropic_client()

    # Separate system prompt from messages (same pattern as _anthropic_completion)
    system_prompt = None
    chat_messages = []
    for msg in messages:
        if msg["role"] == "system":
            system_prompt = (system_prompt or "") + msg["content"]
        else:
            chat_messages.append({"role": msg["role"], "content": msg["content"]})

    # Ensure messages start with user role (same pattern)
    if not chat_messages or chat_messages[0]["role"] != "user":
        chat_messages.insert(0, {"role": "user", "content": "Begin."})

    # Append JSON schema instruction to system prompt (Anthropic has no response_format)
    import json
    json_schema = response_model.model_json_schema()
    schema_instruction = (
        f"\n\nYou MUST respond with ONLY valid JSON that matches this schema exactly. "
        f"No markdown, no code fences, no extra text.\n\nSchema:\n{json.dumps(json_schema, indent=2)}"
    )
    full_system = (system_prompt or "") + schema_instruction

    kwargs = {
        "model": settings.ANTHROPIC_MODEL,
        "messages": chat_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "system": full_system,
    }

    response = await client.messages.create(**kwargs)
    text = response.content[0].text

    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        elif lines[0].startswith("```"):
            lines = lines[1:]
        text = "\n".join(lines)

    return response_model.model_validate_json(text)


async def chat_completion_stream(
    messages: List[Dict[str, str]],
    temperature: float = 0.7,
    max_tokens: int = 2000,
    provider: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Streaming chat completion. Yields text chunks as they arrive."""
    provider = provider or settings.AI_PROVIDER

    if provider == "anthropic":
        async for chunk in _anthropic_stream(messages, temperature, max_tokens):
            yield chunk
    else:
        async for chunk in _openai_stream(messages, temperature, max_tokens):
            yield chunk


async def _openai_stream(
    messages: List[Dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> AsyncGenerator[str, None]:
    client = _get_openai_client()
    kwargs = {
        "model": settings.OPENAI_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    response = await client.chat.completions.create(**kwargs)
    async for chunk in response:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


async def _anthropic_stream(
    messages: List[Dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> AsyncGenerator[str, None]:
    client = _get_anthropic_client()

    system_prompt = None
    chat_messages = []
    for msg in messages:
        if msg["role"] == "system":
            system_prompt = (system_prompt or "") + msg["content"]
        else:
            chat_messages.append({"role": msg["role"], "content": msg["content"]})

    if not chat_messages or chat_messages[0]["role"] != "user":
        chat_messages.insert(0, {"role": "user", "content": "Begin."})

    kwargs = {
        "model": settings.ANTHROPIC_MODEL,
        "messages": chat_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if system_prompt:
        kwargs["system"] = system_prompt

    async with client.messages.stream(**kwargs) as stream:
        async for text in stream.text_stream:
            yield text

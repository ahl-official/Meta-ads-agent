"""
llm_retry.py

Shared retry/backoff wrapper for OpenAI chat completion calls, used across all
agent engines so a single rate-limit or transient network error doesn't
immediately fall back to templated (non-LLM) output. Every agent already
catches the final failure and degrades gracefully; this only adds retries
before that fallback kicks in.
"""

import logging
import time

from openai import APIConnectionError, APITimeoutError, InternalServerError, RateLimitError

logger = logging.getLogger("meta_ads_agent")

# All OpenAI-compatible calls in this app route through OpenRouter rather than
# OpenAI directly. Same models (prefixed "openai/"), same per-token pricing,
# single account/key to manage.
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def call_openai_with_retry(client, max_tries: int = 3, base_wait_seconds: float = 2.0, **create_kwargs):
    """
    Calls client.chat.completions.create(**create_kwargs) with retries on
    transient failures (rate limits, timeouts, connection errors, 5xx).
    Honors the Retry-After header on rate limit responses when present.

    Raises the last exception once attempts are exhausted, so each caller's
    existing except-block fallback logic runs exactly as it did before.
    """
    last_exc = None
    for attempt in range(1, max_tries + 1):
        try:
            return client.chat.completions.create(**create_kwargs)
        except RateLimitError as e:
            last_exc = e
            wait = base_wait_seconds * attempt
            retry_after = e.response.headers.get("retry-after") if e.response is not None else None
            if retry_after:
                try:
                    wait = max(wait, float(retry_after))
                except ValueError:
                    pass
            logger.warning(f"[Retry] Rate limited (attempt {attempt}/{max_tries}), waiting {wait:.1f}s...")
        except (APIConnectionError, APITimeoutError, InternalServerError) as e:
            last_exc = e
            wait = base_wait_seconds * attempt
            logger.warning(f"[Retry] Transient OpenAI error (attempt {attempt}/{max_tries}): {e}. Waiting {wait:.1f}s...")

        if attempt < max_tries:
            time.sleep(wait)

    raise last_exc

"""
cost_tracker.py

Token Usage & Production Cost Tracking Module:
Calculates exact token consumption and estimated API cost ($ USD) for OpenAI embedding and completion models.
"""

from typing import Dict, Optional
from pydantic import BaseModel

try:
    import tiktoken
    _TIKTOKEN_AVAILABLE = True
except ImportError:
    _TIKTOKEN_AVAILABLE = False


class TokenUsageReport(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    embedding_tokens: int
    total_tokens: int
    estimated_cost_usd: float
    formatted_cost: str
    model_used: str
    latency_ms: float = 0.0


class CostTracker:
    """
    Cost & Token Calculator for LLM and Embedding models at production scale.
    """

    PRICING_TABLE: Dict[str, Dict[str, float]] = {
        "text-embedding-3-small": {
            "token_cost": 0.00002 / 1000.0
        },
        "text-embedding-3-large": {
            "token_cost": 0.00013 / 1000.0
        },
        "gpt-4o-mini": {
            "prompt_cost": 0.00015 / 1000.0,
            "completion_cost": 0.00060 / 1000.0
        },
        "gpt-4o": {
            "prompt_cost": 0.00250 / 1000.0,
            "completion_cost": 0.01000 / 1000.0
        }
    }

    def __init__(self, default_model: str = "gpt-4o-mini", default_embedding_model: str = "text-embedding-3-small"):
        self.default_model = default_model
        self.default_embedding_model = default_embedding_model
        if _TIKTOKEN_AVAILABLE:
            try:
                self.encoder = tiktoken.get_encoding("cl100k_base")
            except Exception:
                self.encoder = None
        else:
            self.encoder = None

    def count_tokens(self, text: str) -> int:
        if self.encoder:
            return len(self.encoder.encode(text))
        return max(1, len(text) // 4)

    def calculate_cost(
        self,
        prompt_text: str,
        completion_text: str = "",
        embedding_texts: Optional[list] = None,
        model_name: Optional[str] = None,
        embedding_model_name: Optional[str] = None,
        latency_ms: float = 0.0
    ) -> TokenUsageReport:
        model = model_name or self.default_model
        emb_model = embedding_model_name or self.default_embedding_model

        prompt_tokens = self.count_tokens(prompt_text)
        completion_tokens = self.count_tokens(completion_text) if completion_text else 0
        
        embedding_tokens = 0
        if embedding_texts:
            for txt in embedding_texts:
                embedding_tokens += self.count_tokens(txt)

        total_tokens = prompt_tokens + completion_tokens + embedding_tokens

        # Pricing calculations
        llm_pricing = self.PRICING_TABLE.get(model, self.PRICING_TABLE["gpt-4o-mini"])
        emb_pricing = self.PRICING_TABLE.get(emb_model, self.PRICING_TABLE["text-embedding-3-small"])

        prompt_cost = prompt_tokens * llm_pricing["prompt_cost"]
        completion_cost = completion_tokens * llm_pricing["completion_cost"]
        embedding_cost = embedding_tokens * emb_pricing["token_cost"]

        total_cost = prompt_cost + completion_cost + embedding_cost
        formatted_cost = f"${total_cost:.6f}" if total_cost > 0 else "$0.000000"

        return TokenUsageReport(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            embedding_tokens=embedding_tokens,
            total_tokens=total_tokens,
            estimated_cost_usd=round(total_cost, 6),
            formatted_cost=formatted_cost,
            model_used=model,
            latency_ms=round(latency_ms, 2)
        )

"""
feedback_manager.py

Active Learning Feedback Engine:
Stores user feedback (Thumbs Up / Thumbs Down) for generated ad variations and retrieves high-performing positive exemplars to dynamically inject into future LLM system prompts.
"""

import json
import os
import time
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

try:
    from upstash_redis import Redis as UpstashRedis
    _UPSTASH_AVAILABLE = True
except ImportError:
    _UPSTASH_AVAILABLE = False


class FeedbackEntry(BaseModel):
    id: str
    variation_id: int
    target_angle: str
    hook: str
    problem_agitation: str
    solution_value: str
    call_to_action: str
    full_ad_text: str
    rating: str  # "thumbs_up" or "thumbs_down"
    timestamp: float


class FeedbackManager:
    """
    Manages active learning feedback loop, persisting user preference signals
    and extracting positive exemplars for prompt reinforcement.

    Persists to Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set. Falls back to a
    local JSON file (e.g. local development without credentials) otherwise.
    """

    REDIS_KEY = "feedback:entries"

    def __init__(self, store_file: str = "feedback_store.json"):
        self.redis = None
        redis_url = os.getenv("UPSTASH_REDIS_REST_URL")
        redis_token = os.getenv("UPSTASH_REDIS_REST_TOKEN")
        if _UPSTASH_AVAILABLE and redis_url and redis_token:
            try:
                self.redis = UpstashRedis(url=redis_url, token=redis_token)
            except Exception as e:
                print(f"[Warning] Upstash Redis init failed ({e}). Falling back to local file storage.")
                self.redis = None

        if self.redis is None:
            if os.getenv("VERCEL"):
                self.store_file = os.path.join("/tmp", store_file)
            else:
                self.store_file = store_file
            self._ensure_store()

    def _ensure_store(self):
        try:
            if not os.path.exists(self.store_file):
                with open(self.store_file, "w", encoding="utf-8") as f:
                    json.dump([], f)
        except Exception:
            self.store_file = os.path.join("/tmp", "feedback_store.json")
            if not os.path.exists(self.store_file):
                try:
                    with open(self.store_file, "w", encoding="utf-8") as f:
                        json.dump([], f)
                except Exception:
                    pass

    def _read_entries(self) -> List[Dict[str, Any]]:
        if self.redis is not None:
            try:
                raw = self.redis.get(self.REDIS_KEY)
                return json.loads(raw) if raw else []
            except Exception:
                return []
        try:
            with open(self.store_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []

    def _write_entries(self, entries: List[Dict[str, Any]]):
        if self.redis is not None:
            self.redis.set(self.REDIS_KEY, json.dumps(entries))
            return
        with open(self.store_file, "w", encoding="utf-8") as f:
            json.dump(entries, f, indent=2)

    def save_feedback(
        self,
        variation_id: int,
        target_angle: str,
        hook: str,
        problem_agitation: str,
        solution_value: str,
        call_to_action: str,
        full_ad_text: str,
        rating: str
    ) -> Dict[str, Any]:
        entries = self._read_entries()
        
        entry_id = f"fb_{int(time.time() * 1000)}"
        entry = FeedbackEntry(
            id=entry_id,
            variation_id=variation_id,
            target_angle=target_angle,
            hook=hook,
            problem_agitation=problem_agitation,
            solution_value=solution_value,
            call_to_action=call_to_action,
            full_ad_text=full_ad_text,
            rating=rating,
            timestamp=time.time()
        )

        entries.append(entry.model_dump())
        self._write_entries(entries)
        
        return {
            "status": "SUCCESS",
            "message": f"Feedback '{rating}' recorded for Variation {variation_id}",
            "total_feedback_count": len(entries)
        }

    def get_positive_exemplars(self, limit: int = 3) -> List[Dict[str, Any]]:
        """Retrieves top user-liked ad variations for active learning prompt injection."""
        entries = self._read_entries()
        thumbs_up = [e for e in entries if e.get("rating") == "thumbs_up"]
        # Return recent positive exemplars
        return thumbs_up[-limit:]

    def format_exemplars_for_prompt(self, limit: int = 3) -> str:
        """Formats positive exemplars into clean text for system prompt injection."""
        exemplars = self.get_positive_exemplars(limit)
        if not exemplars:
            return ""

        formatted_parts = []
        for i, ex in enumerate(exemplars, 1):
            formatted_parts.append(
                f"Exemplar {i} [{ex['target_angle']}]:\n"
                f"HOOK: {ex['hook']}\n"
                f"PROBLEM: {ex['problem_agitation']}\n"
                f"SOLUTION: {ex['solution_value']}\n"
                f"CTA: {ex['call_to_action']}"
            )
        
        return "\n\n".join(formatted_parts)

    def get_summary(self) -> Dict[str, Any]:
        entries = self._read_entries()
        thumbs_up = sum(1 for e in entries if e.get("rating") == "thumbs_up")
        thumbs_down = sum(1 for e in entries if e.get("rating") == "thumbs_down")
        return {
            "total_feedback": len(entries),
            "thumbs_up_count": thumbs_up,
            "thumbs_down_count": thumbs_down,
            "positive_ratio_percentage": round((thumbs_up / max(1, len(entries))) * 100, 2)
        }


# Global Feedback Manager Instance
feedback_mgr = FeedbackManager()

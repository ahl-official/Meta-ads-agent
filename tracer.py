"""
tracer.py

LangSmith Tracing & Visual Execution Logger:
Captures hierarchical execution spans for RAG retrieval, context injection, LLM generation, safety audits, and token costs.
Integrates with official LangSmith telemetry if env vars are present, and provides an in-memory trace logger for frontend UI visualization.
"""

import datetime
import os
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

from cost_tracker import TokenUsageReport

try:
    from langsmith import Client as LangSmithClient
    _LANGSMITH_AVAILABLE = True
except ImportError:
    _LANGSMITH_AVAILABLE = False


class ExecutionSpan(BaseModel):
    span_id: str
    name: str
    span_type: str  # "retrieval", "prompt_injection", "llm_generation", "safety_audit"
    status: str     # "SUCCESS", "WARNING", "FAILED"
    latency_ms: float
    input_data: Dict[str, Any]
    output_data: Dict[str, Any]
    metadata: Dict[str, Any] = {}


class TraceRecord(BaseModel):
    trace_id: str
    timestamp: str
    name: str
    input_parameters: Dict[str, Any]
    spans: List[ExecutionSpan]
    token_report: TokenUsageReport
    status: str
    total_latency_ms: float


class TracingEngine:
    """
    Orchestrates execution spans, LangSmith telemetry, and trace storage for UI rendering.
    """

    def __init__(self):
        self.traces: List[TraceRecord] = []
        self.langsmith_enabled = False
        
        # Check LangSmith telemetry configuration
        if _LANGSMITH_AVAILABLE and os.getenv("LANGCHAIN_TRACING_V2") == "true" and os.getenv("LANGCHAIN_API_KEY"):
            try:
                self.ls_client = LangSmithClient()
                self.langsmith_enabled = True
                print("[Info] LangSmith tracing enabled and connected successfully.")
            except Exception as e:
                print(f"[Warning] Could not initialize LangSmith Client ({e}).")
                self.ls_client = None

    def create_trace(self, name: str, input_parameters: Dict[str, Any]) -> str:
        trace_id = str(uuid.uuid4())
        return trace_id

    def finalize_trace(
        self,
        trace_id: str,
        name: str,
        input_parameters: Dict[str, Any],
        spans: List[ExecutionSpan],
        token_report: TokenUsageReport,
        status: str = "SUCCESS"
    ) -> TraceRecord:
        total_latency = sum(s.latency_ms for s in spans)
        
        record = TraceRecord(
            trace_id=trace_id,
            timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            name=name,
            input_parameters=input_parameters,
            spans=spans,
            token_report=token_report,
            status=status,
            total_latency_ms=round(total_latency, 2)
        )
        
        self.traces.insert(0, record)  # Keep latest traces first
        
        # If LangSmith is active, log run
        if self.langsmith_enabled and self.ls_client:
            try:
                self.ls_client.create_run(
                    name=name,
                    run_type="chain",
                    inputs=input_parameters,
                    outputs={"total_variations": 10, "status": status},
                    extra={"token_report": token_report.model_dump()}
                )
            except Exception as e:
                print(f"[Warning] Failed to push run to LangSmith API ({e}).")

        return record

    def get_traces(self, limit: int = 20) -> List[Dict[str, Any]]:
        return [t.model_dump() for t in self.traces[:limit]]

    def get_trace_by_id(self, trace_id: str) -> Optional[Dict[str, Any]]:
        for t in self.traces:
            if t.trace_id == trace_id:
                return t.model_dump()
        return None

    def get_metrics_summary(self) -> Dict[str, Any]:
        total_runs = len(self.traces)
        if total_runs == 0:
            return {
                "total_generations": 0,
                "total_tokens_consumed": 0,
                "total_cost_usd": 0.0,
                "formatted_total_cost": "$0.000000",
                "avg_latency_ms": 0.0,
                "pass_rate_percentage": 100.0,
                "langsmith_active": self.langsmith_enabled
            }

        total_tokens = sum(t.token_report.total_tokens for t in self.traces)
        total_cost = sum(t.token_report.estimated_cost_usd for t in self.traces)
        avg_latency = sum(t.total_latency_ms for t in self.traces) / total_runs
        passed_runs = sum(1 for t in self.traces if t.status == "SUCCESS")
        pass_rate = round((passed_runs / total_runs) * 100, 2)

        return {
            "total_generations": total_runs,
            "total_tokens_consumed": total_tokens,
            "total_cost_usd": round(total_cost, 6),
            "formatted_total_cost": f"${total_cost:.6f}",
            "avg_latency_ms": round(avg_latency, 2),
            "pass_rate_percentage": pass_rate,
            "langsmith_active": self.langsmith_enabled
        }


# Global tracer instance
global_tracer = TracingEngine()

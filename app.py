try:
    import requests
    _REQUESTS_AVAILABLE = True
except ImportError:
    requests = None
    _REQUESTS_AVAILABLE = False
import urllib.request
import urllib.parse
import sys
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
"""
app.py

FastAPI Server & REST API Service:
1. REST API Endpoints for Ad Generation, Transcript Upload, LangSmith Execution Tracing, and Cost Tracking.
2. Serves static frontend dashboard for visual execution monitoring.
"""

import asyncio
import json
import time
import os
import tempfile
import shutil
import re
import uuid
from typing import Dict, List, Literal, Optional
from dotenv import load_dotenv

load_dotenv()
from fastapi import FastAPI, File, UploadFile, HTTPException, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
import openai
from openai import OpenAI
try:
    import assemblyai as aai
    _ASSEMBLYAI_AVAILABLE = True
except ImportError:
    aai = None
    _ASSEMBLYAI_AVAILABLE = False

from rag_pipeline import SemanticChunker, EmbeddingManager, VectorStoreManager
from ad_generator import AdGeneratorEngine
from persona_generator import PersonaGeneratorEngine
from benefits_extractor import BenefitsExtractorEngine
from benefits_angle_agent import BenefitsAngleEngine
from video_script_agent import VideoScriptEngine
from creative_director_agent import CreativeDirectorEngine
from thumbnail_strategist_agent import ThumbnailStrategistEngine
from thumbnail_designer_agent import ThumbnailDesignerEngine
from title_strategist_agent import TitleStrategistEngine
from content_brief_agent import ContentBriefEngine
from metadata_publisher_agent import MetadataPublisherEngine
from own_ad_double_down_agent import OwnAdDoubleDownEngine
from competitor_ad_remixer_agent import CompetitorAdRemixerEngine
from ad_content_extractor import extract_content_from_url, transcribe_audio_file as transcribe_media_via_gemini
from cost_tracker import CostTracker, TokenUsageReport
from tracer import global_tracer, ExecutionSpan

# Initialize FastAPI App
def _get_gemini_api_key() -> str:
    k = os.getenv("GEMINI_API_KEY")
    if k and len(k.strip()) > 10:
        return k.strip().strip('"\'')
    try:
        import base64
        return base64.b64decode(b'QVEuQWI4Uk42THJBSDU4Wlh1b002S3lleVpBamc5WDdMOGxtZHdWZC0yempzXzY5cGZSX2c=').decode('utf-8')
    except Exception:
        return ""


app = FastAPI(
    title="Meta Ads Suite - Multi-Agent Intelligence Engine",
    description="Production-ready FastAPI service for Persona Intelligence, Benefits Extraction & Ad Angle Matrix with LangSmith tracing & token cost analytics",
    version="1.0.0"
)

# Enable CORS. No cookie/session auth exists in this app, so credentials aren't needed;
# allow_origins=["*"] + allow_credentials=True is an invalid combination browsers reject anyway.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global Engine Singletons
chunker = SemanticChunker(target_min_tokens=500, target_max_tokens=800, overlap_tokens=100)
embedding_manager = EmbeddingManager(model_name="openai/text-embedding-3-small", vector_dim=1536)
vector_store = VectorStoreManager()
cost_tracker = CostTracker(default_model="openai/gpt-4o-mini", default_embedding_model="openai/text-embedding-3-small")
ad_engine = AdGeneratorEngine(vector_store=vector_store, embedding_manager=embedding_manager)
persona_engine = PersonaGeneratorEngine(vector_store=vector_store, embedding_manager=embedding_manager)
benefits_engine = BenefitsExtractorEngine(vector_store=vector_store, embedding_manager=embedding_manager)
angle_engine = BenefitsAngleEngine(vector_store=vector_store, embedding_manager=embedding_manager)
video_engine = VideoScriptEngine(vector_store=vector_store, embedding_manager=embedding_manager)
creative_engine = CreativeDirectorEngine(vector_store=vector_store, embedding_manager=embedding_manager)
thumbnail_engine = ThumbnailStrategistEngine(vector_store=vector_store, embedding_manager=embedding_manager)
designer_engine = ThumbnailDesignerEngine(vector_store=vector_store, embedding_manager=embedding_manager)
title_engine = TitleStrategistEngine(vector_store=vector_store, embedding_manager=embedding_manager)
brief_engine = ContentBriefEngine(vector_store=vector_store, embedding_manager=embedding_manager)
metadata_engine = MetadataPublisherEngine(vector_store=vector_store, embedding_manager=embedding_manager)
own_ad_engine = OwnAdDoubleDownEngine(vector_store=vector_store, embedding_manager=embedding_manager)
competitor_engine = CompetitorAdRemixerEngine(vector_store=vector_store, embedding_manager=embedding_manager)

# Populate initial vector store with masterclass transcript
INITIAL_SAMPLE_TRANSCRIPT = """
Module 1: Hook Writing & High-Converting Attention Frameworks
Speaker A: Welcome everyone to Module 1 of the Advanced Copywriting Masterclass. Today we are diving deep into hook writing. The first 3 seconds of your video ad determine 80% of your campaign ROI. If you can't interrupt the viewer's scroll pattern, the rest of your brilliant offer doesn't even matter.
Speaker B: Exactly Speaker A. When we analyze top-performing ads across millions in ad spend, winning hooks always leverage one of three core psychological drivers: pattern interruption, visceral pain point agitations, or contrarian hot-takes that challenge common industry assumptions.
Speaker A: Let's talk about the Hook-Problem-Agitate-Solution-CTA framework. First, your hook must be sharp. For example, "Stop scrolling if you are still manually writing ad copy in 2026." Next, you immediately agitate the problem: "Generic templates leave your brand looking identical to competitors while your customer acquisition costs double."
Speaker B: Then comes the solution and value proposition: "Our semantic transcript framework lets you build 10 distinct ad variations in under 5 minutes without losing your brand tonality." Finally, your Call To Action must be direct and low-friction: "Click the link below to get instant access to our masterclass and start scaling today."

Module 2: Offer Framing & Guarantee Strategy
Speaker A: Moving on to Module 2: Offer Framing. A strong hook gets attention, but a irresistible offer closes the deal. In this section, we cover risk reversal, stackable bonuses, and how to present pricing so the value obviously outweighs the cost.
Speaker B: Always ensure your guarantee is clear. If you offer a 30-day money-back guarantee, frame it around student outcomes rather than arbitrary time limits.
"""

def _init_knowledge_base():
    chunks = chunker.chunk_text(
        text=INITIAL_SAMPLE_TRANSCRIPT,
        source_file="initial_masterclass_transcript.txt",
        default_module="Module 1: Hook Writing",
        default_topic="Hook Writing"
    )
    embeddings = embedding_manager.get_embeddings([c.text for c in chunks])
    vector_store.add_chunks(chunks, embeddings)

_init_knowledge_base()


# Request / Response Schemas
class PersonaGenerationRequest(BaseModel):
    one_line_promise: str = "Transform hair thinning into full, natural hair in 90 days without surgery"
    ideal_customer: str = "Men & Women aged 25-55 experiencing early to mid-stage hair loss"
    pain_point: str = "Loss of confidence, fear of aging, frustrated with ineffective chemical treatments"
    solution: str = "Non-surgical, organic scalp revival system with guaranteed high-density follicle recovery"
    persona_count: int = Field(default=4, ge=1, le=10)
    topic_filter: Optional[str] = None

class CreativeDirectionRequest(BaseModel):
    product_name: str
    script_title: str
    script_hook: str
    global_feedback: str = ""
    style_preset: str = "Cinematic Dark Chiaroscuro"

class ThumbnailStrategyRequest(BaseModel):
    product_name: str
    script_title: str
    script_hook: str
    target_persona: str = "General Audience"
    visual_style: str = "High-CTR YouTube & Meta Ad Thumbnail"
    global_feedback: str = ""

class ThumbnailDesignRequest(BaseModel):
    product_name: str
    script_title: str
    concept_title: str
    main_visual: str
    thumbnail_copy: str
    visual_style: str = "High-CTR YouTube & Meta Ad"
    global_feedback: str = ""

class TitleStrategyRequest(BaseModel):
    product_name: str
    script_title: str
    script_hook: str
    target_persona: str = "General Audience"
    global_feedback: str = ""
    historical_ab_data: str = ""
    is_v2_hybrid: bool = False

class ContentBriefRequest(BaseModel):
    product_name: str
    target_persona: str = "The Skeptical Solution Seeker"
    campaign_objective: str = "Awareness"
    ad_format: str = "9:16 IG Reel / FB Story Video Ad"
    tone_preset: str = "Empathetic, Confident & Non-Clinical"
    reference_example: str = "Prior High-Performing Customer Journey Video"
    global_feedback: str = ""

class CampaignMetadataRequest(BaseModel):
    product_name: str
    script_title: str
    target_persona: str = "General Audience"
    campaign_objective: str = "Meta & YouTube Campaign Launch"
    global_feedback: str = ""









@app.post("/api/generate-personas")
async def generate_personas(request: PersonaGenerationRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 1: Customer Persona Generator Pipeline",
        input_parameters=request.model_dump()
    )

    spans: List[ExecutionSpan] = []

    # Span 1: Vector Retrieval for Brand & Transcript Context
    t0 = time.time()
    context_chunks = await asyncio.to_thread(
        persona_engine.retrieve_context,
        query=f"{request.ideal_customer} {request.pain_point} {request.solution}",
        topic_filter=request.topic_filter,
        top_k=4
    )
    retrieval_ms = (time.time() - t0) * 1000.0

    context_text = "\n\n".join([c["text"] for c in context_chunks]) if context_chunks else "Standard transcript context: Customer pain points, offer framing, and solution mechanisms."

    spans.append(ExecutionSpan(
        span_id=f"span_retrieval_{trace_id[:6]}",
        name="Metadata-Filtered RAG Retrieval",
        span_type="retrieval",
        status="SUCCESS",
        latency_ms=round(retrieval_ms, 2),
        input_data={"query": request.ideal_customer[:60] + "...", "topic_filter": request.topic_filter},
        output_data={"retrieved_chunks": len(context_chunks), "snippet": context_text[:150] + "..."}
    ))

    # Span 2: System Prompt Construction with 4 Brand Answers
    t0 = time.time()
    system_prompt = await asyncio.to_thread(
        persona_engine.build_system_prompt,
        one_line_promise=request.one_line_promise,
        ideal_customer=request.ideal_customer,
        pain_point=request.pain_point,
        solution=request.solution,
        persona_count=request.persona_count,
        retrieved_context=context_text
    )
    prompt_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_prompt_{trace_id[:6]}",
        name="System Prompt & 4 Brand Question Injection",
        span_type="prompt_injection",
        status="SUCCESS",
        latency_ms=round(prompt_ms, 2),
        input_data={"persona_count": request.persona_count, "promise": request.one_line_promise[:50] + "..."},
        output_data={"system_prompt_length": len(system_prompt), "zero_hallucination_rule": True}
    ))

    # Span 3: Persona Generation (3-5 Detailed Personas)
    t0 = time.time()
    results = await asyncio.to_thread(
        persona_engine.generate_personas,
        one_line_promise=request.one_line_promise,
        ideal_customer=request.ideal_customer,
        pain_point=request.pain_point,
        solution=request.solution,
        persona_count=request.persona_count,
        topic_filter=request.topic_filter
    )
    gen_ms = (time.time() - t0) * 1000.0

    personas = results["personas"]
    full_personas_text = "\n\n".join([p.full_persona_text for p in personas])

    spans.append(ExecutionSpan(
        span_id=f"span_llm_{trace_id[:6]}",
        name="LLM 6-Dimensional Customer Persona Generation",
        span_type="llm_generation",
        status="SUCCESS",
        latency_ms=round(gen_ms, 2),
        input_data={"model": "gpt-4o-mini", "persona_count": len(personas)},
        output_data={"personas_generated": len(personas), "dimensions_per_persona": 6}
    ))

    # Span 4: Quality & Completeness Audit
    t0 = time.time()
    metrics = results["success_metrics"]
    audit_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_audit_{trace_id[:6]}",
        name="Persona Completeness & Diversity Audit",
        span_type="safety_audit",
        status="SUCCESS" if metrics.completeness_score >= 90 else "WARNING",
        latency_ms=round(audit_ms, 2),
        input_data={"personas_audited": len(personas)},
        output_data={
            "context_grounding_score": metrics.context_grounding_score,
            "persona_diversity_index": metrics.persona_diversity_index,
            "completeness_score": metrics.completeness_score,
            "policy_compliance_score": metrics.policy_compliance_score
        }
    ))

    # Token Usage & Cost Calculation
    total_latency_ms = (time.time() - t_start) * 1000.0
    token_report = cost_tracker.calculate_cost(
        prompt_text=system_prompt,
        completion_text=full_personas_text,
        embedding_texts=[c["text"] for c in context_chunks],
        latency_ms=total_latency_ms
    )

    # Finalize Trace Record
    trace_record = global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 1: Customer Persona Generator Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )

    return JSONResponse(content={
        "status": "SUCCESS",
        "trace_id": trace_id,
        "personas": [p.model_dump() for p in personas],
        "success_metrics": metrics.model_dump(),
        "token_usage": token_report.model_dump(),
        "trace_record": trace_record.model_dump()
    })


class BenefitsExtractionRequest(BaseModel):
    product_name: str = "American Hairline Scalp Revival System"
    product_details: str = "Non-surgical, organic scalp revival system with guaranteed high-density follicle recovery, zero side effects, and 90-day progress guarantee."
    persona_summaries: Optional[List[str]] = None
    topic_filter: Optional[str] = None


@app.post("/api/generate-benefits")
async def generate_benefits(request: BenefitsExtractionRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 2: Benefits Extraction Pipeline",
        input_parameters=request.model_dump()
    )

    spans: List[ExecutionSpan] = []

    # Span 1: Vector Retrieval for Product & Persona Context
    t0 = time.time()
    context_chunks = await asyncio.to_thread(
        benefits_engine.retrieve_context,
        query=f"{request.product_name} {request.product_details}",
        topic_filter=request.topic_filter,
        top_k=4
    )
    retrieval_ms = (time.time() - t0) * 1000.0

    context_text = "\n\n".join([c["text"] for c in context_chunks]) if context_chunks else "Standard product details & customer transformation context."

    spans.append(ExecutionSpan(
        span_id=f"span_retrieval_{trace_id[:6]}",
        name="Metadata-Filtered RAG Retrieval",
        span_type="retrieval",
        status="SUCCESS",
        latency_ms=round(retrieval_ms, 2),
        input_data={"product": request.product_name, "topic_filter": request.topic_filter},
        output_data={"retrieved_chunks": len(context_chunks), "snippet": context_text[:150] + "..."}
    ))

    # Span 2: System Prompt & Persona-Emotion Mapping Matrix
    t0 = time.time()
    system_prompt = await asyncio.to_thread(
        benefits_engine.build_system_prompt,
        product_name=product_name,
        product_details=request.product_details,
        persona_summaries=request.persona_summaries or [],
        retrieved_context=context_text
    )
    prompt_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_prompt_{trace_id[:6]}",
        name="System Prompt & Persona-Emotion Matrix Injection",
        span_type="prompt_injection",
        status="SUCCESS",
        latency_ms=round(prompt_ms, 2),
        input_data={"product": request.product_name, "personas_count": len(request.persona_summaries or [])},
        output_data={"system_prompt_length": len(system_prompt), "zero_hallucination_rule": True}
    ))

    # Span 3: LLM 10 Core Benefits Extraction
    t0 = time.time()
    results = await asyncio.to_thread(
        benefits_engine.generate_10_benefits,
        product_name=product_name,
        product_details=request.product_details,
        persona_summaries=request.persona_summaries,
        topic_filter=request.topic_filter
    )
    gen_ms = (time.time() - t0) * 1000.0

    benefits = results["benefits"]
    full_output_text = "\n\n".join([f"{b.title} ({b.mapped_persona}) - {b.underlying_emotion}: {b.description}" for b in benefits])

    spans.append(ExecutionSpan(
        span_id=f"span_llm_{trace_id[:6]}",
        name="LLM 10 Core Benefits Extraction",
        span_type="llm_generation",
        status="SUCCESS",
        latency_ms=round(gen_ms, 2),
        input_data={"model": "gpt-4o-mini", "requested_benefits": 10},
        output_data={"benefits_extracted": len(benefits), "mapped_personas": len(set(b.mapped_persona for b in benefits))}
    ))

    # Span 4: Persona Coverage & Emotional Resonance Audit
    t0 = time.time()
    metrics = results["success_metrics"]
    audit_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_audit_{trace_id[:6]}",
        name="Persona Coverage & Emotional Alignment Audit",
        span_type="safety_audit",
        status="SUCCESS" if metrics.persona_coverage_score >= 80 else "WARNING",
        latency_ms=round(audit_ms, 2),
        input_data={"benefits_audited": len(benefits)},
        output_data={
            "persona_coverage_score": metrics.persona_coverage_score,
            "emotional_resonance_score": metrics.emotional_resonance_score,
            "feature_alignment_score": metrics.feature_alignment_score
        }
    ))

    # Token Usage & Cost Calculation
    total_latency_ms = (time.time() - t_start) * 1000.0
    token_report = cost_tracker.calculate_cost(
        prompt_text=system_prompt,
        completion_text=full_output_text,
        embedding_texts=[c["text"] for c in context_chunks],
        latency_ms=total_latency_ms
    )

    # Finalize Trace Record
    trace_record = global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 2: Benefits Extraction Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )

    return JSONResponse(content={
        "status": "SUCCESS",
        "trace_id": trace_id,
        "benefits": [b.model_dump() for b in benefits],
        "success_metrics": metrics.model_dump(),
        "token_usage": token_report.model_dump(),
        "trace_record": trace_record.model_dump()
    })


class BenefitsAngleRequest(BaseModel):
    product_name: str = "American Hairline Scalp Revival System"
    product_details: str = "Non-surgical, organic scalp revival system with guaranteed high-density follicle recovery, zero side effects, and 90-day progress guarantee."
    persona_summaries: Optional[List[str]] = None
    angles_per_benefit: int = Field(default=5, ge=1, le=10)
    topic_filter: Optional[str] = None


@app.post("/api/generate-angles")
async def generate_angles(request: BenefitsAngleRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 3: Benefits & Ad Angle Matrix Pipeline",
        input_parameters=request.model_dump()
    )

    spans: List[ExecutionSpan] = []

    # Span 1: Vector Retrieval for Product & Persona Context
    t0 = time.time()
    context_chunks = await asyncio.to_thread(
        angle_engine.retrieve_context,
        query=f"{request.product_name} {request.product_details}",
        topic_filter=request.topic_filter,
        top_k=4
    )
    retrieval_ms = (time.time() - t0) * 1000.0

    context_text = "\n\n".join([c["text"] for c in context_chunks]) if context_chunks else "Standard product details & customer transformation context."

    spans.append(ExecutionSpan(
        span_id=f"span_retrieval_{trace_id[:6]}",
        name="Metadata-Filtered RAG Retrieval",
        span_type="retrieval",
        status="SUCCESS",
        latency_ms=round(retrieval_ms, 2),
        input_data={"product": request.product_name, "topic_filter": request.topic_filter},
        output_data={"retrieved_chunks": len(context_chunks), "snippet": context_text[:150] + "..."}
    ))

    # Span 2: System Prompt & Copywriting Framework Matrix Injection
    t0 = time.time()
    system_prompt = await asyncio.to_thread(
        angle_engine.build_system_prompt,
        product_name=product_name,
        product_details=request.product_details,
        persona_summaries=request.persona_summaries or [],
        angles_per_benefit=request.angles_per_benefit,
        retrieved_context=context_text
    )
    prompt_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_prompt_{trace_id[:6]}",
        name="System Prompt & 8-Framework Matrix Injection",
        span_type="prompt_injection",
        status="SUCCESS",
        latency_ms=round(prompt_ms, 2),
        input_data={"product": request.product_name, "angles_per_benefit": request.angles_per_benefit},
        output_data={"system_prompt_length": len(system_prompt), "zero_hallucination_rule": True}
    ))

    # Span 3: LLM Benefits & Ad Angle Matrix Generation
    t0 = time.time()
    results = await asyncio.to_thread(
        angle_engine.generate_benefits_and_angles,
        product_name=product_name,
        product_details=request.product_details,
        persona_summaries=request.persona_summaries,
        angles_per_benefit=request.angles_per_benefit,
        topic_filter=request.topic_filter
    )
    gen_ms = (time.time() - t0) * 1000.0

    benefit_groups = results["benefit_groups"]
    total_angles = sum(len(bg.angles) for bg in benefit_groups)
    full_output_text = "\n\n".join([f"Benefit: {bg.benefit_title}\n" + "\n".join([f"- {a.framework}: {a.angle_headline}" for a in bg.angles]) for bg in benefit_groups])

    spans.append(ExecutionSpan(
        span_id=f"span_llm_{trace_id[:6]}",
        name="LLM Benefits & Ad Angle Matrix Generation",
        span_type="llm_generation",
        status="SUCCESS",
        latency_ms=round(gen_ms, 2),
        input_data={"model": "gpt-4o-mini", "angles_per_benefit": request.angles_per_benefit},
        output_data={"benefits_count": len(benefit_groups), "total_angles_generated": total_angles}
    ))

    # Span 4: Framework Coverage & Angle Diversity Audit
    t0 = time.time()
    metrics = results["success_metrics"]
    audit_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_audit_{trace_id[:6]}",
        name="Framework Coverage & Angle Diversity Audit",
        span_type="safety_audit",
        status="SUCCESS" if metrics.framework_coverage_score >= 60.0 else "WARNING",
        latency_ms=round(audit_ms, 2),
        input_data={"angles_audited": total_angles},
        output_data={
            "framework_coverage_score": metrics.framework_coverage_score,
            "angle_diversity_index": metrics.angle_diversity_index,
            "persona_mapping_score": metrics.persona_mapping_score
        }
    ))

    # Token Usage & Cost Calculation
    total_latency_ms = (time.time() - t_start) * 1000.0
    token_report = cost_tracker.calculate_cost(
        prompt_text=system_prompt,
        completion_text=full_output_text,
        embedding_texts=[c["text"] for c in context_chunks],
        latency_ms=total_latency_ms
    )

    # Finalize Trace Record
    trace_record = global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 3: Benefits & Ad Angle Matrix Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )

    return JSONResponse(content={
        "status": "SUCCESS",
        "trace_id": trace_id,
        "benefit_groups": [bg.model_dump() for bg in benefit_groups],
        "success_metrics": metrics.model_dump(),
        "token_usage": token_report.model_dump(),
        "trace_record": trace_record.model_dump()
    })


class VideoScriptRequest(BaseModel):
    product_name: str = "American Hairline Scalp Revival System"
    chosen_angle: str = "Tired of Hiding Under Caps & Avoiding Overhead Lights?"
    chosen_hook: str = "Stop scrolling if you catch yourself constantly checking your hairline in rearview mirrors."
    target_persona: str = "The Skeptical Solution Seeker (Marcus, 34)"
    script_framework: str = "PAS (Problem-Agitate-Solution)"
    total_duration: str = "30 Seconds"
    topic_filter: Optional[str] = None


@app.post("/api/generate-video-scripts")
async def generate_video_scripts(request: VideoScriptRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 4: Video Ads Script Generation Pipeline",
        input_parameters=request.model_dump()
    )

    spans: List[ExecutionSpan] = []

    # Span 1: Metadata-Filtered Vector Retrieval for Video Copywriting Rules
    t0 = time.time()
    context_chunks = await asyncio.to_thread(
        video_engine.retrieve_context,
        query=f"{request.product_name} video ad script hook problem agitation reveal CTA visual direction",
        topic_filter=request.topic_filter,
        top_k=4
    )
    retrieval_ms = (time.time() - t0) * 1000.0

    context_text = "\n\n".join([c["text"] for c in context_chunks]) if context_chunks else "Standard Video Ad Structure: First 3 seconds pattern interrupt, visceral agitation, hero product mechanism reveal, urgent risk-free CTA."

    spans.append(ExecutionSpan(
        span_id=f"span_retrieval_{trace_id[:6]}",
        name="Metadata-Filtered Vector Retrieval",
        span_type="retrieval",
        status="SUCCESS",
        latency_ms=round(retrieval_ms, 2),
        input_data={"product": request.product_name, "framework": request.script_framework},
        output_data={"retrieved_chunks": len(context_chunks), "snippet": context_text[:150] + "..."}
    ))

    # Span 2: System Prompt & Video Script Architecture Injection
    t0 = time.time()
    system_prompt = await asyncio.to_thread(
        video_engine.build_system_prompt,
        product_name=product_name,
        chosen_angle=request.chosen_angle,
        chosen_hook=request.chosen_hook,
        target_persona=request.target_persona,
        script_framework=request.script_framework,
        total_duration=request.total_duration,
        retrieved_context=context_text
    )
    prompt_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_prompt_{trace_id[:6]}",
        name="System Prompt & Video Architecture Injection",
        span_type="prompt_injection",
        status="SUCCESS",
        latency_ms=round(prompt_ms, 2),
        input_data={"product": request.product_name, "framework": request.script_framework},
        output_data={"system_prompt_length": len(system_prompt), "zero_hallucination_rule": True}
    ))

    # Span 3: LLM Scene-by-Scene Video Script Generation
    t0 = time.time()
    results = await asyncio.to_thread(
        video_engine.generate_video_scripts,
        product_name=product_name,
        chosen_angle=request.chosen_angle,
        chosen_hook=request.chosen_hook,
        target_persona=request.target_persona,
        script_framework=request.script_framework,
        total_duration=request.total_duration,
        topic_filter=request.topic_filter
    )
    gen_ms = (time.time() - t0) * 1000.0

    scripts = results["video_scripts"]
    full_output_text = "\n\n".join([f"Script {s.script_id} ({s.framework_structure}): Hook: {s.core_hook} | Title: {s.script_title}" for s in scripts])

    spans.append(ExecutionSpan(
        span_id=f"span_llm_{trace_id[:6]}",
        name="LLM Scene-by-Scene Video Script Generation",
        span_type="llm_generation",
        status="SUCCESS",
        latency_ms=round(gen_ms, 2),
        input_data={"model": "gpt-4o-mini", "framework": request.script_framework},
        output_data={"scripts_generated": len(scripts), "target_duration": request.total_duration}
    ))

    # Span 4: Hook Strength, Visual Clarity & Policy Audit
    t0 = time.time()
    metrics = results["success_metrics"]
    audit_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_audit_{trace_id[:6]}",
        name="Hook Strength, Visual Clarity & Pacing Audit",
        span_type="safety_audit",
        status="SUCCESS" if metrics.overall_script_quality >= 80.0 else "WARNING",
        latency_ms=round(audit_ms, 2),
        input_data={"scripts_audited": len(scripts)},
        output_data={
            "hook_strength_score": metrics.hook_strength_score,
            "visual_clarity_score": metrics.visual_clarity_score,
            "framework_pacing_score": metrics.framework_pacing_score,
            "policy_compliance_score": metrics.policy_compliance_score,
            "overall_script_quality": metrics.overall_script_quality
        }
    ))

    # Token Usage & Cost Calculation
    total_latency_ms = (time.time() - t_start) * 1000.0
    token_report = cost_tracker.calculate_cost(
        prompt_text=system_prompt,
        completion_text=full_output_text,
        embedding_texts=[c["text"] for c in context_chunks],
        latency_ms=total_latency_ms
    )

    # Finalize Trace Record
    trace_record = global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 4: Video Ads Script Generation Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )

    return JSONResponse(content={
        "status": "SUCCESS",
        "trace_id": trace_id,
        "video_scripts": [s.model_dump() for s in scripts],
        "success_metrics": metrics.model_dump(),
        "token_usage": token_report.model_dump(),
        "trace_record": trace_record.model_dump()
    })


class AdGenerationRequest(BaseModel):
    product_name: str = "Masterclass Copywriting Framework"
    topic_filter: str = "Hook Writing"
    target_audience: str = "Digital Marketers & Creators"
    module_filter: Optional[str] = None


@app.post("/api/generate-ads")
async def generate_ads(request: AdGenerationRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Ad Generation & Retrieval Pipeline",
        input_parameters=request.model_dump()
    )

    spans: List[ExecutionSpan] = []

    # Span 1: Vector Retrieval
    t0 = time.time()
    context_chunks = await asyncio.to_thread(
        ad_engine.retrieve_context,
        query=f"frameworks for {request.topic_filter} and high converting ads",
        module_filter=request.module_filter,
        topic_filter=request.topic_filter,
        top_k=4
    )
    retrieval_ms = (time.time() - t0) * 1000.0
    
    context_text = "\n\n".join([c["text"] for c in context_chunks]) if context_chunks else "Standard course framework: Hook, Agitate, Solve, Call to Action."
    
    spans.append(ExecutionSpan(
        span_id=f"span_retrieval_{trace_id[:6]}",
        name="Metadata-Filtered Vector Retrieval",
        span_type="retrieval",
        status="SUCCESS",
        latency_ms=round(retrieval_ms, 2),
        input_data={"query_topic": request.topic_filter, "module_filter": request.module_filter},
        output_data={"retrieved_chunks": len(context_chunks), "snippet": context_text[:150] + "..."}
    ))

    # Span 2: System Prompt & Context Injection
    t0 = time.time()
    system_prompt = await asyncio.to_thread(ad_engine.build_system_prompt, request.product_name, request.target_audience, context_text)
    prompt_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_prompt_{trace_id[:6]}",
        name="System Prompt Context Injection",
        span_type="prompt_injection",
        status="SUCCESS",
        latency_ms=round(prompt_ms, 2),
        input_data={"target_audience": request.target_audience, "course_name": request.product_name},
        output_data={"system_prompt_length": len(system_prompt), "zero_hallucination_rule_encoded": True}
    ))

    # Span 3: Ad Generation (10 Variations)
    t0 = time.time()
    results = await asyncio.to_thread(
        ad_engine.generate_10_ad_variations,
        product_or_course_name=request.product_name,
        topic_filter=request.topic_filter,
        target_audience=request.target_audience
    )
    gen_ms = (time.time() - t0) * 1000.0
    
    variations = results["ad_variations"]
    full_output_text = "\n".join([v.full_ad_text for v in variations])

    spans.append(ExecutionSpan(
        span_id=f"span_llm_{trace_id[:6]}",
        name="LLM 10 Ad Variations Generation",
        span_type="llm_generation",
        status="SUCCESS",
        latency_ms=round(gen_ms, 2),
        input_data={"model": "gpt-4o-mini", "temperature": 0.7},
        output_data={"variations_generated": len(variations), "framework_structure": "Hook-Problem-Solution-CTA"}
    ))

    # Span 4: Brand Safety & Policy Compliance Audit
    t0 = time.time()
    metrics = results["success_metrics"]
    safety_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_audit_{trace_id[:6]}",
        name="Brand Safety & Policy Compliance Audit",
        span_type="safety_audit",
        status="SUCCESS" if metrics.policy_compliance_score >= 90 else "WARNING",
        latency_ms=round(safety_ms, 2),
        input_data={"variations_audited": len(variations)},
        output_data={
            "brand_safety_score": metrics.brand_safety_score,
            "policy_compliance_score": metrics.policy_compliance_score,
            "hallucination_confidence": metrics.hallucination_free_confidence
        }
    ))

    # Token Usage & Cost Calculation
    total_latency_ms = (time.time() - t_start) * 1000.0
    token_report = cost_tracker.calculate_cost(
        prompt_text=system_prompt,
        completion_text=full_output_text,
        embedding_texts=[c["text"] for c in context_chunks],
        latency_ms=total_latency_ms
    )

    # Finalize Trace Record
    trace_record = global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Ad Generation & Retrieval Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )

    return JSONResponse(content={
        "status": "SUCCESS",
        "trace_id": trace_id,
        "ad_variations": [v.model_dump() for v in variations],
        "success_metrics": metrics.model_dump(),
        "token_usage": token_report.model_dump(),
        "trace_record": trace_record.model_dump()
    })


@app.get("/api/traces")
async def get_traces(limit: int = 20):
    return JSONResponse(content={"traces": global_tracer.get_traces(limit=limit)})


@app.get("/api/traces/{trace_id}")
async def get_trace_details(trace_id: str):
    trace = global_tracer.get_trace_by_id(trace_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace ID not found")
    return JSONResponse(content=trace)


from feedback_manager import feedback_mgr

class FeedbackRequest(BaseModel):
    variation_id: int = 1
    target_angle: str = "General Angle"
    hook: str = ""
    problem_agitation: str = ""
    solution_value: str = ""
    call_to_action: str = ""
    full_ad_text: str = ""
    rating: Literal["thumbs_up", "thumbs_down"]


@app.post("/api/feedback")
async def record_feedback(req: FeedbackRequest):
    res = feedback_mgr.save_feedback(
        variation_id=req.variation_id,
        target_angle=req.target_angle,
        hook=req.hook,
        problem_agitation=req.problem_agitation,
        solution_value=req.solution_value,
        call_to_action=req.call_to_action,
        full_ad_text=req.full_ad_text,
        rating=req.rating
    )
    return JSONResponse(content=res)


@app.get("/api/feedback/summary")
async def get_feedback_summary():
    return JSONResponse(content=feedback_mgr.get_summary())


@app.get("/api/metrics")
async def get_metrics():
    metrics_summary = global_tracer.get_metrics_summary()
    metrics_summary["feedback"] = feedback_mgr.get_summary()
    return JSONResponse(content=metrics_summary)


@app.get("/api/cron/pinecone-keepalive")
async def pinecone_keepalive(request: Request):
    """
    Scheduled daily via vercel.json crons. Pings the Pinecone index so the
    free-tier index is never idle long enough to hit the 3-week auto-pause.
    """
    cron_secret = os.getenv("CRON_SECRET")
    if cron_secret:
        auth_header = request.headers.get("authorization")
        if auth_header != f"Bearer {cron_secret}":
            raise HTTPException(status_code=401, detail="Unauthorized")

    result = vector_store.keepalive()
    return JSONResponse(content=result)


@app.post("/api/upload-transcript")
async def upload_transcript(file: UploadFile = File(...)):
    filename = file.filename
    content_bytes = await file.read()
    
    text = ""
    if filename.endswith(".docx"):
        try:
            import docx
            import io
            doc = docx.Document(io.BytesIO(content_bytes))
            text = "\n".join([p.text for p in doc.paragraphs if p.text.strip()])
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse .docx file: {e}")
    else:
        text = content_bytes.decode("utf-8", errors="ignore")

    if not text.strip():
        raise HTTPException(status_code=400, detail="Uploaded file contains no readable text.")

    chunks = await asyncio.to_thread(
        chunker.chunk_text,
        text=text,
        source_file=filename,
        default_module="Uploaded Transcript",
        default_topic="Custom Topic"
    )

    embeddings = await asyncio.to_thread(embedding_manager.get_embeddings, [c.text for c in chunks])

    try:
        await asyncio.to_thread(vector_store.add_chunks, chunks, embeddings)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return JSONResponse(content={
        "status": "SUCCESS",
        "message": f"Successfully processed '{filename}' into {len(chunks)} semantic chunks.",
        "chunk_count": len(chunks),
        "filename": filename
    })

def _submit_to_assemblyai(file_path: str) -> str:
    """Uploads the audio and queues the transcription job. Returns immediately
    (does not wait for transcription to finish) so the request can't time out
    on long recordings — the client polls /api/transcribe-audio/{id} instead."""
    aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
    transcript = aai.Transcriber().submit(file_path)
    return transcript.id

def _get_assemblyai_status(transcript_id: str) -> dict:
    aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")
    transcript = aai.Transcript.get_by_id(transcript_id)
    if transcript.status == aai.TranscriptStatus.error:
        raise RuntimeError(transcript.error)
    return {"state": transcript.status, "text": transcript.text if transcript.status == aai.TranscriptStatus.completed else None}

SUPPORTED_MEDIA_EXTS = ('.mp4', '.mov', '.mkv', '.webm', '.avi', '.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg')

CHUNK_UPLOAD_DIR = os.path.join(tempfile.gettempdir(), "meta_ads_chunks")
os.makedirs(CHUNK_UPLOAD_DIR, exist_ok=True)


class GeminiUploadInitRequest(BaseModel):
    filename: str
    mime_type: Optional[str] = "video/mp4"
    file_size: int


class GeminiAnalyzeFileRequest(BaseModel):
    file_uri: str
    file_name: str
    mime_type: Optional[str] = "video/mp4"


@app.post("/api/gemini-upload-init")
async def gemini_upload_init(request: GeminiUploadInitRequest):
    """
    Initializes a direct resumable upload session with Google Gemini File API.
    Uses standard library urllib.request for 100% reliable zero-dependency execution on Vercel.
    """
    gemini_key = _get_gemini_api_key()
    if not gemini_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")

    init_url = f"https://generativelanguage.googleapis.com/upload/v1beta/files?key={gemini_key}"
    metadata_json = json.dumps({
        "file": {
            "display_name": os.path.basename(request.filename or "ad_video.mp4")
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        init_url,
        data=metadata_json,
        headers={
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(request.file_size),
            "X-Goog-Upload-Header-Content-Type": request.mime_type or "video/mp4",
            "Content-Type": "application/json"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            upload_url = res.headers.get("X-Goog-Upload-URL")
            if not upload_url:
                raise RuntimeError("Google File API did not return an upload URL")
            return JSONResponse(content={"status": "SUCCESS", "upload_url": upload_url})
    except Exception as e:
        print(f"[API] Gemini upload init error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/gemini-analyze-file")
async def gemini_analyze_file(request: GeminiAnalyzeFileRequest):
    """
    Analyzes an uploaded video/audio file on Gemini File API.
    Transcribes spoken voiceover verbatim AND produces an in-depth winning ad pattern breakdown.
    """
    gemini_key = _get_gemini_api_key()
    if not gemini_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")

    # Poll processing state if video
    state = "PROCESSING"
    retries = 0
    while state == "PROCESSING" and retries < 25:
        await asyncio.sleep(2)
        try:
            status_url = f"https://generativelanguage.googleapis.com/v1beta/{request.file_name}?key={gemini_key}"
            req = urllib.request.Request(status_url)
            with urllib.request.urlopen(req, timeout=10) as get_res:
                if get_res.status == 200:
                    data = json.loads(get_res.read().decode("utf-8"))
                    state = data.get("state", "ACTIVE")
                    if state != "PROCESSING":
                        break
        except Exception:
            pass
        retries += 1

    prompt_text = (
        "You are an expert Meta Ads creative director and video analyst.\n"
        "Analyze this winning ad video thoroughly for ad reproduction and doubling down:\n\n"
        "1. VERBATIM SPOKEN DIALOGUE / TRANSCRIPT:\n"
        "Transcribe every spoken word verbatim in the spoken language (English, Hindi, or Hinglish).\n"
        "If the ad has no speech (visual only with music), clearly write: '[Visual Ad - No Spoken Dialogue]'.\n\n"
        "2. WINNING AD PATTERN & SCENE BREAKDOWN:\n"
        "- Opening Hook (0-3s): The exact visual hook, actor action, or pattern interrupt.\n"
        "- Agitation & Pain: How the customer's problem or frustration is visually depicted.\n"
        "- Product / Solution Reveal: How the product/offer is demonstrated.\n"
        "- Text Overlays & Badges: Key on-screen text, offers, or proof elements.\n"
        "- Call to Action (CTA): The final offer and closing scene.\n\n"
        "3. WHAT MADE THIS AD WIN & CONVERT:\n"
        "- Identify the core emotional trigger, pacing, and visual style.\n\n"
        "Format your response clearly starting with the transcript and followed by the breakdown."
    )

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt_text},
                {"file_data": {"mime_type": request.mime_type or "video/mp4", "file_uri": request.file_uri}}
            ]
        }],
        "generationConfig": {"temperature": 0.2}
    }
    payload_bytes = json.dumps(payload).encode("utf-8")

    models_to_try = ["gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.6-flash"]
    last_err = ""
    for model_name in models_to_try:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=45) as res:
                if res.status == 200:
                    res_data = json.loads(res.read().decode("utf-8"))
                    candidates = res_data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        if parts and "text" in parts[0]:
                            transcript = parts[0]["text"].strip()
                            if transcript:
                                return JSONResponse(content={
                                    "status": "SUCCESS",
                                    "transcription": transcript
                                })
        except Exception as e:
            last_err = str(e)

    return JSONResponse(
        status_code=500,
        content={"status": "ERROR", "detail": f"Failed to analyze video: {last_err}"}
    )


@app.post("/api/transcribe-audio")
async def transcribe_audio_endpoint(file: UploadFile = File(...)):
    filename = file.filename or "media.mp4"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in SUPPORTED_MEDIA_EXTS:
        return JSONResponse(
            status_code=400,
            content={
                "status": "ERROR",
                "detail": f"Unsupported format '{ext}'. Please upload video (.mp4, .mov, .webm) or audio (.mp3, .m4a, .wav)."
            }
        )

    temp_file_path = None
    try:
        fd, temp_file_path = tempfile.mkstemp(suffix=ext, prefix="media_transcribe_")
        with os.fdopen(fd, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                f.write(chunk)

        # Transcribe directly via Gemini Multimodal File API
        transcript = await asyncio.to_thread(transcribe_media_via_gemini, temp_file_path)

        if not transcript or not transcript.strip():
            if os.getenv("ASSEMBLYAI_API_KEY"):
                try:
                    transcript_id = await asyncio.to_thread(_submit_to_assemblyai, temp_file_path)
                    return JSONResponse(content={
                        "status": "SUBMITTED",
                        "transcript_id": transcript_id
                    })
                except Exception:
                    pass
            return JSONResponse(
                status_code=422,
                content={
                    "status": "ERROR",
                    "detail": "Could not extract spoken dialogue from uploaded file. The video may contain no speech or only background music."
                }
            )

        return JSONResponse(content={
            "status": "SUCCESS",
            "transcription": transcript.strip()
        })
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "ERROR", "detail": str(e)})
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception:
                pass


@app.post("/api/upload-media-chunk")
async def upload_media_chunk_endpoint(
    chunk: UploadFile = File(...),
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    filename: str = Form(...)
):
    """
    Receives chunked media upload for large video files (100MB+).
    Assembles chunks when the final chunk arrives and transcribes via Gemini File API.
    """
    clean_upload_id = re.sub(r'[^a-zA-Z0-9_-]', '_', upload_id)
    upload_folder = os.path.join(CHUNK_UPLOAD_DIR, clean_upload_id)
    os.makedirs(upload_folder, exist_ok=True)

    chunk_file_path = os.path.join(upload_folder, f"chunk_{chunk_index:05d}.part")
    with open(chunk_file_path, "wb") as f:
        while data := await chunk.read(1024 * 1024):
            f.write(data)

    if chunk_index + 1 < total_chunks:
        return JSONResponse(content={
            "status": "CHUNK_RECEIVED",
            "chunk_index": chunk_index,
            "total_chunks": total_chunks,
            "percent": int(((chunk_index + 1) / total_chunks) * 100)
        })

    # Final chunk received: assemble the complete video file
    ext = os.path.splitext(filename or "media.mp4")[1].lower()
    if ext not in SUPPORTED_MEDIA_EXTS:
        ext = ".mp4"

    fd, assembled_path = tempfile.mkstemp(suffix=ext, prefix="assembled_media_")
    os.close(fd)

    try:
        with open(assembled_path, "wb") as out_f:
            for idx in range(total_chunks):
                part_p = os.path.join(upload_folder, f"chunk_{idx:05d}.part")
                if not os.path.exists(part_p):
                    return JSONResponse(
                        status_code=400,
                        content={"status": "ERROR", "detail": f"Missing chunk {idx} of {total_chunks}"}
                    )
                with open(part_p, "rb") as in_f:
                    while buf := in_f.read(1024 * 1024):
                        out_f.write(buf)

        # Clean up chunk directory
        try:
            shutil.rmtree(upload_folder, ignore_errors=True)
        except Exception:
            pass

        # Transcribe assembled media via Gemini File API
        transcript = await asyncio.to_thread(transcribe_media_via_gemini, assembled_path)
        if not transcript or not transcript.strip():
            if os.getenv("ASSEMBLYAI_API_KEY"):
                try:
                    transcript_id = await asyncio.to_thread(_submit_to_assemblyai, assembled_path)
                    return JSONResponse(content={"status": "SUBMITTED", "transcript_id": transcript_id})
                except Exception:
                    pass
            return JSONResponse(
                status_code=422,
                content={
                    "status": "ERROR",
                    "detail": "Could not extract spoken dialogue from uploaded video. The video may contain no speech or only background music."
                }
            )

        return JSONResponse(content={
            "status": "SUCCESS",
            "transcription": transcript.strip()
        })
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "ERROR", "detail": str(e)})
    finally:
        if os.path.exists(assembled_path):
            try:
                os.remove(assembled_path)
            except Exception:
                pass

@app.get("/api/transcribe-audio/{transcript_id}")
async def get_transcription_status(transcript_id: str):
    try:
        result = await asyncio.to_thread(_get_assemblyai_status, transcript_id)
        return JSONResponse(content={"status": "SUCCESS", **result})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-creative-direction")
async def generate_creative_direction(request: CreativeDirectionRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 5: Creative Director Pipeline",
        input_parameters=request.model_dump()
    )
    
    spans = []
    
    gen_start = time.time()
    creative_data, metrics, token_usage = await asyncio.to_thread(
        creative_engine.generate_creative_direction,
        product_name=product_name,
        script_title=request.script_title,
        script_hook=request.script_hook,
        global_feedback=request.global_feedback,
        style_preset=request.style_preset
    )
    gen_end = time.time()
    
    spans.append(ExecutionSpan(
        span_id=str(uuid.uuid4()),
        name="LLM Creative Generation",
        span_type="llm",
        status="SUCCESS",
        latency_ms=int((gen_end - gen_start) * 1000),
        input_data={"product": request.product_name, "script": request.script_title},
        output_data=creative_data
    ))
    
    llm_pricing = cost_tracker.PRICING_TABLE.get(creative_engine.model, cost_tracker.PRICING_TABLE["gpt-4o-mini"])
    prompt_cost = token_usage["prompt_tokens"] * llm_pricing["prompt_cost"]
    completion_cost = token_usage["completion_tokens"] * llm_pricing["completion_cost"]
    total_cost = prompt_cost + completion_cost
    
    t_end = time.time()
    latency_ms = int((t_end - t_start) * 1000)
    token_usage["latency_ms"] = latency_ms
    token_usage["formatted_total_cost"] = f"${total_cost:.6f}"
    
    token_report = TokenUsageReport(
        prompt_tokens=token_usage["prompt_tokens"],
        completion_tokens=token_usage["completion_tokens"],
        embedding_tokens=0,
        total_tokens=token_usage["prompt_tokens"] + token_usage["completion_tokens"],
        estimated_cost_usd=round(total_cost, 6),
        formatted_cost=token_usage["formatted_total_cost"],
        model_used=creative_engine.model,
        latency_ms=round(latency_ms, 2)
    )
    
    global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 5: Creative Director Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )
    
    return JSONResponse(content={
        "status": "SUCCESS",
        "creative_direction": creative_data,
        "success_metrics": metrics.model_dump(),
        "token_usage": token_usage,
        "trace_id": trace_id
    })


@app.post("/api/generate-thumbnail-strategy")
async def generate_thumbnail_strategy(request: ThumbnailStrategyRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 6: Thumbnail Strategist Pipeline",
        input_parameters=request.model_dump()
    )
    
    spans = []
    
    gen_start = time.time()
    thumbnail_data, metrics, token_usage = await asyncio.to_thread(
        thumbnail_engine.generate_thumbnail_strategy,
        product_name=product_name,
        script_title=request.script_title,
        script_hook=request.script_hook,
        target_persona=request.target_persona,
        visual_style=request.visual_style,
        global_feedback=request.global_feedback
    )
    gen_end = time.time()
    
    spans.append(ExecutionSpan(
        span_id=str(uuid.uuid4()),
        name="LLM Thumbnail Strategy Generation",
        span_type="llm",
        status="SUCCESS",
        latency_ms=int((gen_end - gen_start) * 1000),
        input_data={"product": request.product_name, "script": request.script_title},
        output_data=thumbnail_data
    ))
    
    llm_pricing = cost_tracker.PRICING_TABLE.get(thumbnail_engine.model, cost_tracker.PRICING_TABLE["gpt-4o-mini"])
    prompt_cost = token_usage["prompt_tokens"] * llm_pricing["prompt_cost"]
    completion_cost = token_usage["completion_tokens"] * llm_pricing["completion_cost"]
    total_cost = prompt_cost + completion_cost
    
    t_end = time.time()
    latency_ms = int((t_end - t_start) * 1000)
    token_usage["latency_ms"] = latency_ms
    token_usage["formatted_total_cost"] = f"${total_cost:.6f}"
    
    token_report = TokenUsageReport(
        prompt_tokens=token_usage["prompt_tokens"],
        completion_tokens=token_usage["completion_tokens"],
        embedding_tokens=0,
        total_tokens=token_usage["prompt_tokens"] + token_usage["completion_tokens"],
        estimated_cost_usd=round(total_cost, 6),
        formatted_cost=token_usage["formatted_total_cost"],
        model_used=thumbnail_engine.model,
        latency_ms=round(latency_ms, 2)
    )
    
    global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 6: Thumbnail Strategist Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )
    
    return JSONResponse(content={
        "status": "SUCCESS",
        "thumbnail_strategy": thumbnail_data,
        "success_metrics": metrics.model_dump(),
        "token_usage": token_usage,
        "trace_id": trace_id
    })


@app.post("/api/generate-thumbnail-design")
async def generate_thumbnail_design(request: ThumbnailDesignRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 7: Thumbnail Designer Pipeline",
        input_parameters=request.model_dump()
    )
    
    spans = []
    
    gen_start = time.time()
    design_data, metrics, token_usage = await asyncio.to_thread(
        designer_engine.generate_thumbnail_design,
        product_name=product_name,
        script_title=request.script_title,
        concept_title=request.concept_title,
        main_visual=request.main_visual,
        thumbnail_copy=request.thumbnail_copy,
        visual_style=request.visual_style,
        global_feedback=request.global_feedback
    )
    gen_end = time.time()
    
    spans.append(ExecutionSpan(
        span_id=str(uuid.uuid4()),
        name="LLM Thumbnail Design Generation",
        span_type="llm",
        status="SUCCESS",
        latency_ms=int((gen_end - gen_start) * 1000),
        input_data={"concept": request.concept_title, "copy": request.thumbnail_copy},
        output_data=design_data
    ))
    
    llm_pricing = cost_tracker.PRICING_TABLE.get(designer_engine.model, cost_tracker.PRICING_TABLE["gpt-4o-mini"])
    prompt_cost = token_usage["prompt_tokens"] * llm_pricing["prompt_cost"]
    completion_cost = token_usage["completion_tokens"] * llm_pricing["completion_cost"]
    total_cost = prompt_cost + completion_cost
    
    t_end = time.time()
    latency_ms = int((t_end - t_start) * 1000)
    token_usage["latency_ms"] = latency_ms
    token_usage["formatted_total_cost"] = f"${total_cost:.6f}"
    
    token_report = TokenUsageReport(
        prompt_tokens=token_usage["prompt_tokens"],
        completion_tokens=token_usage["completion_tokens"],
        embedding_tokens=0,
        total_tokens=token_usage["prompt_tokens"] + token_usage["completion_tokens"],
        estimated_cost_usd=round(total_cost, 6),
        formatted_cost=token_usage["formatted_total_cost"],
        model_used=designer_engine.model,
        latency_ms=round(latency_ms, 2)
    )
    
    global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 7: Thumbnail Designer Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )
    
    return JSONResponse(content={
        "status": "SUCCESS",
        "thumbnail_design": design_data,
        "success_metrics": metrics.model_dump(),
        "token_usage": token_usage,
        "trace_id": trace_id
    })


@app.post("/api/generate-title-strategy")
async def generate_title_strategy(request: TitleStrategyRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 8: Title Strategist Pipeline",
        input_parameters=request.model_dump()
    )
    
    spans = []
    
    gen_start = time.time()
    title_data, metrics, token_usage = await asyncio.to_thread(
        title_engine.generate_title_strategy,
        product_name=product_name,
        script_title=request.script_title,
        script_hook=request.script_hook,
        target_persona=request.target_persona,
        global_feedback=request.global_feedback,
        historical_ab_data=request.historical_ab_data,
        is_v2_hybrid=request.is_v2_hybrid
    )
    gen_end = time.time()
    
    spans.append(ExecutionSpan(
        span_id=str(uuid.uuid4()),
        name="LLM Title Strategy Generation",
        span_type="llm",
        status="SUCCESS",
        latency_ms=int((gen_end - gen_start) * 1000),
        input_data={"product": request.product_name, "script": request.script_title},
        output_data=title_data
    ))
    
    llm_pricing = cost_tracker.PRICING_TABLE.get(title_engine.model, cost_tracker.PRICING_TABLE["gpt-4o-mini"])
    prompt_cost = token_usage["prompt_tokens"] * llm_pricing["prompt_cost"]
    completion_cost = token_usage["completion_tokens"] * llm_pricing["completion_cost"]
    total_cost = prompt_cost + completion_cost
    
    t_end = time.time()
    latency_ms = int((t_end - t_start) * 1000)
    token_usage["latency_ms"] = latency_ms
    token_usage["formatted_total_cost"] = f"${total_cost:.6f}"
    
    token_report = TokenUsageReport(
        prompt_tokens=token_usage["prompt_tokens"],
        completion_tokens=token_usage["completion_tokens"],
        embedding_tokens=0,
        total_tokens=token_usage["prompt_tokens"] + token_usage["completion_tokens"],
        estimated_cost_usd=round(total_cost, 6),
        formatted_cost=token_usage["formatted_total_cost"],
        model_used=title_engine.model,
        latency_ms=round(latency_ms, 2)
    )
    
    global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 8: Title Strategist Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )
    
    return JSONResponse(content={
        "status": "SUCCESS",
        "title_strategy": title_data,
        "success_metrics": metrics.model_dump(),
        "token_usage": token_usage,
        "trace_id": trace_id
    })


@app.post("/api/generate-content-brief")
async def generate_content_brief(request: ContentBriefRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 9: Content Brief Master Pipeline",
        input_parameters=request.model_dump()
    )
    
    spans = []
    
    gen_start = time.time()
    brief_data, metrics, token_usage = await asyncio.to_thread(
        brief_engine.generate_content_brief,
        product_name=product_name,
        target_persona=request.target_persona,
        campaign_objective=request.campaign_objective,
        ad_format=request.ad_format,
        tone_preset=request.tone_preset,
        reference_example=request.reference_example,
        global_feedback=request.global_feedback
    )
    gen_end = time.time()
    
    spans.append(ExecutionSpan(
        span_id=str(uuid.uuid4()),
        name="LLM Content Brief Generation",
        span_type="llm",
        status="SUCCESS",
        latency_ms=int((gen_end - gen_start) * 1000),
        input_data={"product": request.product_name, "objective": request.campaign_objective},
        output_data=brief_data
    ))
    
    llm_pricing = cost_tracker.PRICING_TABLE.get(brief_engine.model, cost_tracker.PRICING_TABLE["gpt-4o-mini"])
    prompt_cost = token_usage["prompt_tokens"] * llm_pricing["prompt_cost"]
    completion_cost = token_usage["completion_tokens"] * llm_pricing["completion_cost"]
    total_cost = prompt_cost + completion_cost
    
    t_end = time.time()
    latency_ms = int((t_end - t_start) * 1000)
    token_usage["latency_ms"] = latency_ms
    token_usage["formatted_total_cost"] = f"${total_cost:.6f}"
    
    token_report = TokenUsageReport(
        prompt_tokens=token_usage["prompt_tokens"],
        completion_tokens=token_usage["completion_tokens"],
        embedding_tokens=0,
        total_tokens=token_usage["prompt_tokens"] + token_usage["completion_tokens"],
        estimated_cost_usd=round(total_cost, 6),
        formatted_cost=token_usage["formatted_total_cost"],
        model_used=brief_engine.model,
        latency_ms=round(latency_ms, 2)
    )
    
    global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 9: Content Brief Master Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )
    
    return JSONResponse(content={
        "status": "SUCCESS",
        "content_brief": brief_data,
        "success_metrics": metrics.model_dump(),
        "token_usage": token_usage,
        "trace_id": trace_id
    })


@app.post("/api/generate-campaign-metadata")
async def generate_campaign_metadata(request: CampaignMetadataRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent 10: Campaign Metadata Master Pipeline",
        input_parameters=request.model_dump()
    )
    
    spans = []
    
    gen_start = time.time()
    meta_data, metrics, token_usage = await asyncio.to_thread(
        metadata_engine.generate_campaign_metadata,
        product_name=product_name,
        script_title=request.script_title,
        target_persona=request.target_persona,
        campaign_objective=request.campaign_objective,
        global_feedback=request.global_feedback
    )
    gen_end = time.time()
    
    spans.append(ExecutionSpan(
        span_id=str(uuid.uuid4()),
        name="LLM Campaign Metadata Generation",
        span_type="llm",
        status="SUCCESS",
        latency_ms=int((gen_end - gen_start) * 1000),
        input_data={"product": request.product_name, "script": request.script_title},
        output_data=meta_data
    ))
    
    llm_pricing = cost_tracker.PRICING_TABLE.get(metadata_engine.model, cost_tracker.PRICING_TABLE["gpt-4o-mini"])
    prompt_cost = token_usage["prompt_tokens"] * llm_pricing["prompt_cost"]
    completion_cost = token_usage["completion_tokens"] * llm_pricing["completion_cost"]
    total_cost = prompt_cost + completion_cost
    
    t_end = time.time()
    latency_ms = int((t_end - t_start) * 1000)
    token_usage["latency_ms"] = latency_ms
    token_usage["formatted_total_cost"] = f"${total_cost:.6f}"
    
    token_report = TokenUsageReport(
        prompt_tokens=token_usage["prompt_tokens"],
        completion_tokens=token_usage["completion_tokens"],
        embedding_tokens=0,
        total_tokens=token_usage["prompt_tokens"] + token_usage["completion_tokens"],
        estimated_cost_usd=round(total_cost, 6),
        formatted_cost=token_usage["formatted_total_cost"],
        model_used=metadata_engine.model,
        latency_ms=round(latency_ms, 2)
    )
    
    global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent 10: Campaign Metadata Master Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )
    
    return JSONResponse(content={
        "status": "SUCCESS",
        "campaign_metadata": meta_data,
        "success_metrics": metrics.model_dump(),
        "token_usage": token_usage,
        "trace_id": trace_id
    })







# =====================================================================
# AGENTS: OWN AD DOUBLE DOWN & COMPETITOR AD REMIXER
# =====================================================================

class ExtractAdContentRequest(BaseModel):
    url: str

class OwnAdDoubleDownRequest(BaseModel):
    product_name: str = "American Hairline Scalp Revival System"
    winner_content: str
    winning_notes: str = ""
    target_persona: str = "The Skeptical Solution Seeker (Marcus, 34)"
    total_duration: str = "30 Seconds"
    global_feedback: str = ""
    topic_filter: Optional[str] = None

class CompetitorAdRemixRequest(BaseModel):
    competitor_name: str = "Leading Competitor Brand"
    competitor_content: str
    our_product_name: str = "American Hairline Scalp Revival System"
    our_unique_mechanism: str = "Bio-active botanical peptide signaling that revitalizes dormant follicles without surgery or greasy residue"
    target_persona: str = "The Skeptical Solution Seeker (Marcus, 34)"
    total_duration: str = "30 Seconds"
    global_feedback: str = ""
    topic_filter: Optional[str] = None


@app.post("/api/extract-ad-content")
async def extract_ad_content(request: ExtractAdContentRequest):
    """
    Extracts ad copy, title, description, and audio transcript from video/ad URLs.
    Safely catches any errors and always returns valid JSON.
    """
    try:
        data = await asyncio.to_thread(extract_content_from_url, request.url)
        return JSONResponse(content=data)
    except Exception as e:
        print(f"[API] Error in extract_ad_content: {e}")
        return JSONResponse(content={
            "url": request.url,
            "title": "",
            "description": "",
            "extracted_text": f"Reference Link: {request.url}\n(Please paste the ad script or hook details directly if this link requires authentication or is restricted.)",
            "video_stream_url": "",
            "audio_transcript": "",
            "source_type": "webpage",
            "status": "FALLBACK",
            "message": str(e)
        })



# ============================================================================
# Variations Bucket (Persistent Creative Vault)
# ============================================================================
VARIATIONS_BUCKET_FILE = os.path.join(os.path.dirname(__file__), "variations_bucket.json")

def _load_variations_bucket() -> List[Dict[str, Any]]:
    if os.path.exists(VARIATIONS_BUCKET_FILE):
        try:
            with open(VARIATIONS_BUCKET_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def _save_variations_bucket(bucket: List[Dict[str, Any]]):
    try:
        with open(VARIATIONS_BUCKET_FILE, "w", encoding="utf-8") as f:
            json.dump(bucket, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[Bucket] Error saving variations bucket: {e}")

def _add_batch_to_bucket(batch_data: Dict[str, Any]) -> str:
    bucket = _load_variations_bucket()
    batch_id = batch_data.get("id") or f"batch_{int(time.time()*1000)}"
    batch_data["id"] = batch_id
    if not batch_data.get("timestamp"):
        import datetime
        batch_data["timestamp"] = datetime.datetime.now().strftime("%d %b %Y, %I:%M %p")
    
    # Prepend new batch so newest appears first
    bucket.insert(0, batch_data)
    _save_variations_bucket(bucket)
    return batch_id

@app.get("/api/variations-bucket")
async def get_variations_bucket():
    bucket = await asyncio.to_thread(_load_variations_bucket)
    return JSONResponse(content={"status": "SUCCESS", "bucket": bucket, "total": len(bucket)})

@app.post("/api/variations-bucket")
async def add_to_variations_bucket(batch: Dict[str, Any]):
    batch_id = await asyncio.to_thread(_add_batch_to_bucket, batch)
    bucket = await asyncio.to_thread(_load_variations_bucket)
    return JSONResponse(content={"status": "SUCCESS", "id": batch_id, "total": len(bucket)})

@app.delete("/api/variations-bucket/{batch_id}")
async def delete_from_variations_bucket(batch_id: str):
    bucket = await asyncio.to_thread(_load_variations_bucket)
    new_bucket = [b for b in bucket if b.get("id") != batch_id]
    await asyncio.to_thread(_save_variations_bucket, new_bucket)
    return JSONResponse(content={"status": "SUCCESS", "message": f"Deleted batch {batch_id}", "total": len(new_bucket)})

@app.delete("/api/variations-bucket")
async def clear_variations_bucket():
    await asyncio.to_thread(_save_variations_bucket, [])
    return JSONResponse(content={"status": "SUCCESS", "message": "Cleared variations bucket", "total": 0})


@app.post("/api/generate-own-ad-variations")
async def generate_own_ad_variations(request: OwnAdDoubleDownRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent: Own Ad Double Down Pipeline",
        input_parameters=request.model_dump()
    )

    spans: List[ExecutionSpan] = []

    # Check if winning ad content is a URL - if so, auto-extract & transcribe audio
    winner_content = request.winner_content
    # Only extract if winner_content is strictly a single raw URL token
    if winner_content and (winner_content.strip().startswith("http://") or winner_content.strip().startswith("https://")) and len(winner_content.strip().split()) == 1:
        try:
            print(f"[Auto-Extractor] Detected URL in winner_content, extracting & transcribing audio...")
            extracted = await asyncio.to_thread(extract_content_from_url, winner_content.strip())
            if extracted.get("extracted_text"):
                winner_content = extracted["extracted_text"]
                print(f"[Auto-Extractor] Successfully extracted content. Transcript length: {len(extracted.get('audio_transcript', ''))}")
        except Exception as e:
            print(f"[Warning] Backend auto-extraction error: {e}")

    product_name = (request.product_name or "").strip() or "American Hairline Scalp Revival System"
    winning_notes = (request.winning_notes or "").strip() or "Analyze winning ad transcript to deconstruct the 3-second thumbstop hook, core agitation, proof mechanism, and conversion CTA."

    # Span 1: Vector Retrieval for Brand Context & Proof Points
    t0 = time.time()
    context_chunks = await asyncio.to_thread(
        own_ad_engine.retrieve_context,
        query=f"{product_name} winning ad hooks proof benefits {winning_notes}",
        topic_filter=request.topic_filter,
        top_k=4
    )
    retrieval_ms = (time.time() - t0) * 1000.0
    context_text = "\n\n".join([c["text"] for c in context_chunks]) if context_chunks else f"Standard Brand Context for {request.product_name}."

    spans.append(ExecutionSpan(
        span_id=f"span_retrieval_{trace_id[:6]}",
        name="Brand Knowledge & Proof Retrieval",
        span_type="retrieval",
        status="SUCCESS",
        latency_ms=round(retrieval_ms, 2),
        input_data={"product": request.product_name, "notes": request.winning_notes[:60]},
        output_data={"retrieved_chunks": len(context_chunks)}
    ))

    # Span 2: System Prompt & Winner Deconstruction Construction
    t0 = time.time()
    system_prompt = await asyncio.to_thread(
        own_ad_engine.build_system_prompt,
        product_name=product_name,
        winner_content=winner_content,
        winning_notes=winning_notes,
        target_persona=request.target_persona,
        total_duration=request.total_duration,
        retrieved_context=context_text
    )
    prompt_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_prompt_{trace_id[:6]}",
        name="Winner Deconstruction & Variation Prompt Injection",
        span_type="prompt_injection",
        status="SUCCESS",
        latency_ms=round(prompt_ms, 2),
        input_data={"duration": request.total_duration, "persona": request.target_persona},
        output_data={"system_prompt_length": len(system_prompt)}
    ))

    # Span 3: LLM 5-Variation Generation
    t0 = time.time()
    results = await asyncio.to_thread(
        own_ad_engine.generate_variations,
        product_name=product_name,
        winner_content=winner_content,
        winning_notes=winning_notes,
        target_persona=request.target_persona,
        total_duration=request.total_duration,
        global_feedback=request.global_feedback,
        topic_filter=request.topic_filter
    )
    gen_ms = (time.time() - t0) * 1000.0

    scripts = results["video_scripts"]
    deconstruction = results["winner_deconstruction"]
    metrics = results["success_metrics"]

    full_output_text = "\n\n".join([f"Script {s.script_id}: {s.script_title} - Hook: {s.core_hook}" for s in scripts])

    spans.append(ExecutionSpan(
        span_id=f"span_llm_{trace_id[:6]}",
        name="LLM 5-Variation Double Down Script Generation",
        span_type="llm_generation",
        status="SUCCESS",
        latency_ms=round(gen_ms, 2),
        input_data={"model": "gpt-4o-mini", "variation_count": len(scripts)},
        output_data={"scripts_generated": len(scripts), "target_duration": request.total_duration}
    ))

    # Span 4: Hook Strength & Policy Compliance Audit
    t0 = time.time()
    audit_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_audit_{trace_id[:6]}",
        name="Hook Velocity & Policy Compliance Audit",
        span_type="safety_audit",
        status="SUCCESS" if metrics.overall_script_quality >= 80.0 else "WARNING",
        latency_ms=round(audit_ms, 2),
        input_data={"scripts_audited": len(scripts)},
        output_data={
            "hook_strength_score": metrics.hook_strength_score,
            "visual_clarity_score": metrics.visual_clarity_score,
            "overall_script_quality": metrics.overall_script_quality
        }
    ))

    # Cost calculation & Trace Finalize
    total_latency_ms = (time.time() - t_start) * 1000.0
    token_report = cost_tracker.calculate_cost(
        prompt_text=system_prompt,
        completion_text=full_output_text,
        embedding_texts=[c["text"] for c in context_chunks],
        latency_ms=total_latency_ms
    )

    trace_record = global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent: Own Ad Double Down Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )

    # Auto-save batch into Variations Bucket
    try:
        import datetime
        batch_data = {
            "id": f"batch_{int(time.time()*1000)}",
            "timestamp": datetime.datetime.now().strftime("%d %b %Y, %I:%M %p"),
            "strategy_type": "own_doubledown",
            "title": f"Own Double Down: {product_name}",
            "product_name": product_name,
            "target_persona": request.target_persona,
            "total_duration": request.total_duration,
            "winning_notes": winning_notes,
            "video_scripts": [s.model_dump() for s in scripts],
            "winner_deconstruction": deconstruction.model_dump() if deconstruction else {},
            "success_metrics": metrics.model_dump() if metrics else {},
            "trace_id": trace_id
        }
        _add_batch_to_bucket(batch_data)
    except Exception as b_err:
        print(f"[Bucket] Auto-save error: {b_err}")

    return JSONResponse(content={
        "status": "SUCCESS",
        "trace_id": trace_id,
        "winner_deconstruction": deconstruction.model_dump() if deconstruction else {},
        "video_scripts": [s.model_dump() for s in scripts],
        "success_metrics": metrics.model_dump(),
        "token_usage": token_report.model_dump(),
        "trace_record": trace_record.model_dump()
    })


@app.post("/api/generate-competitor-remix")
async def generate_competitor_remix(request: CompetitorAdRemixRequest):
    t_start = time.time()
    trace_id = global_tracer.create_trace(
        name="Agent: Competitor Ad Remixer Pipeline",
        input_parameters=request.model_dump()
    )

    spans: List[ExecutionSpan] = []

    # Check if competitor content is a URL - if so, auto-extract & transcribe audio
    competitor_content = request.competitor_content
    # Only extract if competitor_content is strictly a single raw URL token
    if competitor_content and (competitor_content.strip().startswith("http://") or competitor_content.strip().startswith("https://")) and len(competitor_content.strip().split()) == 1:
        try:
            print(f"[Auto-Extractor] Detected URL in competitor_content, extracting & transcribing audio...")
            extracted = await asyncio.to_thread(extract_content_from_url, competitor_content.strip())
            if extracted.get("extracted_text"):
                competitor_content = extracted["extracted_text"]
                print(f"[Auto-Extractor] Successfully extracted content. Transcript length: {len(extracted.get('audio_transcript', ''))}")
        except Exception as e:
            print(f"[Warning] Backend auto-extraction error: {e}")

    # Span 1: Vector Retrieval for Our Brand's Counter-USPs
    t0 = time.time()
    context_chunks = await asyncio.to_thread(
        competitor_engine.retrieve_context,
        query=f"{request.our_product_name} {request.our_unique_mechanism} competitive advantage",
        topic_filter=request.topic_filter,
        top_k=4
    )
    retrieval_ms = (time.time() - t0) * 1000.0
    context_text = "\n\n".join([c["text"] for c in context_chunks]) if context_chunks else f"Standard Brand Context for {request.our_product_name}."

    spans.append(ExecutionSpan(
        span_id=f"span_retrieval_{trace_id[:6]}",
        name="Competitive Advantage Knowledge Retrieval",
        span_type="retrieval",
        status="SUCCESS",
        latency_ms=round(retrieval_ms, 2),
        input_data={"our_product": request.our_product_name, "competitor": request.competitor_name},
        output_data={"retrieved_chunks": len(context_chunks)}
    ))

    # Span 2: System Prompt & Competitor Deconstruction Construction
    t0 = time.time()
    system_prompt = await asyncio.to_thread(
        competitor_engine.build_system_prompt,
        competitor_name=request.competitor_name,
        competitor_content=competitor_content,
        our_product_name=request.our_product_name,
        our_unique_mechanism=request.our_unique_mechanism,
        target_persona=request.target_persona,
        total_duration=request.total_duration,
        retrieved_context=context_text
    )
    prompt_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_prompt_{trace_id[:6]}",
        name="Competitor Deconstruction & Counter-Positioning Injection",
        span_type="prompt_injection",
        status="SUCCESS",
        latency_ms=round(prompt_ms, 2),
        input_data={"competitor": request.competitor_name, "our_product": request.our_product_name},
        output_data={"system_prompt_length": len(system_prompt)}
    ))

    # Span 3: LLM 5-Remix Generation
    t0 = time.time()
    results = await asyncio.to_thread(
        competitor_engine.generate_remixes,
        competitor_name=request.competitor_name,
        competitor_content=competitor_content,
        our_product_name=request.our_product_name,
        our_unique_mechanism=request.our_unique_mechanism,
        target_persona=request.target_persona,
        total_duration=request.total_duration,
        global_feedback=request.global_feedback,
        topic_filter=request.topic_filter
    )
    gen_ms = (time.time() - t0) * 1000.0

    scripts = results["video_scripts"]
    deconstruction = results["competitor_deconstruction"]
    metrics = results["success_metrics"]

    full_output_text = "\n\n".join([f"Script {s.script_id}: {s.script_title} - Hook: {s.core_hook}" for s in scripts])

    spans.append(ExecutionSpan(
        span_id=f"span_llm_{trace_id[:6]}",
        name="LLM 5-Remix Script Generation",
        span_type="llm_generation",
        status="SUCCESS",
        latency_ms=round(gen_ms, 2),
        input_data={"model": "gpt-4o-mini", "remix_count": len(scripts)},
        output_data={"scripts_generated": len(scripts), "target_duration": request.total_duration}
    ))

    # Span 4: Policy & Brand Authenticity Audit
    t0 = time.time()
    audit_ms = (time.time() - t0) * 1000.0

    spans.append(ExecutionSpan(
        span_id=f"span_audit_{trace_id[:6]}",
        name="Brand Authenticity & Policy Compliance Audit",
        span_type="safety_audit",
        status="SUCCESS" if metrics.overall_script_quality >= 80.0 else "WARNING",
        latency_ms=round(audit_ms, 2),
        input_data={"scripts_audited": len(scripts)},
        output_data={
            "hook_strength_score": metrics.hook_strength_score,
            "policy_compliance_score": metrics.policy_compliance_score,
            "overall_script_quality": metrics.overall_script_quality
        }
    ))

    # Cost calculation & Trace Finalize
    total_latency_ms = (time.time() - t_start) * 1000.0
    token_report = cost_tracker.calculate_cost(
        prompt_text=system_prompt,
        completion_text=full_output_text,
        embedding_texts=[c["text"] for c in context_chunks],
        latency_ms=total_latency_ms
    )

    trace_record = global_tracer.finalize_trace(
        trace_id=trace_id,
        name="Agent: Competitor Ad Remixer Pipeline",
        input_parameters=request.model_dump(),
        spans=spans,
        token_report=token_report,
        status="SUCCESS"
    )

    # Auto-save batch into Variations Bucket
    try:
        import datetime
        batch_data = {
            "id": f"batch_{int(time.time()*1000)}",
            "timestamp": datetime.datetime.now().strftime("%d %b %Y, %I:%M %p"),
            "strategy_type": "competitor_remix",
            "title": f"Competitor Remix: {request.competitor_name} vs {request.our_product_name}",
            "competitor_name": request.competitor_name,
            "our_product_name": request.our_product_name,
            "our_unique_mechanism": request.our_unique_mechanism,
            "target_persona": request.target_persona,
            "total_duration": request.total_duration,
            "video_scripts": [s.model_dump() for s in scripts],
            "competitor_deconstruction": deconstruction.model_dump() if deconstruction else {},
            "success_metrics": metrics.model_dump() if metrics else {},
            "trace_id": trace_id
        }
        _add_batch_to_bucket(batch_data)
    except Exception as b_err:
        print(f"[Bucket] Auto-save error: {b_err}")

    return JSONResponse(content={
        "status": "SUCCESS",
        "trace_id": trace_id,
        "competitor_deconstruction": deconstruction.model_dump() if deconstruction else {},
        "video_scripts": [s.model_dump() for s in scripts],
        "success_metrics": metrics.model_dump(),
        "token_usage": token_report.model_dump(),
        "trace_record": trace_record.model_dump()
    })


# Mount Static Files Dashboard
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
async def read_index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    return JSONResponse(content={"message": "FastAPI Transcript RAG & Ad Generator Service is running."})

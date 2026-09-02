"""
rag_pipeline.py

RAG Pipeline Module for Course Transcripts:
1. Semantic Chunking (500-800 tokens per chunk with overlap and speaker/topic metadata).
2. Embedding Generation (OpenAI text-embedding-3-small with fallback).
3. Vector Store with Payload Metadata Filtering (Module-wise and Topic-wise retrieval).
"""

import math
import os
import re
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

# Tiktoken for token counting
try:
    import tiktoken
    _TIKTOKEN_AVAILABLE = True
except ImportError:
    _TIKTOKEN_AVAILABLE = False

# OpenAI for embeddings
try:
    import openai
    _OPENAI_AVAILABLE = True
except ImportError:
    _OPENAI_AVAILABLE = False

# Pinecone for persistent vector storage
try:
    from pinecone import Pinecone, ServerlessSpec
    _PINECONE_AVAILABLE = True
except ImportError:
    _PINECONE_AVAILABLE = False


class ChunkMetadata(BaseModel):
    chunk_id: str
    source_file: str
    module: str
    topic: str
    speaker: Optional[str] = None
    token_count: int
    start_char: int
    end_char: int


class TextChunk(BaseModel):
    chunk_id: str
    text: str
    metadata: ChunkMetadata


class SemanticChunker:
    """
    Semantic Chunker targeting 500-800 tokens per chunk with sliding window overlap.
    Preserves paragraph, sentence, and speaker boundaries to avoid breaking context mid-thought.
    """

    def __init__(self, target_min_tokens: int = 500, target_max_tokens: int = 800, overlap_tokens: int = 100):
        self.min_tokens = target_min_tokens
        self.max_tokens = target_max_tokens
        self.overlap_tokens = overlap_tokens
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
        # Fallback estimation: ~4 chars per token for English/Hindi transcript text
        return max(1, len(text) // 4)

    def _split_into_semantic_units(self, text: str) -> List[Dict[str, Any]]:
        """Split raw text into paragraphs / speaker turns with metadata heuristics."""
        paragraphs = text.split("\n")
        units = []
        
        current_module = "General Module"
        current_topic = "General Topic"
        
        for para in paragraphs:
            para_str = para.strip()
            if not para_str:
                continue

            # Topic / Module detection heuristics (e.g. "Module 1:", "Topic: Hook Writing")
            mod_match = re.search(r"(?:Module|Section)\s*\d*[:\-]?\s*([^\.\n]+)", para_str, re.IGNORECASE)
            if mod_match:
                current_module = mod_match.group(0).strip()

            topic_match = re.search(r"(?:Topic|Topic Name|Lesson|Subject)[:\-]?\s*([^\.\n]+)", para_str, re.IGNORECASE)
            if topic_match:
                current_topic = topic_match.group(1).strip()
            elif any(k in para_str.lower() for k in ["hook", "headline", "pattern interrupt"]):
                current_topic = "Hook Writing & Attention"
            elif any(k in para_str.lower() for k in ["offer", "pricing", "guarantee", "cta"]):
                current_topic = "Offer Framing & CTA"
            elif any(k in para_str.lower() for k in ["story", "pain point", "agitate", "problem"]):
                current_topic = "Storytelling & Pain Points"

            # Speaker detection heuristic (e.g. "Speaker A:", "Speaker B:")
            speaker = None
            spk_match = re.match(r"^(Speaker\s+[A-Za-z0-9]+):\s*(.*)$", para_str, re.IGNORECASE)
            if spk_match:
                speaker = spk_match.group(1)
                content = spk_match.group(2)
            else:
                content = para_str

            units.append({
                "text": content,
                "full_text": para_str,
                "speaker": speaker,
                "module": current_module,
                "topic": current_topic,
                "tokens": self.count_tokens(para_str)
            })

        return units

    def chunk_text(self, text: str, source_file: str = "transcript.docx", 
                   default_module: str = "Hook Writing", default_topic: str = "Ad Hook Frameworks") -> List[TextChunk]:
        units = self._split_into_semantic_units(text)
        chunks: List[TextChunk] = []

        if not units:
            return chunks

        accumulated_units = []
        current_token_count = 0
        char_offset = 0

        for unit in units:
            unit_tokens = unit["tokens"]
            
            # If adding unit keeps chunk under max_tokens
            if current_token_count + unit_tokens <= self.max_tokens or not accumulated_units:
                accumulated_units.append(unit)
                current_token_count += unit_tokens
            else:
                # Flush current accumulated chunk
                chunk = self._create_chunk(accumulated_units, source_file, default_module, default_topic, char_offset)
                chunks.append(chunk)
                char_offset += len(chunk.text)

                # Prepare overlap window (keep last N units to reach ~overlap_tokens)
                overlap_units = []
                overlap_tokens_count = 0
                for prev_unit in reversed(accumulated_units):
                    if overlap_tokens_count + prev_unit["tokens"] <= self.overlap_tokens:
                        overlap_units.insert(0, prev_unit)
                        overlap_tokens_count += prev_unit["tokens"]
                    else:
                        break

                accumulated_units = overlap_units + [unit]
                current_token_count = sum(u["tokens"] for u in accumulated_units)

        # Flush remaining units
        if accumulated_units:
            chunk = self._create_chunk(accumulated_units, source_file, default_module, default_topic, char_offset)
            chunks.append(chunk)

        return chunks

    def _create_chunk(self, units: List[Dict[str, Any]], source_file: str, 
                      default_module: str, default_topic: str, char_offset: int) -> TextChunk:
        combined_text = "\n".join(u["full_text"] for u in units)
        token_count = sum(u["tokens"] for u in units)
        
        # Use specific module/topic from units if detected, otherwise default
        detected_modules = [u["module"] for u in units if u["module"] != "General Module"]
        detected_topics = [u["topic"] for u in units if u["topic"] != "General Topic"]
        speakers = list(set(u["speaker"] for u in units if u["speaker"]))

        module = detected_modules[0] if detected_modules else default_module
        topic = detected_topics[0] if detected_topics else default_topic
        speaker = ", ".join(speakers) if speakers else None

        cid = str(uuid.uuid4())[:8]
        meta = ChunkMetadata(
            chunk_id=cid,
            source_file=source_file,
            module=module,
            topic=topic,
            speaker=speaker,
            token_count=token_count,
            start_char=char_offset,
            end_char=char_offset + len(combined_text)
        )
        return TextChunk(chunk_id=cid, text=combined_text, metadata=meta)


class EmbeddingManager:
    """
    Generates embeddings using OpenAI's `text-embedding-3-small` (1536 dims).
    Includes deterministic fallback vector generation if OPENAI_API_KEY is not set.
    """

    def __init__(self, model_name: str = "text-embedding-3-small", vector_dim: int = 1536):
        self.model_name = model_name
        self.vector_dim = vector_dim
        self.api_key = os.getenv("OPENAI_API_KEY")
        if _OPENAI_AVAILABLE and self.api_key:
            self.client = openai.OpenAI(api_key=self.api_key)
        else:
            self.client = None

    def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        if self.client:
            try:
                response = self.client.embeddings.create(
                    model=self.model_name,
                    input=texts
                )
                return [d.embedding for d in response.data]
            except Exception as e:
                print(f"[Warning] OpenAI embedding call failed ({e}). Falling back to local vectors.")
        
        # Fallback deterministic normalized vector generator for offline/demo usage
        embeddings = []
        for text in texts:
            vec = [0.0] * self.vector_dim
            # Seed vector values deterministically based on words
            words = text.lower().split()
            for idx, word in enumerate(words):
                h = abs(hash(word)) % self.vector_dim
                vec[h] += 1.0 / (idx + 1)
            
            # Normalize vector (L2 norm)
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            norm_vec = [v / norm for v in vec]
            embeddings.append(norm_vec)

        return embeddings

    def get_embedding(self, text: str) -> List[float]:
        return self.get_embeddings([text])[0]


class VectorStoreManager:
    """
    Pinecone-backed Vector Store featuring:
    - Cosine similarity vector search via a persistent, managed Pinecone index
    - Metadata & payload filtering (module-wise & topic-wise retrieval)

    Falls back to an in-memory store when PINECONE_API_KEY isn't set (e.g. local
    development without credentials), so the app still runs without Pinecone configured.
    """

    def __init__(self):
        self.api_key = os.getenv("PINECONE_API_KEY")
        self.index_name = os.getenv("PINECONE_INDEX_NAME", "transcription-agent")
        self.dimension = 1536
        self.index = None
        self._fallback_store: List[Dict[str, Any]] = []

        if _PINECONE_AVAILABLE and self.api_key:
            try:
                pc = Pinecone(api_key=self.api_key)
                if not pc.has_index(self.index_name):
                    pc.create_index(
                        name=self.index_name,
                        dimension=self.dimension,
                        metric="cosine",
                        spec=ServerlessSpec(cloud="aws", region="us-east-1")
                    )
                self.index = pc.Index(self.index_name)
            except Exception as e:
                print(f"[Warning] Pinecone init failed ({e}). Falling back to in-memory vector store.")
                self.index = None

    def add_chunks(self, chunks: List[TextChunk], embeddings: List[List[float]]) -> None:
        if self.index is None:
            for chunk, emb in zip(chunks, embeddings):
                self._fallback_store.append({
                    "id": chunk.chunk_id,
                    "text": chunk.text,
                    "vector": emb,
                    "metadata": chunk.metadata.model_dump()
                })
            return

        vectors = []
        for chunk, emb in zip(chunks, embeddings):
            meta = {k: v for k, v in chunk.metadata.model_dump().items() if v is not None}
            meta["text"] = chunk.text
            vectors.append({"id": chunk.chunk_id, "values": emb, "metadata": meta})

        # Batch defensively in case a very large transcript produces many chunks
        for i in range(0, len(vectors), 100):
            self.index.upsert(vectors=vectors[i:i + 100])

    @staticmethod
    def _cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
        dot = sum(a * b for a, b in zip(vec_a, vec_b))
        norm_a = math.sqrt(sum(a * a for a in vec_a)) or 1.0
        norm_b = math.sqrt(sum(b * b for b in vec_b)) or 1.0
        return dot / (norm_a * norm_b)

    @staticmethod
    def _matches_filter(meta: Dict[str, Any], metadata_filter: Dict[str, str]) -> bool:
        for k, v in metadata_filter.items():
            target_val = str(meta.get(k, "")).lower()
            filter_val = str(v).lower()
            # Allow substring/exact matching for module or topic filtering
            if filter_val not in target_val and target_val not in filter_val:
                return False
        return True

    def search(self, query_vector: List[float], top_k: int = 3, metadata_filter: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        if self.index is None:
            return self._search_fallback(query_vector, top_k, metadata_filter)

        # Pinecone's native filter only supports exact-match operators, but callers rely on
        # fuzzy substring matching against heuristically-detected module/topic values. So we
        # over-fetch a wider candidate pool from Pinecone and apply the same substring filter
        # client-side before truncating to top_k, preserving the original matching behavior.
        fetch_k = top_k if not metadata_filter else min(max(top_k * 10, 50), 1000)
        response = self.index.query(vector=query_vector, top_k=fetch_k, include_metadata=True)

        results = []
        for match in response.matches:
            meta = dict(match.metadata or {})
            text = meta.pop("text", "")
            if metadata_filter and not self._matches_filter(meta, metadata_filter):
                continue
            results.append({
                "id": match.id,
                "text": text,
                "score": round(match.score, 4),
                "metadata": meta
            })
            if len(results) >= top_k:
                break

        return results

    def _search_fallback(self, query_vector: List[float], top_k: int, metadata_filter: Optional[Dict[str, str]]) -> List[Dict[str, Any]]:
        results = []
        for item in self._fallback_store:
            meta = item["metadata"]
            if metadata_filter and not self._matches_filter(meta, metadata_filter):
                continue
            sim = self._cosine_similarity(query_vector, item["vector"])
            results.append({
                "id": item["id"],
                "text": item["text"],
                "score": round(sim, 4),
                "metadata": meta
            })
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def keepalive(self) -> Dict[str, Any]:
        """Lightweight Pinecone activity ping. Used by the scheduled keep-alive cron
        (see /api/cron/pinecone-keepalive) to stop the free-tier index from being
        paused after 3 weeks of inactivity."""
        if self.index is None:
            return {"status": "SKIPPED", "reason": "Pinecone not configured"}
        stats = self.index.describe_index_stats()
        return {"status": "OK", "total_vector_count": stats.get("total_vector_count", 0)}

"""
demo_rag_ad_agent.py

End-to-End Demonstration Script:
1. Loads/creates sample course transcript text with modules and topics.
2. Performs Semantic Chunking (500-800 tokens per chunk with overlap).
3. Generates Embeddings (OpenAI text-embedding-3-small with fallback).
4. Stores in Vector DB with Metadata Payload Indexing.
5. Performs Metadata-Filtered Retrieval for Topic: "Hook Writing".
6. Generates 10 Ad Variations adhering to Course Tonality and Copy Framework.
7. Evaluates & Prints Quantitative Success Metrics Report.
"""

import os
import sys
from rag_pipeline import SemanticChunker, EmbeddingManager, VectorStoreManager
from ad_generator import AdGeneratorEngine


SAMPLE_COURSE_TRANSCRIPT = """
Module 1: Hook Writing & High-Converting Attention Frameworks
Speaker A: Welcome everyone to Module 1 of the Advanced Copywriting Masterclass. Today we are diving deep into hook writing. The first 3 seconds of your video ad determine 80% of your campaign ROI. If you can't interrupt the viewer's scroll pattern, the rest of your brilliant offer doesn't even matter.
Speaker B: Exactly Speaker A. When we analyze top-performing ads across millions in ad spend, winning hooks always leverage one of three core psychological drivers: pattern interruption, visceral pain point agitations, or contrarian hot-takes that challenge common industry assumptions.
Speaker A: Let's talk about the Hook-Problem-Agitate-Solution-CTA framework. First, your hook must be sharp. For example, "Stop scrolling if you are still manually writing ad copy in 2026." Next, you immediately agitate the problem: "Generic templates leave your brand looking identical to competitors while your customer acquisition costs double."
Speaker B: Then comes the solution and value proposition: "Our semantic transcript framework lets you build 10 distinct ad variations in under 5 minutes without losing your brand tonality." Finally, your Call To Action must be direct and low-friction: "Click the link below to get instant access to our masterclass and start scaling today."

Module 2: Offer Framing & Guarantee Strategy
Speaker A: Moving on to Module 2: Offer Framing. A strong hook gets attention, but a irresistible offer closes the deal. In this section, we cover risk reversal, stackable bonuses, and how to present pricing so the value obviously outweighs the cost.
Speaker B: Always ensure your guarantee is clear. If you offer a 30-day money-back guarantee, frame it around student outcomes rather than arbitrary time limits.
"""


def main():
    print("=" * 80)
    print("  COURSE TRANSCRIPT RAG & AD GENERATOR AGENT DEMO")
    print("=" * 80)

    # 1. Semantic Chunking Strategy
    print("\n[Step 1] Initializing Semantic Chunker (Target: 500-800 tokens, 100 overlap)...")
    chunker = SemanticChunker(target_min_tokens=500, target_max_tokens=800, overlap_tokens=100)
    
    # Check if a .docx file is supplied or exist in directory
    docx_files = [f for f in os.listdir('.') if f.endswith('.docx')]
    raw_text = SAMPLE_COURSE_TRANSCRIPT
    source_filename = "sample_course_transcript.txt"

    if docx_files:
        try:
            import docx
            input_file = docx_files[0]
            doc = docx.Document(input_file)
            extracted = "\n".join([p.text for p in doc.paragraphs if p.text.strip()])
            if extracted.strip():
                raw_text = extracted
                source_filename = input_file
                print(f"Loaded transcript from file: {input_file}")
        except Exception as e:
            print(f"Could not load docx file ({e}). Using built-in masterclass transcript sample.")

    chunks = chunker.chunk_text(
        text=raw_text,
        source_file=source_filename,
        default_module="Module 1: Hook Writing",
        default_topic="Hook Writing"
    )

    print(f"Total Semantic Chunks Created: {len(chunks)}")
    for i, c in enumerate(chunks, 1):
        print(f"  - Chunk {i} [{c.chunk_id}]: {c.metadata.token_count} tokens | Module: '{c.metadata.module}' | Topic: '{c.metadata.topic}'")

    # 2. Embedding Generation
    print("\n[Step 2] Generating Embeddings (OpenAI text-embedding-3-small)...")
    embedding_mgr = EmbeddingManager(model_name="text-embedding-3-small", vector_dim=1536)
    chunk_texts = [c.text for c in chunks]
    embeddings = embedding_mgr.get_embeddings(chunk_texts)
    print(f"Generated {len(embeddings)} vectors of dimension {len(embeddings[0])}.")

    # 3. Vector Database & Indexing with Payload Metadata
    print("\n[Step 3] Indexing Vectors & Metadata in Vector Database...")
    vector_store = VectorStoreManager()
    vector_store.add_chunks(chunks, embeddings)
    print(f"Successfully indexed {len(chunks)} chunks into Vector DB.")

    # 4. Metadata Filtering Verification
    print("\n[Step 4] Testing Metadata-Filtered Retrieval for Topic: 'Hook Writing'...")
    query = "How to write high converting hooks and ad frameworks"
    filtered_results = vector_store.search(
        query_vector=embedding_mgr.get_embedding(query),
        top_k=2,
        metadata_filter={"topic": "Hook Writing"}
    )
    print(f"Retrieved {len(filtered_results)} metadata-matched chunks:")
    for res in filtered_results:
        print(f"  [Score: {res['score']}] Module: {res['metadata']['module']} | Topic: {res['metadata']['topic']}")
        snippet = res['text'].replace('\n', ' ')[:120]
        print(f"   Snippet: \"{snippet}...\"")

    # 5. Ad Generation & 10 Ad Variations
    print("\n[Step 5] Generating 10 Structured Ad Variations Adhering to Course Tonality...")
    ad_engine = AdGeneratorEngine(vector_store=vector_store, embedding_manager=embedding_mgr)
    results = ad_engine.generate_10_ad_variations(
        product_or_course_name="Masterclass Copywriting Framework",
        topic_filter="Hook Writing",
        target_audience="Digital Marketers & Creators"
    )

    ad_variations = results["ad_variations"]
    metrics = results["success_metrics"]

    print(f"\nSuccessfully Generated {len(ad_variations)} Ad Variations!")
    print("-" * 80)
    for ad in ad_variations[:3]:  # Print first 3 in detail
        print(f"\n--- VARIATION {ad.variation_id}: {ad.target_angle} ---")
        print(f"HOOK: {ad.hook}")
        print(f"PROBLEM: {ad.problem_agitation}")
        print(f"SOLUTION: {ad.solution_value}")
        print(f"CTA: {ad.call_to_action}")
    
    print(f"\n... (Total 10 variations generated and formatted)")

    # 6. Success Metrics Evaluation Report
    print("\n" + "=" * 80)
    print("  SUCCESS METRICS EVALUATION REPORT")
    print("=" * 80)
    print(f"  Status                     : {metrics.status}")
    print(f"  Total Ad Variations        : {metrics.total_variations}")
    print(f"  Framework Adherence Score  : {metrics.framework_adherence_score}% (Target: >90%)")
    print(f"  Context Grounding Score    : {metrics.context_grounding_score}% (Alignment with course context)")
    print(f"  Variation Diversity Index  : {metrics.variation_diversity_index} (0.0 to 1.0 Jaccard distance)")
    print("=" * 80)

if __name__ == "__main__":
    main()

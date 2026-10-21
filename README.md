# Meta Ads Script Agent

An AI pipeline that turns a raw course/product transcript into a full Meta ad campaign — customer personas, benefits, ad angles, ad copy, video scripts, thumbnails, titles, and publishing metadata. FastAPI backend, RAG core over uploaded transcripts, static JS/HTML dashboard frontend.

## How it works

1. Upload a transcript (`.docx` or plain text) — it's chunked and embedded, then stored in a Pinecone vector index.
2. Each pipeline stage retrieves relevant context from that index and generates its output via OpenRouter (OpenAI models), scoring its own output against quality/brand-safety/compliance metrics.
3. Thumbs up/down feedback on generated ads is stored in Redis and fed back into future prompts as positive exemplars (active learning).

### Pipeline stages (`/api/generate-*`)

| Stage | File |
|---|---|
| Customer personas | [persona_generator.py](persona_generator.py) |
| Benefits extraction | [benefits_extractor.py](benefits_extractor.py) |
| Benefit -> ad angle matrix | [benefits_angle_agent.py](benefits_angle_agent.py) |
| Ad copy generation + audit | [ad_generator.py](ad_generator.py) |
| Video ad scripts | [video_script_agent.py](video_script_agent.py) |
| Creative direction | [creative_director_agent.py](creative_director_agent.py) |
| Thumbnail strategy + design brief | [thumbnail_strategist_agent.py](thumbnail_strategist_agent.py), [thumbnail_designer_agent.py](thumbnail_designer_agent.py) |
| Title strategy | [title_strategist_agent.py](title_strategist_agent.py) |
| Content brief | [content_brief_agent.py](content_brief_agent.py) |
| Campaign metadata (SEO/publishing) | [metadata_publisher_agent.py](metadata_publisher_agent.py) |
| Own ad double down (5 variations) | [own_ad_double_down_agent.py](own_ad_double_down_agent.py) |
| Competitor ad remixer (5 remixes) | [competitor_ad_remixer_agent.py](competitor_ad_remixer_agent.py) |

RAG core: [rag_pipeline.py](rag_pipeline.py) (chunking, embeddings, Pinecone-backed vector store). Supporting infra: [llm_retry.py](llm_retry.py) (shared retry/backoff wrapper for every OpenAI-compatible call), [cost_tracker.py](cost_tracker.py) (token/cost accounting), [tracer.py](tracer.py) (execution trace logging for the dashboard, optional LangSmith integration), [feedback_manager.py](feedback_manager.py) (Redis-backed feedback store).

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in your keys
uvicorn app:app --reload
```

Open `http://localhost:8000`.

### Required environment variables

See [.env.example](.env.example) for the full list:

- `OPENROUTER_API_KEY` — required for real generation. All chat completions, embeddings, and Whisper transcription route through OpenRouter (OpenAI models, `openai/`-prefixed, same pricing as calling OpenAI directly). Without it, agents fall back to templated placeholder output (a warning is logged).
- `PINECONE_API_KEY`, `PINECONE_INDEX_NAME` — persistent RAG vector store. Without these, the app falls back to an in-memory store that resets on restart.
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — persistent feedback store. Without these, falls back to a local JSON file.
- `CRON_SECRET` — authorizes the scheduled keep-alive request (see below).

## Deployment (Vercel)

Configured via [vercel.json](vercel.json): `app.py` runs as a Python serverless function, `static/` is served directly. Set the environment variables above in the Vercel project settings.

A daily cron job (`/api/cron/pinecone-keepalive`) pings the Pinecone index to prevent it from being auto-paused after 3 weeks of inactivity on the free tier.

## Testing

```bash
python eval_regression_suite.py
```

Runs the golden dataset regression suite ([golden_dataset.json](golden_dataset.json)) plus end-to-end checks across the RAG pipeline, ad generation/audit, and video script agents.

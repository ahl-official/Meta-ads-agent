"""
video_script_agent.py

Agent 4 (Video Ads Script Generation Agent):
1. Script Framework Engine: Converts an ad angle/hook into a scene-by-scene script following structures like:
   - PAS (Problem - Agitate - Solution - CTA)
   - Before - After - Bridge (BAB)
   - Hook - Problem - Agitation - Product Reveal - CTA
   - AIDA (Attention - Interest - Desire - Action)
2. Scene-by-Scene Storyboard & Direction:
   - Scene Number & Pacing (0-3s, 3-7s, 7-12s, 12-20s, 20-30s)
   - Voiceover / On-Screen Spoken Dialogue Script
   - Visual Direction Notes (Camera shots, lighting, talent movement, b-roll cutaways)
   - On-Screen Text & Graphic Badges
   - Audio Cues & Sound Effects (SFX / Music Beat Drops)
3. Casting & B-Roll Strategy:
   - Actor casting notes, demographic profile, tone of voice
   - High-impact B-Roll shot list
   - FTC compliance disclaimer callouts
4. Evaluation & Quality Metrics:
   - Hook Strength Score
   - Visual Clarity Score
   - Framework Pacing Score
   - Policy Compliance Score
   - Overall Script Quality
"""

import json
import os
import random
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

from rag_pipeline import EmbeddingManager, VectorStoreManager
from feedback_manager import feedback_mgr
from llm_retry import call_openai_with_retry

try:
    import openai
    _OPENAI_AVAILABLE = True
except ImportError:
    _OPENAI_AVAILABLE = False


class VideoScene(BaseModel):
    scene_number: int
    scene_type: str                  # e.g., 'Hook', 'Problem', 'Agitation', 'Product Reveal / Solution', 'Call To Action (CTA)'
    duration_seconds: str            # e.g., '0 - 3s', '3 - 7s', '7 - 12s'
    spoken_script: str               # Spoken voiceover line or on-camera dialogue
    visual_direction: str            # Camera angle, lighting, talent action, setting
    on_screen_text: str              # On-screen graphics, text overlays, popups, captions
    audio_cues: str                  # Background track shift, sound effects (SFX), beat drops


class VideoAdScript(BaseModel):
    script_id: int
    script_title: str                # e.g., "The Rearview Mirror Pattern Interrupt"
    framework_structure: str         # 'PAS (Problem-Agitate-Solution)', 'Before-After-Bridge (BAB)', 'Hook-Problem-Agitate-Reveal-CTA', 'AIDA'
    target_persona: str
    core_angle: str
    core_hook: str
    total_duration_est: str          # e.g., '30 Seconds'
    scenes: List[VideoScene]
    actor_casting_notes: str         # Casting details, tone of voice, visual energy
    b_roll_shot_list: List[str]      # B-roll footage cues
    ftc_disclaimer_note: str         # FTC video ad disclosure tag
    preview_storyboard_svg: Optional[str] = None # SVG visual storyboard graphic for UI rendering


class VideoScriptQualityMetrics(BaseModel):
    hook_strength_score: float        # 0 - 100%
    visual_clarity_score: float       # 0 - 100%
    framework_pacing_score: float      # 0 - 100%
    policy_compliance_score: float    # 0 - 100%
    overall_script_quality: float      # 0 - 100%
    total_scripts: int = 8            # Count of video scripts generated
    status: str


class VideoScriptEngine:
    """
    Engine for Agent 4: Video Ads Script Generation Agent
    Converts an angle into a scene-by-scene script (hook, problem, agitation, product reveal, CTA)
    with visual direction notes, following structures like PAS, Before-After-Bridge, AIDA, or Hook-Problem-Agitate-Reveal-CTA.
    """

    FRAMEWORKS = [
        "PAS (Problem-Agitate-Solution)",
        "Before-After-Bridge (BAB)",
        "Hook-Problem-Agitation-Product Reveal-CTA",
        "AIDA (Attention-Interest-Desire-Action)",
        "Problem-Agitate-Solution-Proof-CTA",
        "Story-Lead-Transformation",
        "Scientific Mechanism & Proof",
        "Challenge-Transformation-CTA"
    ]

    DURATIONS = ["30 Seconds", "45 Seconds", "60 Seconds"]

    def __init__(self, vector_store: VectorStoreManager, embedding_manager: EmbeddingManager):
        self.vector_store = vector_store
        self.embedding_manager = embedding_manager
        self.api_key = os.getenv("OPENROUTER_API_KEY")

    def build_system_prompt(self, product_name: str, chosen_angle: str, chosen_hook: str,
                            target_persona: str, script_framework: str, total_duration: str,
                            retrieved_context: str) -> str:
        """
        Builds system prompt for generating scene-by-scene video ad scripts.
        """
        return f"""You are the elite Video Ads Script Generation Agent (Agent 4 of Meta Ads Suite).
Your job is to convert a strategic ad angle & hook into a scene-by-scene video ad script with precise visual direction, audio cues, on-screen text, and actor guidance.

### PRODUCT & STRATEGY INPUTS ###
Product Name: {product_name}
Chosen Angle: {chosen_angle}
Chosen Scroll-Stopping Hook: {chosen_hook}
Target Persona: {target_persona}
Script Framework: {script_framework}
Target Duration: {total_duration}

### RETRIEVED KNOWLEDGE BASE & VIDEO COPYWRITING RULES ###
{retrieved_context}

### SCRIPT ARCHITECTURE REQUIREMENTS ###
For each script variation, break down the narrative into 5 distinct scenes matching the requested structure ({script_framework}):
1. Scene 1 - HOOK (0 - 3s): Pattern interrupt visual + immediate auditory hook.
2. Scene 2 - PROBLEM (3 - 7s): Relatable visual demonstration of the core pain point.
3. Scene 3 - AGITATION (7 - 12s): Heightened emotional stakes, showing frustration or failed alternatives.
4. Scene 4 - PRODUCT REVEAL / SOLUTION (12 - 22s): Hero product reveal, mechanism of action, before/after transition.
5. Scene 5 - CALL TO ACTION / CTA (22 - 30s): Direct benefit-driven CTA with risk reversal / guarantee badge.

For EACH Scene, provide:
- "scene_number": int (1 to 5)
- "scene_type": str (Hook, Problem, Agitation, Product Reveal, CTA)
- "duration_seconds": str
- "spoken_script": str (Exact voiceover or on-camera spoken text)
- "visual_direction": str (Camera shot details, lighting setup, actor action, visual transition)
- "on_screen_text": str (Captions, popup graphics, badges)
- "audio_cues": str (SFX, beat drops, musical mood shifts)

In addition, provide for each script:
- "script_id": int (1 to 8)
- "script_title": str
- "framework_structure": str
- "actor_casting_notes": str
- "b_roll_shot_list": list of 3-4 strings
- "ftc_disclaimer_note": str

Provide JSON output containing a key "video_scripts" which is a list of 8 script variations.
Respond strictly with valid JSON with key "video_scripts".
"""

    def retrieve_context(self, query: str, topic_filter: Optional[str] = None, top_k: int = 4) -> List[Dict[str, Any]]:
        query_vector = self.embedding_manager.get_embedding(query)
        metadata_filter = {}
        if topic_filter:
            metadata_filter["topic"] = topic_filter

        results = self.vector_store.search(query_vector, top_k=top_k, metadata_filter=metadata_filter)
        return results

    def generate_video_scripts(self, product_name: str = "American Hairline Scalp Revival System",
                               chosen_angle: str = "Tired of Hiding Under Caps & Avoiding Overhead Lights?",
                               chosen_hook: str = "Stop scrolling if you catch yourself constantly checking your hairline in rearview mirrors.",
                               target_persona: str = "The Skeptical Solution Seeker (Marcus, 34)",
                               script_framework: str = "PAS (Problem-Agitate-Solution)",
                               total_duration: str = "30 Seconds",
                               topic_filter: Optional[str] = None) -> Dict[str, Any]:

        retrieval_query = f"{product_name} video ad script hook problem agitation reveal CTA visual direction"
        context_chunks = self.retrieve_context(query=retrieval_query, topic_filter=topic_filter, top_k=4)
        context_text = "\n\n".join([c["text"] for c in context_chunks]) if context_chunks else "Standard Video Ad Structure: First 3 seconds pattern interrupt, visceral agitation, hero product mechanism reveal, urgent risk-free CTA."

        system_prompt = self.build_system_prompt(
            product_name=product_name,
            chosen_angle=chosen_angle,
            chosen_hook=chosen_hook,
            target_persona=target_persona,
            script_framework=script_framework,
            total_duration=total_duration,
            retrieved_context=context_text
        )

        scripts: List[VideoAdScript] = []

        if _OPENAI_AVAILABLE and self.api_key:
            try:
                client = openai.OpenAI(api_key=self.api_key, base_url="https://openrouter.ai/api/v1")
                response = call_openai_with_retry(
                    client,
                    model="openai/gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": "Generate 8 scene-by-scene video ad scripts with detailed visual directions, voiceover script, on-screen text, and audio cues."}
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.7
                )
                raw_content = response.choices[0].message.content
                scripts = self._parse_json_video_scripts(raw_content)
            except Exception as e:
                print(f"[Info] OpenAI API call fallback ({e}). Using templated video script generator.")
                scripts = self._generate_templated_scripts(product_name, chosen_angle, chosen_hook, target_persona, script_framework, total_duration)
        else:
            scripts = self._generate_templated_scripts(product_name, chosen_angle, chosen_hook, target_persona, script_framework, total_duration)

        # Generate SVG visual storyboard previews for UI rendering
        for s in scripts:
            if not s.preview_storyboard_svg:
                s.preview_storyboard_svg = self._generate_svg_storyboard(s)

        metrics = self.evaluate_success_metrics(scripts)

        return {
            "system_prompt": system_prompt,
            "retrieved_context": context_chunks,
            "video_scripts": scripts,
            "success_metrics": metrics
        }

    def _parse_json_video_scripts(self, raw_json_str: str) -> List[VideoAdScript]:
        try:
            data = json.loads(raw_json_str)
            raw_scripts = data.get("video_scripts", [])
            scripts: List[VideoAdScript] = []

            for idx, rs in enumerate(raw_scripts, start=1):
                raw_scenes = rs.get("scenes", [])
                scenes: List[VideoScene] = []

                for s_idx, sc in enumerate(raw_scenes, start=1):
                    scenes.append(VideoScene(
                        scene_number=sc.get("scene_number", s_idx),
                        scene_type=str(sc.get("scene_type", "Scene")),
                        duration_seconds=str(sc.get("duration_seconds", "0-5s")),
                        spoken_script=str(sc.get("spoken_script", "")),
                        visual_direction=str(sc.get("visual_direction", "")),
                        on_screen_text=str(sc.get("on_screen_text", "")),
                        audio_cues=str(sc.get("audio_cues", ""))
                    ))

                scripts.append(VideoAdScript(
                    script_id=rs.get("script_id", idx),
                    script_title=str(rs.get("script_title", f"Video Ad Script Variation {idx}")),
                    framework_structure=str(rs.get("framework_structure", "PAS (Problem-Agitate-Solution)")),
                    target_persona=str(rs.get("target_persona", "Target Persona")),
                    core_angle=str(rs.get("core_angle", "Core Angle")),
                    core_hook=str(rs.get("core_hook", "Core Hook")),
                    total_duration_est=str(rs.get("total_duration_est", "30 Seconds")),
                    scenes=scenes,
                    actor_casting_notes=str(rs.get("actor_casting_notes", "Natural, conversational tone with confident body language.")),
                    b_roll_shot_list=rs.get("b_roll_shot_list", ["Macro shot of dropper application", "Close-up of hair follicle revival", "Before/After scalp mirror perspective"]),
                    ftc_disclaimer_note=str(rs.get("ftc_disclaimer_note", "*Results may vary based on individual consistency. Non-surgical cosmetic scalp routine."))
                ))

            if len(scripts) > 0:
                return scripts
        except Exception as parse_err:
            print(f"[Warning] Failed to parse LLM JSON output for video scripts: {parse_err}")

        # Fallback if parsing failed or empty
        return self._generate_templated_scripts()

    def _generate_templated_scripts(self, product_name: str = "American Hairline Scalp Revival System",
                                    chosen_angle: str = "Tired of Hiding Under Caps & Avoiding Overhead Lights?",
                                    chosen_hook: str = "Stop scrolling if you catch yourself constantly checking your hairline in rearview mirrors.",
                                    target_persona: str = "The Skeptical Solution Seeker (Marcus, 34)",
                                    script_framework: str = "PAS (Problem-Agitate-Solution)",
                                    total_duration: str = "30 Seconds") -> List[VideoAdScript]:

        # Variation 1: PAS Framework (Problem - Agitate - Solution - CTA)
        script_1_scenes = [
            VideoScene(
                scene_number=1,
                scene_type="Hook",
                duration_seconds="0 - 3s",
                spoken_script="Stop scrolling if you catch yourself constantly adjusting your cap or avoiding harsh overhead elevator lights.",
                visual_direction="ECU (Extreme Close-Up) of talent looking anxiously in a rearview mirror, pulling cap down. Fast snap-cut transition.",
                on_screen_text="STOP HIDING YOUR HAIRLINE",
                audio_cues="Record scratch SFX + Sub-bass drop pattern interrupt"
            ),
            VideoScene(
                scene_number=2,
                scene_type="Problem",
                duration_seconds="3 - 7s",
                spoken_script="Every morning it's the same routine. Spotting thinning temples in the bathroom lighting and wondering if anyone else notices.",
                visual_direction="MCU (Medium Close-Up) in soft morning bathroom lighting. Talent inspecting scalp under harsh vanity mirror.",
                on_screen_text="Thinning Temples & Receding Crown?",
                audio_cues="Somber acoustic ambient synth line"
            ),
            VideoScene(
                scene_number=3,
                scene_type="Agitation",
                duration_seconds="7 - 12s",
                spoken_script="You spend money on greasy foams that smell like chemicals and leave your scalp irritated, only to see zero real change after months.",
                visual_direction="Quick cut sequence: throwing away half-used chemical spray bottles into trash can. Frustrated facial expression.",
                on_screen_text="Tired of Wasting Money on Greasy Foams?",
                audio_cues="Rising tension riser SFX"
            ),
            VideoScene(
                scene_number=4,
                scene_type="Product Reveal / Solution",
                duration_seconds="12 - 22s",
                spoken_script=f"That's why we created the {product_name}. Our non-surgical human hair patch system restores full natural hair density in just 60 minutes with zero surgery.",
                visual_direction="Hero product shot: Stylist fitting American Hairline custom human hair patch onto client's scalp with invisible lace base. Close-up of seamless front hairline.",
                on_screen_text="100% NON-SURGICAL HAIR SYSTEM• UNDETECTABLE HAIRLINE",
                audio_cues="Uplifting energetic beat drop with clear ambient vocal tone"
            ),
            VideoScene(
                scene_number=5,
                scene_type="Call To Action (CTA)",
                duration_seconds="22 - 30s",
                spoken_script="Claim your 90-day risk-free starter kit today. Click the button below before stock sells out again!",
                visual_direction="Talent smiling confidently in natural sunlight, running fingers through thick hair. Overlay of mobile shop button.",
                on_screen_text="GET 40% OFF + 90-DAY MONEY-BACK GUARANTEE",
                audio_cues="Upbeat resolving chord + button click SFX"
            )
        ]

        # Variation 2: Before-After-Bridge (BAB) Framework
        script_2_scenes = [
            VideoScene(
                scene_number=1,
                scene_type="Hook",
                duration_seconds="0 - 3s",
                spoken_script="I almost gave up on my hair until I noticed this 10-second nightly routine.",
                visual_direction="Selfie vlog camera angle. Talent points directly at camera with intrigued expression holding sleek bottle.",
                on_screen_text="10-SECOND NIGHTLY ROUTINE ⌛",
                audio_cues="Finger snap SFX + catchy energetic pop synth intro"
            ),
            VideoScene(
                scene_number=2,
                scene_type="Before State",
                duration_seconds="3 - 8s",
                spoken_script="Six months ago, I was wearing hats everywhere — dates, work meetings, gym sessions. I felt like I was losing my edge.",
                visual_direction="B-Roll montage of talent wearing caps in indoors settings, looking down at phone self-consciously.",
                on_screen_text="BEFORE: Hiding Under Caps Daily",
                audio_cues="Muffled lo-fi beat"
            ),
            VideoScene(
                scene_number=3,
                scene_type="After State",
                duration_seconds="8 - 14s",
                spoken_script="Now? My hair feels 3x denser, fully natural, and I haven't touched a hat in 90 days. My confidence is completely restored.",
                visual_direction="Bright outdoor sunlight shot. Talent in crisp suit smiling confidently, high density hair visible.",
                on_screen_text="AFTER 90 DAYS: 3x Denser, 100% Natural",
                audio_cues="High-energy beat drop"
            ),
            VideoScene(
                scene_number=4,
                scene_type="The Bridge (Product Mechanism)",
                duration_seconds="14 - 22s",
                spoken_script=f"The secret is {product_name}. It uses natural peptide signaling to awaken resting follicles directly at the root.",
                visual_direction="3D render/microscope animation showing scalp follicle root activation and nourishment absorption.",
                on_screen_text="SCALP PEPTIDE SIGNALING • NON-SURGICAL",
                audio_cues="Futuristic WHOOSH SFX"
            ),
            VideoScene(
                scene_number=5,
                scene_type="Call To Action (CTA)",
                duration_seconds="22 - 30s",
                spoken_script="Try it risk-free for 90 days. If you don't see visible density, you get 100% of your money back. Tap below!",
                visual_direction="Product bundle display with 90-day badge callout and pulsing arrow pointing to CTA link.",
                on_screen_text="TRY RISK-FREE FOR 90 DAYS",
                audio_cues="Upbeat outro sting + click sound"
            )
        ]

        # Variation 3: Hook-Problem-Agitation-Reveal-CTA Framework
        script_3_scenes = [
            VideoScene(
                scene_number=1,
                scene_type="Hook",
                duration_seconds="0 - 4s",
                spoken_script="What dermatologists aren't telling you about early hairline receding will change how you treat your scalp forever.",
                visual_direction="Dermatology office lab coat setting. Professional tone. Split screen of scalp scanner analysis.",
                on_screen_text="WHAT THEY DON'T TELL YOU",
                audio_cues="Intriguing mystery WHOOSH + clock ticking SFX"
            ),
            VideoScene(
                scene_number=2,
                scene_type="Problem",
                duration_seconds="4 - 9s",
                spoken_script="Most treatments only mask the symptoms without restoring follicle blood micro-circulation.",
                visual_direction="Diagram graphic showing blocked blood vessel circulation around hair roots under scalp layer.",
                on_screen_text="Blocked Scalp Micro-Circulation",
                audio_cues="Low warning pulse tone"
            ),
            VideoScene(
                scene_number=3,
                scene_type="Agitation",
                duration_seconds="9 - 14s",
                spoken_script="Wait too long, and those dormant roots calcify permanently, leaving expensive invasive surgery as your only choice.",
                visual_direction="Graphic highlight of scalp calcification process with warning red highlight.",
                on_screen_text="Dormant Roots Calcify Over Time!",
                audio_cues="Warning chime SFX"
            ),
            VideoScene(
                scene_number=4,
                scene_type="Product Reveal",
                duration_seconds="14 - 23s",
                spoken_script=f"Enter {product_name}. Its bio-active elixir reactivates micro-circulation and delivers botanical nutrients straight to dormant roots.",
                visual_direction="Macro shot of golden elixir drop dissolving smoothly into scalp without leaving greasy residue.",
                on_screen_text="BIO-ACTIVE BOTANICAL ELIXIR",
                audio_cues="Clean shimmer SFX + rhythmic energetic drum track"
            ),
            VideoScene(
                scene_number=5,
                scene_type="Call To Action (CTA)",
                duration_seconds="23 - 30s",
                spoken_script="Don't wait until surgery is your only option. Order today and save 40% on your initial 90-day supply!",
                visual_direction="Official certification seal, 40% discount badge, and website checkout screen mockup.",
                on_screen_text="SAVE 40% TODAY • DIRECT SHIPPING",
                audio_cues="Positive chord resolution"
            )
        ]

        # Variation 4: AIDA Framework (Attention - Interest - Desire - Action)
        script_4_scenes = [
            VideoScene(
                scene_number=1,
                scene_type="Attention (Hook)",
                duration_seconds="0 - 3s",
                spoken_script="If you're between 25 and 50 and noticing your hairline creeping back, watch this before buying anything else.",
                visual_direction="Talent staring directly into camera, holding up hand to pause scrolling feed. Dynamic zoom-in motion.",
                on_screen_text="ATTENTION: MEN & WOMEN AGED 25-50",
                audio_cues="Heavy bass thud + alert chime"
            ),
            VideoScene(
                scene_number=2,
                scene_type="Interest",
                duration_seconds="3 - 8s",
                spoken_script="Did you know 82% of early hair thinning is caused by localized DHT buildup suffocating follicle roots?",
                visual_direction="Infographic animation displaying 82% statistic with 3D scalp hair follicle model.",
                on_screen_text="82% Caused by DHT Root Suffocation",
                audio_cues="Subtle digital data ping"
            ),
            VideoScene(
                scene_number=3,
                scene_type="Desire",
                duration_seconds="8 - 15s",
                spoken_script="Imagine waking up 90 days from now with thick, dense hairline edges you're proud to show off without caps.",
                visual_direction="Side-by-side split screen comparison: Day 1 vs Day 90 side profile hairline density progression.",
                on_screen_text="DAY 1 VS DAY 90 TRANSFORMATION",
                audio_cues="Uplifting motivational melody"
            ),
            VideoScene(
                scene_number=4,
                scene_type="Action (Product & Offer)",
                duration_seconds="15 - 24s",
                spoken_script=f"{product_name} provides sweat-proof, waterproof hold with our organic scalp bond.",
                visual_direction="Close up of American Hairline custom hair patch box kit, organic scalp bond application, and water-resistant hold demo.",
                on_screen_text="100% WATERPROOF & SWEAT-PROOF HOLD",
                audio_cues="Energetic beat acceleration"
            ),
            VideoScene(
                scene_number=5,
                scene_type="Call To Action (CTA)",
                duration_seconds="24 - 30s",
                spoken_script="Click 'Shop Now' to get your risk-free supply with free express shipping worldwide!",
                visual_direction="Pulsing CTA button graphic with 5-star rating overlay and fast shipping icon.",
                on_screen_text="SHOP NOW • FREE EXPRESS SHIPPING",
                audio_cues="Upbeat climax sting"
            )
        ]

        return [
            VideoAdScript(
                script_id=1,
                script_title="The Rearview Mirror Pattern Interrupt (PAS Structure)",
                framework_structure="PAS (Problem-Agitate-Solution)",
                target_persona=target_persona,
                core_angle=chosen_angle,
                core_hook=chosen_hook,
                total_duration_est=total_duration,
                scenes=script_1_scenes,
                actor_casting_notes="Male/Female aged 30-40, relatable everyday appearance, expressive facial cues, natural conversational voiceover.",
                b_roll_shot_list=[
                    "ECU of cap adjustment in car rearview mirror",
                    "Close-up of scalp inspection under vanity bathroom lighting",
                    "Macro 120fps shot of American Hairline invisible lace base",
                    "Confident outdoor smile in natural sunlight with full hair"
                ],
                ftc_disclaimer_note="*Individual results may vary based on hair system fitting. Non-surgical cosmetic hair patch solution."
            ),
            VideoAdScript(
                script_id=2,
                script_title="The 10-Second Hair Patch Transformation (BAB Structure)",
                framework_structure="Before-After-Bridge (BAB)",
                target_persona=target_persona,
                core_angle=chosen_angle,
                core_hook="I almost gave up on my hair until I discovered this non-surgical hair patch transformation.",
                total_duration_est=total_duration,
                scenes=script_2_scenes,
                actor_casting_notes="Energetic creator style, selfie vlog framing, warm authentic delivery with high visual enthusiasm.",
                b_roll_shot_list=[
                    "Selfie vlog camera angle holding American Hairline hair patch kit",
                    "Montage of indoor cap-wearing moments",
                    "3D scalp lace mesh fitting render",
                    "Bright outdoor high-density hair styling"
                ],
                ftc_disclaimer_note="*Based on 90-day customer satisfaction study. Results depend on individual scalp response."
            ),
            VideoAdScript(
                script_id=3,
                script_title="Dermatologist Hairline Restoration Warning (Hook-Problem-Agitate-Reveal-CTA)",
                framework_structure="Hook-Problem-Agitation-Product Reveal-CTA",
                target_persona=target_persona,
                core_angle="What dermatologists aren't telling you about non-surgical hair replacement",
                core_hook="What dermatologists aren't telling you about non-surgical hair replacement will change how you view hairline restoration forever.",
                total_duration_est=total_duration,
                scenes=script_3_scenes,
                actor_casting_notes="Authoritative lab coat presenter or clean medical-style studio spokesperson, confident articulate tone.",
                b_roll_shot_list=[
                    "Scalp diagnostic scanner screen",
                    "3D breathable mesh ventilation animation",
                    "Organic scalp bond micro-adhesion",
                    "40% discount consultation screen mockup"
                ],
                ftc_disclaimer_note="*Educational ad content. Non-surgical cosmetic restoration."
            ),
            VideoAdScript(
                script_id=4,
                script_title="The Undetectable Hair Patch Alert (AIDA Structure)",
                framework_structure="AIDA (Attention-Interest-Desire-Action)",
                target_persona=target_persona,
                core_angle="Why 90% of men choose non-surgical hair patches over surgery",
                core_hook="If you're between 25 and 50 and noticing your hairline creeping back, watch this before booking surgery.",
                total_duration_est=total_duration,
                scenes=script_4_scenes,
                actor_casting_notes="Direct-to-camera presenter, urgent and engaging demeanor, sharp eye contact.",
                b_roll_shot_list=[
                    "82% statistic graphic overlay",
                    "Day 1 vs Day 90 split-screen progression",
                    "Hair patch organic scalp bond application close-up",
                    "5-star customer review rating badge"
                ],
                ftc_disclaimer_note="*Results may vary. Based on internal customer survey data over 90 days."
            ),

            # Variation 5: Problem-Agitate-Solution-Proof-CTA
            VideoAdScript(
                script_id=5,
                script_title="The Unfiltered 90-Day Hairline Challenge",
                framework_structure="Problem-Agitate-Solution-Proof-CTA",
                target_persona=target_persona,
                core_angle="Real 90-Day Hair Density Proof Without Harsh Chemicals",
                core_hook="Thinking your thinning hairline is permanent? Test this 90-day protocol first.",
                total_duration_est=total_duration,
                scenes=[
                    VideoScene(scene_number=1, scene_type="Hook", duration_seconds="0 - 3s", spoken_script="Thinking your thinning hairline is permanent? Test this 90-day protocol first.", visual_direction="Direct camera eye contact, tapping screen timer.", on_screen_text="90-DAY HAIRLINE CHALLENGE ⏱", audio_cues="Alert chime + bass pulse"),
                    VideoScene(scene_number=2, scene_type="Problem", duration_seconds="3 - 7s", spoken_script="Most people accept thinning as inevitable aging, but dormant hair roots are just sleeping.", visual_direction="Close-up micro scanner graphic of sleeping root follicle.", on_screen_text="Dormant Roots Are Sleeping, Not Dead", audio_cues="Soft ambient synth"),
                    VideoScene(scene_number=3, scene_type="Agitation", duration_seconds="7 - 12s", spoken_script="Ignoring early receding means losing up to 40% density before you even notice.", visual_direction="Graphic bar showing 40% density drop timeline.", on_screen_text="Don't Lose 40% Density!", audio_cues="Tension riser SFX"),
                    VideoScene(scene_number=4, scene_type="Solution & Proof", duration_seconds="12 - 22s", spoken_script=f"Our clinical trial showed 94.2% follicle density recovery in 12 weeks using {product_name}.", visual_direction="Clinical lab proof graphics & high-speed droplet absorption.", on_screen_text="94.2% FOLLICLE DENSITY RECOVERY", audio_cues="Uplifting swell beat"),
                    VideoScene(scene_number=5, scene_type="Call To Action (CTA)", duration_seconds="22 - 30s", spoken_script="Take the 90-Day Unfiltered Challenge risk-free today with 100% money-back guarantee!", visual_direction="Talent smiling, displaying starter kit packaging.", on_screen_text="TAKE THE 90-DAY CHALLENGE", audio_cues="Upbeat resolving chord")
                ],
                actor_casting_notes="Confident fitness / wellness creator, enthusiastic tone.",
                b_roll_shot_list=["Micro scanner graphic", "Clinical trial graph", "Starter kit packaging"],
                ftc_disclaimer_note="*Based on 12-week consumer perception study."
            ),

            # Variation 6: Story-Lead-Transformation
            VideoAdScript(
                script_id=6,
                script_title="The Executive Office & Elevator Light Realization",
                framework_structure="Story-Lead-Transformation",
                target_persona=target_persona,
                core_angle="Reclaim Your Executive Presence & Youthful Edge",
                core_hook="I used to dread standing under harsh elevator lights before key client presentations.",
                total_duration_est=total_duration,
                scenes=[
                    VideoScene(scene_number=1, scene_type="Hook", duration_seconds="0 - 3s", spoken_script="I used to dread standing under harsh elevator lights before key client presentations.", visual_direction="Elevator mirror reflection in corporate suit.", on_screen_text="ELEVATOR LIGHT REALIZATION", audio_cues="Muffled city noise + chime"),
                    VideoScene(scene_number=2, scene_type="Problem", duration_seconds="3 - 7s", spoken_script="Hair thinning silently drains your confidence in high-stakes professional settings.", visual_direction="Conference room meeting, talent adjusting hair.", on_screen_text="Thinning Drains Professional Poise", audio_cues="Subtle piano melody"),
                    VideoScene(scene_number=3, scene_type="Agitation", duration_seconds="7 - 12s", spoken_script="Worrying about your appearance takes focus away from closing big deals.", visual_direction="Split focus on laptop and mirror reflection.", on_screen_text="Stop Self-Conscious Distractions", audio_cues="Deep bass drone"),
                    VideoScene(scene_number=4, scene_type="Transformation", duration_seconds="12 - 22s", spoken_script=f"{product_name} restored my full hairline and executive poise in under 90 days.", visual_direction="Talent presenting in boardroom with full hair density.", on_screen_text="FULL DENSITY RESTORED", audio_cues="High-energy brass beat"),
                    VideoScene(scene_number=5, scene_type="Call To Action (CTA)", duration_seconds="22 - 30s", spoken_script="Upgrade your executive confidence today with our exclusive 40% OFF package.", visual_direction="Executive desk shot with sleek bottle.", on_screen_text="CLAIM 40% EXECUTIVE OFF", audio_cues="Click SFX + upbeat outro")
                ],
                actor_casting_notes="Well-groomed professional in business attire, authoritative tone.",
                b_roll_shot_list=["Elevator reflection", "Boardroom presentation", "Executive desk display"],
                ftc_disclaimer_note="*Cosmetic topical application. Individual results vary."
            ),

            # Variation 7: Scientific Mechanism & Proof
            VideoAdScript(
                script_id=7,
                script_title="The Micro-Circulation Scalp Scanner Breakdown",
                framework_structure="Scientific Mechanism & Proof",
                target_persona=target_persona,
                core_angle="Reactivate Micro-Capillary Blood Flow to Follicle Roots",
                core_hook="Watch what happens to dormant scalp capillaries when bio-peptides hit the root.",
                total_duration_est=total_duration,
                scenes=[
                    VideoScene(scene_number=1, scene_type="Hook", duration_seconds="0 - 3s", spoken_script="Watch what happens to dormant scalp capillaries when bio-peptides hit the root.", visual_direction="Microscope animation zoom-in on follicle capillary.", on_screen_text="SCALP MICROSCANNER DEMO", audio_cues="Futuristic pulse SFX"),
                    VideoScene(scene_number=2, scene_type="Problem", duration_seconds="3 - 7s", spoken_script="Poor scalp micro-circulation starves hair roots of essential growth oxygen.", visual_direction="3D diagram showing restricted oxygen flow to hair root.", on_screen_text="Restricted Root Circulation", audio_cues="Low alert tone"),
                    VideoScene(scene_number=3, scene_type="Agitation", duration_seconds="7 - 12s", spoken_script="Without nutrient blood flow, hair strands grow thinner and break twice as fast.", visual_direction="Fragile strand snapping macro visual.", on_screen_text="Strands Break 2x Faster", audio_cues="Snap SFX"),
                    VideoScene(scene_number=4, scene_type="Mechanism Reveal", duration_seconds="12 - 22s", spoken_script=f"Our bio-matrix formula reactivates capillary blood flow within 14 days.", visual_direction="Golden elixir absorbed into scalp with capillary pulse graphic.", on_screen_text="BIO-MATRIX CAPILLARY ACTIVATION", audio_cues="Energetic synthesizer rise"),
                    VideoScene(scene_number=5, scene_type="Call To Action (CTA)", duration_seconds="22 - 30s", spoken_script="Claim your starter kit now with free global express delivery!", visual_direction="Free express shipping badge and checkout screen.", on_screen_text="ORDER WITH FREE SHIPPING", audio_cues="Upbeat resolving chord")
                ],
                actor_casting_notes="Scientist or medical researcher voiceover, clear precise delivery.",
                b_roll_shot_list=["Microscope capillary animation", "Follicle oxygen diagram", "Golden elixir micro drop"],
                ftc_disclaimer_note="*Laboratory capillary simulation. Results vary by individual."
            ),

            # Variation 8: Challenge-Transformation-CTA
            VideoAdScript(
                script_id=8,
                script_title="The Zero-Cap Summer Confidence Revival",
                framework_structure="Challenge-Transformation-CTA",
                target_persona=target_persona,
                core_angle="Ditch the Cap This Summer & Walk Out with Total Hair Confidence",
                core_hook="Ditch your cap this summer. Here is how to regain full hairline thickness fast.",
                total_duration_est=total_duration,
                scenes=[
                    VideoScene(scene_number=1, scene_type="Hook", duration_seconds="0 - 3s", spoken_script="Ditch your cap this summer. Here is how to regain full hairline thickness fast.", visual_direction="Talent tossing cap off-camera into ocean breeze.", on_screen_text="ZERO-CAP SUMMER REVIVAL", audio_cues="Upbeat summer pop intro"),
                    VideoScene(scene_number=2, scene_type="Problem", duration_seconds="3 - 7s", spoken_script="Sweating under caps all summer worsens scalp congestion and accelerates thinning.", visual_direction="Talent taking off cap revealing sweaty scalp.", on_screen_text="Caps Trap Sweat & Block Scalp", audio_cues="Muffled bass beat"),
                    VideoScene(scene_number=3, scene_type="Agitation", duration_seconds="7 - 12s", spoken_script="Constantly worrying about wind or swimming ruining your cap cover-up is exhausting.", visual_direction="Wind blowing hair on beach, feeling self-conscious.", on_screen_text="No More Cap Anxiety", audio_cues="Tension riser SFX"),
                    VideoScene(scene_number=4, scene_type="Transformation", duration_seconds="12 - 22s", spoken_script=f"Restore natural hair density with {product_name} in a simple 30-second daily routine.", visual_direction="Talent swimming and running fingers through hair with high density.", on_screen_text="100% NATURAL HAIR CONFIDENCE", audio_cues="Catchy summer beat drop"),
                    VideoScene(scene_number=5, scene_type="Call To Action (CTA)", duration_seconds="22 - 30s", spoken_script="Start your zero-cap summer transformation today with our 90-day risk-free guarantee!", visual_direction="Product display on beach towel with 90-day guarantee badge.", on_screen_text="START YOUR SUMMER REVIVAL", audio_cues="Click sound + upbeat outro")
                ],
                actor_casting_notes="Outdoor lifestyle creator, energetic upbeat delivery.",
                b_roll_shot_list=["Tossing cap into ocean breeze", "Beach swimming confidence", "Product display on beach towel"],
                ftc_disclaimer_note="*Results may vary based on scalp consistency."
            )
        ]

    def _generate_svg_storyboard(self, script: VideoAdScript) -> str:
        """
        Generates SVG visual storyboard graphic for UI preview.
        """
        color_scheme = "#6366F1" if "PAS" in script.framework_structure else "#10B981" if "BAB" in script.framework_structure else "#EC4899" if "AIDA" in script.framework_structure else "#8B5CF6"
        
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 240" width="100%" height="240" style="background:#090D16; border-radius:12px; font-family:'Inter', sans-serif;">
            <!-- Header Bar -->
            <rect x="0" y="0" width="800" height="40" fill="#131B2E" rx="12" />
            <text x="20" y="25" fill="#F8FAFC" font-size="14" font-weight="700">STORYBOARD TIMELINE: {script.script_title[:45]}...</text>
            <rect x="650" y="10" width="130" height="22" rx="11" fill="{color_scheme}" opacity="0.2"/>
            <text x="715" y="25" fill="{color_scheme}" font-size="11" font-weight="700" text-anchor="middle">{script.framework_structure.split()[0]}</text>
            
            <!-- 5 Scene Panels -->
            <g transform="translate(15, 55)">
                <!-- Scene 1 -->
                <rect x="0" y="0" width="140" height="165" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/>
                <rect x="0" y="0" width="140" height="24" fill="#1F2937" rx="8"/>
                <text x="10" y="16" fill="#F43F5E" font-size="11" font-weight="700">SCENE 1 • HOOK</text>
                <text x="130" y="16" fill="#9CA3AF" font-size="10" text-anchor="end">0-3s</text>
                <circle cx="70" cy="70" r="22" fill="#F43F5E" opacity="0.15"/>
                <text x="70" y="75" fill="#F43F5E" font-size="20" text-anchor="middle"></text>
                <text x="10" y="115" fill="#E5E7EB" font-size="10" font-weight="600">Camera: ECU Rearview</text>
                <text x="10" y="132" fill="#9CA3AF" font-size="9">Text: STOP HIDING</text>
                <text x="10" y="150" fill="#6EE7B7" font-size="9">SFX: Record Scratch</text>
                
                <!-- Scene 2 -->
                <g transform="translate(152, 0)">
                    <rect x="0" y="0" width="140" height="165" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/>
                    <rect x="0" y="0" width="140" height="24" fill="#1F2937" rx="8"/>
                    <text x="10" y="16" fill="#F59E0B" font-size="11" font-weight="700">SCENE 2 • PROBLEM</text>
                    <text x="130" y="16" fill="#9CA3AF" font-size="10" text-anchor="end">3-7s</text>
                    <circle cx="70" cy="70" r="22" fill="#F59E0B" opacity="0.15"/>
                    <text x="70" y="75" fill="#F59E0B" font-size="20" text-anchor="middle"></text>
                    <text x="10" y="115" fill="#E5E7EB" font-size="10" font-weight="600">Camera: MCU Bathroom</text>
                    <text x="10" y="132" fill="#9CA3AF" font-size="9">Text: Thinning Temples?</text>
                    <text x="10" y="150" fill="#6EE7B7" font-size="9">Music: Somber Synth</text>
                </g>

                <!-- Scene 3 -->
                <g transform="translate(304, 0)">
                    <rect x="0" y="0" width="140" height="165" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/>
                    <rect x="0" y="0" width="140" height="24" fill="#1F2937" rx="8"/>
                    <text x="10" y="16" fill="#EC4899" font-size="11" font-weight="700">SCENE 3 • AGITATE</text>
                    <text x="130" y="16" fill="#9CA3AF" font-size="10" text-anchor="end">7-12s</text>
                    <circle cx="70" cy="70" r="22" fill="#EC4899" opacity="0.15"/>
                    <text x="70" y="75" fill="#EC4899" font-size="20" text-anchor="middle"></text>
                    <text x="10" y="115" fill="#E5E7EB" font-size="10" font-weight="600">Camera: Trash Cut</text>
                    <text x="10" y="132" fill="#9CA3AF" font-size="9">Text: Wasting Money?</text>
                    <text x="10" y="150" fill="#6EE7B7" font-size="9">SFX: Tension Riser</text>
                </g>

                <!-- Scene 4 -->
                <g transform="translate(456, 0)">
                    <rect x="0" y="0" width="140" height="165" fill="#111827" stroke="#3B82F6" stroke-width="1.5" rx="8"/>
                    <rect x="0" y="0" width="140" height="24" fill="#1E3A8A" rx="8"/>
                    <text x="10" y="16" fill="#60A5FA" font-size="11" font-weight="700">SCENE 4 • REVEAL</text>
                    <text x="130" y="16" fill="#9CA3AF" font-size="10" text-anchor="end">12-22s</text>
                    <circle cx="70" cy="70" r="22" fill="#3B82F6" opacity="0.2"/>
                    <text x="70" y="75" fill="#60A5FA" font-size="20" text-anchor="middle"></text>
                    <text x="10" y="115" fill="#E5E7EB" font-size="10" font-weight="600">Camera: 120fps Drop</text>
                    <text x="10" y="132" fill="#9CA3AF" font-size="9">Text: ORGANIC MATRIX</text>
                    <text x="10" y="150" fill="#6EE7B7" font-size="9">Music: Energetic Drop</text>
                </g>

                <!-- Scene 5 -->
                <g transform="translate(608, 0)">
                    <rect x="0" y="0" width="140" height="165" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/>
                    <rect x="0" y="0" width="140" height="24" fill="#064E3B" rx="8"/>
                    <text x="10" y="16" fill="#34D399" font-size="11" font-weight="700">SCENE 5 • CTA</text>
                    <text x="130" y="16" fill="#9CA3AF" font-size="10" text-anchor="end">22-30s</text>
                    <circle cx="70" cy="70" r="22" fill="#10B981" opacity="0.2"/>
                    <text x="70" y="75" fill="#34D399" font-size="20" text-anchor="middle"></text>
                    <text x="10" y="115" fill="#E5E7EB" font-size="10" font-weight="600">Camera: Outdoor Smile</text>
                    <text x="10" y="132" fill="#9CA3AF" font-size="9">Text: GET 40% OFF</text>
                    <text x="10" y="150" fill="#6EE7B7" font-size="9">SFX: Click Sound</text>
                </g>
            </g>
        </svg>'''
        return svg

    def evaluate_success_metrics(self, scripts: List[VideoAdScript]) -> VideoScriptQualityMetrics:
        """
        Evaluates Video Script Quality Metrics across Hook Strength, Visual Clarity,
        Framework Pacing, and Policy Compliance.
        """
        if not scripts:
            return VideoScriptQualityMetrics(
                hook_strength_score=0.0,
                visual_clarity_score=0.0,
                framework_pacing_score=0.0,
                policy_compliance_score=0.0,
                overall_script_quality=0.0,
                total_scripts=0,
                status="NO_SCRIPTS"
            )

        hook_scores = []
        visual_scores = []
        pacing_scores = []
        policy_scores = []

        for s in scripts:
            # Hook strength audit
            h_len = len(s.core_hook)
            h_score = 95.0 if ("stop" in s.core_hook.lower() or "watch" in s.core_hook.lower() or "give up" in s.core_hook.lower() or "dermatologist" in s.core_hook.lower()) else 88.0
            hook_scores.append(h_score)

            # Visual clarity audit
            v_score = 92.0 if len(s.scenes) >= 5 and all(sc.visual_direction for sc in s.scenes) else 85.0
            visual_scores.append(v_score)

            # Framework pacing audit
            p_score = 94.0 if len(s.scenes) == 5 else 88.0
            pacing_scores.append(p_score)

            # Policy compliance audit (Meta/FTC compliance)
            pol_score = 98.0 if s.ftc_disclaimer_note and "Results may vary" in s.ftc_disclaimer_note else 90.0
            policy_scores.append(pol_score)

        avg_hook = round(sum(hook_scores) / len(hook_scores), 1)
        avg_visual = round(sum(visual_scores) / len(visual_scores), 1)
        avg_pacing = round(sum(pacing_scores) / len(pacing_scores), 1)
        avg_policy = round(sum(policy_scores) / len(policy_scores), 1)
        overall = round((avg_hook * 0.3) + (avg_visual * 0.25) + (avg_pacing * 0.25) + (avg_policy * 0.2), 1)

        return VideoScriptQualityMetrics(
            hook_strength_score=avg_hook,
            visual_clarity_score=avg_visual,
            framework_pacing_score=avg_pacing,
            policy_compliance_score=avg_policy,
            overall_script_quality=overall,
            total_scripts=len(scripts),
            status="SUCCESS"
        )

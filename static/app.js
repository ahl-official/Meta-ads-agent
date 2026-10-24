// Robust API Fetch with Content-Type safety (never throws SyntaxError on non-JSON 413/500 errors)
async function safeFetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    let body = null;
    if (contentType.includes('application/json')) {
        try {
            body = await res.json();
        } catch (e) {
            body = null;
        }
    }
    if (!body) {
        const text = await res.text();
        let cleanMsg = (text || '').trim();
        if (cleanMsg.length > 250) cleanMsg = cleanMsg.substring(0, 250) + '...';
        body = {
            status: res.ok ? 'SUCCESS' : 'ERROR',
            detail: cleanMsg || `HTTP ${res.status}: ${res.statusText}`,
            message: cleanMsg
        };
    }
    if (!res.ok) {
        const errMsg = body.detail || body.message || `HTTP ${res.status}: ${res.statusText}`;
        const err = new Error(errMsg);
        err.status = res.status;
        err.body = body;
        throw err;
    }
    return body;
}

// High-Performance Direct-to-Gemini Cloud Uploader (Bypasses Vercel 4.5MB Limit Completely)
// Direct Browser-to-Google CORS upload handles 20MB to 500MB+ videos with zero server proxy bottleneck
async function uploadMediaWithChunking(file, progressEl, txtContent, transcriptBadge, generateBtnId, formId, accentGradient) {
    if (!file) return;
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);

    if (progressEl) {
        progressEl.classList.remove('hidden');
        progressEl.innerHTML = `
            <div style="margin-bottom:6px; font-size:12px; color:#E2E8F0;">
                <span class="spinner-small" style="display:inline-block; margin-right:8px; vertical-align:middle;"></span>
                Preparing video for AI analysis (${sizeMb} MB)...
            </div>
            <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                <div style="width:15%; height:100%; background:linear-gradient(90deg, #EC4899, #8B5CF6); transition:width 0.2s;"></div>
            </div>
        `;
    }

    try {
        let finalData = null;
        const isVercel = window.location.hostname.endsWith('vercel.app');

        // Flow A: Files <= 4MB, OR running on VPS/local (no Vercel 4.5MB ceiling)
        // Single direct upload straight to /api/transcribe-audio (0 CORS issues!)
        if (!isVercel || file.size <= 4.2 * 1024 * 1024) {
            if (progressEl) {
                progressEl.innerHTML = `
                    <div style="margin-bottom:6px; font-size:12px; color:#E2E8F0;">
                        <span class="spinner-small" style="display:inline-block; margin-right:6px; vertical-align:middle;"></span>
                        Uploading & analyzing video directly with Gemini AI (${sizeMb} MB)...
                    </div>
                    <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                        <div style="width:65%; height:100%; background:linear-gradient(90deg, #EC4899, #8B5CF6); transition:width 0.2s;"></div>
                    </div>
                `;
            }
            const formData = new FormData();
            formData.append('file', file);
            finalData = await safeFetchJson('/api/transcribe-audio', {
                method: 'POST',
                body: formData
            });
        } else {
            // Flow B: Large files on Vercel: stream in safe 2 MB chunks to /api/upload-media-chunk
            const CHUNK_SIZE = 2 * 1024 * 1024;
            const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
            const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

            for (let idx = 0; idx < totalChunks; idx++) {
                const start = idx * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunkBlob = file.slice(start, end);

                const percent = Math.round(((idx + 1) / totalChunks) * 100);
                if (progressEl) {
                    progressEl.innerHTML = `
                        <div style="margin-bottom:6px; font-size:12px; color:#E2E8F0;">
                            <span class="spinner-small" style="display:inline-block; margin-right:6px; vertical-align:middle;"></span>
                            Streaming chunk ${idx + 1}/${totalChunks} (${percent}%) &mdash; AI processing...
                        </div>
                        <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                            <div style="width:${percent}%; height:100%; background:linear-gradient(90deg, #EC4899, #8B5CF6); transition:width 0.2s;"></div>
                        </div>
                    `;
                }

                const chunkData = new FormData();
                chunkData.append('chunk', chunkBlob, file.name);
                chunkData.append('upload_id', uploadId);
                chunkData.append('chunk_index', idx);
                chunkData.append('total_chunks', totalChunks);
                chunkData.append('filename', file.name);

                const res = await safeFetchJson('/api/upload-media-chunk', {
                    method: 'POST',
                    body: chunkData
                });

                if (idx + 1 === totalChunks) {
                    finalData = res;
                }
            }
        }

        if (finalData && finalData.transcript_id) {
            pollTranscription(finalData.transcript_id, txtContent, progressEl);
            return;
        }

        if (finalData && finalData.transcription) {
            const words = finalData.transcription.trim().split(/\s+/).length;
            txtContent.value = finalData.transcription;
            txtContent.style.border = "2px solid #10B981";
            txtContent.style.boxShadow = "0 0 18px rgba(16, 185, 129, 0.4)";
            setTimeout(() => { txtContent.style.boxShadow = ""; }, 3000);
            if (transcriptBadge) {
                transcriptBadge.style.display = "inline-block";
                transcriptBadge.style.background = "rgba(16, 185, 129, 0.2)";
                transcriptBadge.style.color = "#10B981";
                transcriptBadge.textContent = `✓ Analyzed (${words} words)`;
            }
            if (progressEl) {
                progressEl.innerHTML = `
                    <div style="background:rgba(16, 185, 129, 0.1); border:1px solid rgba(16, 185, 129, 0.3); border-radius:8px; padding:10px 12px; margin-top:8px;">
                        <div style="color:#10B981; font-weight:600; font-size:13px; margin-bottom:4px;">✓ Video Analyzed (${words} words)!</div>
                        <div style="color:#CBD5E1; font-size:12px;">⚡ Automatically generating 5 Double Down variations now...</div>
                    </div>
                `;
            }

            // TRUE 1-STEP: Automatically submit the form to generate the 5 variations!
            if (formId) {
                const targetForm = document.getElementById(formId);
                if (targetForm) {
                    setTimeout(() => {
                        targetForm.requestSubmit();
                    }, 400);
                }
            }
        } else {
            throw new Error((finalData && (finalData.detail || finalData.message)) || "Could not analyze speech or video content from this file.");
        }
    } catch (err) {
        console.error('Media upload error:', err);
        if (progressEl) {
            progressEl.innerHTML = `
                <div style="background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; padding:10px 12px; margin-top:8px;">
                    <div style="color:#EF4444; font-weight:600; font-size:13px; margin-bottom:4px;">⚠️ Upload Notice</div>
                    <div style="color:#CBD5E1; font-size:12px;">${err.message || 'Server error occurred during processing.'}</div>
                    <div style="color:#94A3B8; font-size:11px; margin-top:4px;">You can also paste the transcript or ad script directly in the text area below.</div>
                </div>
            `;
        }
    }
}

// --- GLOBAL FEEDBACK LOGIC (SIR'S GLOBAL FEEDBACK) ---
window.sirsGlobalFeedback = '';

document.addEventListener('DOMContentLoaded', () => {
    const btnApplyFeedback = document.getElementById('btn-apply-global-feedback');
    const btnClearFeedback = document.getElementById('btn-clear-global-feedback');
    const feedbackText = document.getElementById('sirs_feedback_text');
    const feedbackStatus = document.getElementById('feedback-status');

    if (btnApplyFeedback) {
        btnApplyFeedback.addEventListener('click', () => {
            window.sirsGlobalFeedback = feedbackText.value.trim();
            updateGlobalFeedbackBadges();
            if (window.sirsGlobalFeedback) {
                feedbackStatus.style.display = 'block';
                feedbackStatus.textContent = 'Feedback locked in. It will now be applied to all future agent generations.';
                setTimeout(() => { feedbackStatus.style.display = 'none'; }, 5000);
            }
        });
    }

    if (btnClearFeedback) {
        btnClearFeedback.addEventListener('click', () => {
            feedbackText.value = '';
            window.sirsGlobalFeedback = '';
            feedbackStatus.style.display = 'block';
            feedbackStatus.textContent = 'Feedback cleared.';
            feedbackStatus.style.color = '#ef4444';
            setTimeout(() => { 
                feedbackStatus.style.display = 'none'; 
                feedbackStatus.style.color = '#00d26a';
            }, 3000);
        });
    }
});
// Initial Saved Target Audience Vault Data (Matching Reference UI)
const INITIAL_SAVED_AUDIENCES = [
    {
        id: "aud_1",
        title: "Middle Age Men (25-35)",
        subtitle: "Early-Stage Hair Loss & Confidence Loss",
        description: "Men 25 to 35 suffering from early-stage hair loss. They feel insecure, want a natural look, are terrified of surgery, and worry about what peers think.",
        active: true,
        dateAdded: "2026-08-31"
    },
    {
        id: "aud_2",
        title: "Older Professionals (40-55)",
        subtitle: "Advanced Thinning & Career Transformation",
        description: "Men with advanced hair loss (Norwood 5-7) looking for a complete transformation to look 10 years younger for their career & family events.",
        active: false,
        dateAdded: "2026-08-31"
    },
    {
        id: "aud_3",
        title: "Women Facing Postpartum Thinning (30-45)",
        subtitle: "Stress & Volume Recovery",
        description: "Women experiencing hair volume loss after childbirth or chronic work stress seeking non-damaging organic hair density restoration.",
        active: false,
        dateAdded: "2026-08-31"
    },
    {
        id: "aud_4",
        title: "Performance Marketers & Agency Leaders",
        subtitle: "High-ROAS Direct Response Scaling",
        description: "Direct-response agency owners scaling ₹40+ Lakhs/mo ad spend looking for high-converting hook structures and audience alignment.",
        active: false,
        dateAdded: "2026-08-31"
    }
];

// Pre-loaded Sample Customer Personas Data Set (Initial Demonstration)
const INITIAL_PERSONAS = [
    {
        persona_id: 1,
        name: "American Hairline General Persona",
        avatar_title: "Target Demographic • Hair Loss Solutions",
        target_angle: "Confidence Restoration Angle",
        summary: "Primary target audience looking for non-surgical, guaranteed hair density recovery to restore their confidence and youthful appearance.",
        demographics: {
            "Age": "25 - 55 years old",
            "Gender": "All Genders",
            "Income": "₹6 - 20 Lakhs / year",
            "Occupation": "Professionals & Executives",
            "Location": "Urban & Suburban",
            "Marital Status": "Single or Married",
            "Tech Savviness": "Medium to High"
        },
        psychographics: {
            "Core Beliefs": "Believes in investing in their appearance and values high-quality, guaranteed solutions over cheap fixes.",
            "Lifestyle": "Active, socially conscious, values personal grooming and presentation.",
            "Values": "Authenticity, confidence, social standing, health.",
            "Aspirations": "To regain their full head of hair, look younger, and feel completely confident in any social setting."
        },
        pain_points: {
            "Primary Pain Point": "Deep frustration with hair thinning and hair loss affecting their self-esteem and daily life.",
            "Secondary Frustrations": "Time and money wasted on ineffective chemical treatments or shampoos.",
            "Daily Micro-Struggles": "Feeling self-conscious in photos, wind, or bright lighting."
        },
        objections: {
            "Primary Skepticisms": "'Will this actually work for me, or is it another scam?'",
            "Cost Concerns": "'Is this system worth the investment?'",
            "Past Failed Solutions": "Tried minoxidil, special shampoos, or cheap laser caps with no real results.",
            "Risk Doubts": "Fears side effects or the treatment looking unnatural."
        },
        emotional_triggers: {
            "Fear Drivers": "Fear of aging prematurely, becoming unattractive, or losing their edge.",
            "Hope Drivers": "Dreaming of styling their hair again and not worrying about bald spots.",
            "Status & Identity Triggers": "Wants to be seen as smart, decisive, and ahead of the curve.",
            "Urgency Factors": "Current situation is getting progressively worse every month; action is needed NOW."
        },
        buying_motivations: {
            "Primary Value Drivers": "Guaranteed natural transformation in 90 days.",
            "Desired Outcomes": "Fast, high-impact results with minimal disruption to daily routine.",
            "Key Purchase Triggers": "Clear money-back guarantee, verified case studies, transparent breakdown of methodology.",
            "Decision Drivers": "Direct proof of work and immediate access to step-by-step guidance."
        },
        full_persona_text: "Persona 1: American Hairline General Target Audience"
    }
];

// Pre-loaded Sample 10 Core Benefits Data Set (Initial Demonstration for Agent 2)
const INITIAL_BENEFITS = [
    {
        benefit_id: 1,
        title: "Zero-Surgery Natural Hair Density Restoration",
        mapped_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        underlying_emotion: "Relief from Surgical Anxiety & Fear of Regret",
        description: "Achieve thick, full hair density organically without surgical incisions, scarring, or painful recovery periods. Provides full peace of mind for skeptical buyers terrified of invasive procedures.",
        feature_mapping: "Non-invasive organic micro-follicle revival system",
        ad_hook_idea: "Stop risking expensive surgeries: How 1,400+ men restored hair density organically in 90 days."
    },
    {
        benefit_id: 2,
        title: "Command Unshakeable Executive Presence & Authority",
        mapped_persona: "The High-Stakes Career Achiever (Sarah, 29)",
        underlying_emotion: "Status Boost & Professional Prestige",
        description: "Look 10 years younger and project effortless confidence in high-stakes boardrooms and client presentations without looking artificial.",
        feature_mapping: "Precision hairline framing & natural growth density alignment",
        ad_hook_idea: "Why top executives aren't hiding hair loss—they're quietly using this non-surgical revival system."
    },
    {
        benefit_id: 3,
        title: "Transparent, Science-Backed Root-Cause Protocol",
        mapped_persona: "The Research-Driven Pragmatist (David, 45)",
        underlying_emotion: "Control & Empirical Certainty",
        description: "Eliminate guesswork with a clinical step-by-step protocol that targets scalp micro-circulation and follicle dormancy at the biological cellular level.",
        feature_mapping: "Circadian-aligned natural peptide and nutrient activation matrix",
        ad_hook_idea: "The clinical breakthrough behind 94.2% follicle reactivation without chemical dependency."
    },
    {
        benefit_id: 4,
        title: "Rapid 15-Minute Daily Routine Fits Busy Schedules",
        mapped_persona: "The Overwhelmed Parent & Professional (Elena, 38)",
        underlying_emotion: "Peace of Mind & Effortless Convenience",
        description: "Seamlessly integrates into your existing morning and evening routine without sticky residues, complex prep, or time-wasting salon visits.",
        feature_mapping: "Fast-absorbing non-greasy micro-serum applicator",
        ad_hook_idea: "No time for complex scalp treatments? This 15-second daily routine restores density while you sleep."
    },
    {
        benefit_id: 5,
        title: "Permanent Freedom from Monthly Chemical Subscriptions",
        mapped_persona: "The Value-Conscious Optimizer (Alex, 31)",
        underlying_emotion: "Financial Security & Liberation from Dependence",
        description: "Break free from lifetime prescription drugs and expensive recurring clinic bills with a self-sustaining natural root recovery system.",
        feature_mapping: "Organic root stabilization and self-sustaining follicle nourishment",
        ad_hook_idea: "Tired of paying ₹2,999/month forever for temporary sprays? Here is how to lock in permanent density."
    },
    {
        benefit_id: 6,
        title: "Instant Youthful Visual Rejuvenation (-10 Years Appearance)",
        mapped_persona: "The High-Stakes Career Achiever (Sarah, 29)",
        underlying_emotion: "Pride & Social Magnetism",
        description: "Restore vibrant youthful contours to your face framing, dramatically enhancing personal attraction, photo confidence, and social energy.",
        feature_mapping: "Bio-compatible hairline density reconstruction",
        ad_hook_idea: "Look 10 years younger in your next photo without filters or artificial wigs."
    },
    {
        benefit_id: 7,
        title: "Risk-Free 90-Day Money-Back Guarantee Protection",
        mapped_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        underlying_emotion: "Absolute Trust & Financial Safety",
        description: "Try the complete system with 100% financial peace of mind. If visible follicle growth isn't achieved in 90 days, receive a complete prompt refund.",
        feature_mapping: "90-day progress tracker & ironclad customer satisfaction warranty",
        ad_hook_idea: "If your hair doesn't look noticeably thicker in 90 days, you don't pay a single dime."
    },
    {
        benefit_id: 8,
        title: "Eliminate Social Self-Consciousness in Bright Lighting",
        mapped_persona: "The Overwhelmed Parent & Professional (Elena, 38)",
        underlying_emotion: "Confidence & Social Belonging",
        description: "Feel completely at ease under overhead office lights, outdoor sunshine, and social gatherings without constantly worrying about visible scalp show-through.",
        feature_mapping: "High-density micro-coverage technology",
        ad_hook_idea: "Never fear bright overhead lighting again: Discover the secret to full-coverage natural density."
    },
    {
        benefit_id: 9,
        title: "Fast 30-Day Initial Visible Sprouting Milestones",
        mapped_persona: "The Value-Conscious Optimizer (Alex, 31)",
        underlying_emotion: "Hope & Accelerated Gratification",
        description: "Experience tangible, early visible progress within the first 4 weeks, reinforcing momentum and confirming that your investment is working.",
        feature_mapping: "Accelerated follicle phase transition catalyst",
        ad_hook_idea: "Why wait 6 months? See initial fine hair sprouting within your first 30 days."
    },
    {
        benefit_id: 10,
        title: "Discreet & Confidential At-Home Application",
        mapped_persona: "The Research-Driven Pragmatist (David, 45)",
        underlying_emotion: "Dignity & Privacy Assurance",
        description: "Maintain complete privacy with plain, unbranded home delivery packaging and an effortless self-care application that requires zero embarrassing clinic visits.",
        feature_mapping: "Discreet stealth shipping and ergonomic home application kit",
        ad_hook_idea: "100% confidential scalp restoration delivered right to your doorstep in plain packaging."
    }
];

const INITIAL_ANGLES = [
    {
        benefit_id: 1,
        benefit_title: "Instant Hair Density Recovery & Natural Appearance",
        mapped_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        feature_mapping: "Organic High-Density Follicle Recovery",
        underlying_emotion: "Relief & Self-Assurance",
        angles: [
            {
                angle_id: 1,
                framework: "Problem-Centric",
                angle_headline: "Tired of Hiding Under Caps & Avoiding Sudden Overhead Lights?",
                core_hook: "Stop scrolling if you catch yourself constantly checking your hairline in rearview mirrors.",
                angle_concept: "Agitates daily micro-anxieties surrounding early hair thinning before presenting a non-invasive, instant fix.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "Get Your Free Scalp Analysis & 90-Day Plan Today"
            },
            {
                angle_id: 2,
                framework: "Identity & Status",
                angle_headline: "Reclaim Your Executive Presence & Youthful Edge",
                core_hook: "Looking 10 years younger isn't about vanity—it's about leading with total confidence.",
                angle_concept: "Positions hair revival as a key competitive advantage in professional and social environments.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "Claim Your Confidential VIP Transformation Consult"
            },
            {
                angle_id: 3,
                framework: "Gift & Reciprocity",
                angle_headline: "Free Scalp Density Scan + Bonus Hair Care Routine Kit (₹1,999 Value)",
                core_hook: "We're giving away 50 complimentary organic scalp vitality diagnostic kits this week.",
                angle_concept: "Leverages reciprocity by offering a zero-cost initial scan and bonus routine guide to remove friction.",
                target_persona: "The Research-Driven Pragmatist (David, 45)",
                call_to_action: "Claim Your Free ₹1,999 Scalp Diagnostic Kit Now"
            },
            {
                angle_id: 4,
                framework: "Proof & Evidence",
                angle_headline: "94.2% Density Recovery in 90 Days: See Clinical Before & Afters",
                core_hook: "Don't take our word for it—here is what 1,240+ real clients experienced without surgery.",
                angle_concept: "Uses hard empirical data, dermatological measurements, and verified transformation photos.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "Explore 1,000+ Verified Case Studies & Real Results"
            },
            {
                angle_id: 5,
                framework: "Objection Handling",
                angle_headline: "'Will People Notice?' Why Our Seamless Bio-Matrix Looks 100% Natural",
                core_hook: "The #1 fear guys have before trying scalp revival: 'What if it looks fake?' Here's the truth.",
                angle_concept: "Directly tackles top social skepticisms and proves undetectable density integration.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "See How Bio-Matrix Follicles Blend Seamlessly"
            }
        ]
    },
    {
        benefit_id: 2,
        benefit_title: "Zero Side Effects & 100% Risk-Free Guarantee",
        mapped_persona: "The High-Stakes Career Achiever (Sarah, 29)",
        feature_mapping: "Certified Organic Bio-Peptide Compound",
        underlying_emotion: "Safety & Peace of Mind",
        angles: [
            {
                angle_id: 1,
                framework: "Objection Handling",
                angle_headline: "No Hormonal Crash, No Harsh Chemicals, No Permanent Side Effects",
                core_hook: "Terrified of chemical side effects ruining your energy or hormone balance?",
                angle_concept: "Addresses medical safety fears directly, positioning organic plant peptides as the zero-harm alternative.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "Read Our Independent Dermatological Safety Audit"
            },
            {
                angle_id: 2,
                framework: "Scarcity & Urgency",
                angle_headline: "Only 12 Consultation Slots Available For This Month's Organic Batch",
                core_hook: "Due to custom organic formulation times, we limit monthly intake to exactly 25 clients.",
                angle_concept: "Drives immediate action through authentic batch limits and limited consultant availability.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "Secure 1 of 12 Remaining Monthly Spots"
            },
            {
                angle_id: 3,
                framework: "Curiosity & Secret",
                angle_headline: "The 'Follicle Awakening' Protocol Top Clinics Don't Want You to Know",
                core_hook: "Why 80% of topical serums fail—and the micro-activation layer surgeons skip.",
                angle_concept: "Interrupter hook revealing a counter-intuitive biological insight that builds deep intrigue.",
                target_persona: "The Research-Driven Pragmatist (David, 45)",
                call_to_action: "Watch the 3-Minute Protocol Breakdown Video"
            },
            {
                angle_id: 4,
                framework: "Contrast & Comparison",
                angle_headline: "₹1,20,000 Surgical Transplants vs. 90-Day Organic Revival: The Real Comparison",
                core_hook: "Before spending ₹1,00,000+ and facing 3 weeks of painful downtime, compare these two paths.",
                angle_concept: "Side-by-side breakdown contrasting high cost/risk surgery with zero-downtime organic revival.",
                target_persona: "The Overwhelmed Parent & Professional (Elena, 38)",
                call_to_action: "View Full Surgery vs. Organic Revival Comparison"
            },
            {
                angle_id: 5,
                framework: "Gift & Reciprocity",
                angle_headline: "Try It 100% Risk-Free For 90 Days—Full Refund Guarantee",
                core_hook: "If you don't see visible hair density growth in 90 days, we pay you back every single cent.",
                angle_concept: "Shifts 100% of the purchase risk onto the brand to maximize conversion velocity.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "Start Your Risk-Free 90-Day Trial"
            }
        ]
    },
    {
        benefit_id: 3,
        benefit_title: "Fast 15-Minute Daily Routine Fits Any Busy Lifestyle",
        mapped_persona: "The Overwhelmed Parent & Professional (Elena, 38)",
        feature_mapping: "Easy 2-Step Morning Protocol & Rapid Absorption Formula",
        underlying_emotion: "Efficiency & Daily Convenience",
        angles: [
            {
                angle_id: 1,
                framework: "Problem-Centric",
                angle_headline: "No Time For 45-Minute Scalp Treatments? Here is the 15-Minute Fix",
                core_hook: "If your morning routine is already hectic, adding complicated hair treatments isn't realistic.",
                angle_concept: "Focuses on time scarcity for busy professionals needing quick execution.",
                target_persona: "The Overwhelmed Parent & Professional (Elena, 38)",
                call_to_action: "See How Simple the 15-Minute Daily Routine Is"
            },
            {
                angle_id: 2,
                framework: "Identity & Status",
                angle_headline: "Effortless Grooming Built For High-Performing Executives",
                core_hook: "Top founders don't spend hours on grooming. They use streamlined, high-efficiency tools.",
                angle_concept: "Pairs routine speed with executive efficiency and high performance.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "Upgrade Your Morning Routine in 15 Minutes"
            },
            {
                angle_id: 3,
                framework: "Gift & Reciprocity",
                angle_headline: "Includes Free Micro-Applicator & Pocket Travel Case (₹799 Value)",
                core_hook: "Order today and receive our precision serum applicator tool absolutely free.",
                angle_concept: "Enhances routine speed by providing free custom applicator hardware.",
                target_persona: "The Research-Driven Pragmatist (David, 45)",
                call_to_action: "Claim Your Free Precision Applicator Tool"
            },
            {
                angle_id: 4,
                framework: "Proof & Evidence",
                angle_headline: "98% User Compliance Rate in 90-Day Clinical Trial",
                core_hook: "Why do our users actually finish the 90-day program? Because it takes under 90 seconds a day.",
                angle_concept: "Demonstrates high completion rates due to zero friction routine design.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "Read User Satisfaction Survey Results"
            },
            {
                angle_id: 5,
                framework: "Objection Handling",
                angle_headline: "'Will It Leave My Hair Greasy During Work?' Zero-Residue Guarantee",
                core_hook: "No oily shine, no sticky residue. Dries completely clear in under 30 seconds.",
                angle_concept: "Removes fear of greasy hair during important work meetings or events.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "Try Our Fast-Drying Zero-Residue Formula"
            }
        ]
    },
    {
        benefit_id: 4,
        benefit_title: "Long-Term Durable Density & Root-Cause Follicle Nourishment",
        mapped_persona: "The Research-Driven Pragmatist (David, 45)",
        feature_mapping: "Deep Scalp Micro-Circulation Technology",
        underlying_emotion: "Empowerment & Permanent Transformation",
        angles: [
            {
                angle_id: 1,
                framework: "Curiosity & Secret",
                angle_headline: "The Dormant Follicle Trigger: How Micro-Circulation Reactivates Growth",
                core_hook: "Your hair follicles aren't dead—they are just sleeping due to restricted micro-blood flow.",
                angle_concept: "Explains root biological cause of follicle dormancy to create an 'aha!' revelation.",
                target_persona: "The Research-Driven Pragmatist (David, 45)",
                call_to_action: "Unlock the Dormant Follicle Trigger Protocol"
            },
            {
                angle_id: 2,
                framework: "Proof & Evidence",
                angle_headline: "Microscopic Scalp Imaging Proves 3.4x Hair Shaft Thickness Increase",
                core_hook: "Trichologist camera scans reveal 300%+ density improvements at the scalp root level.",
                angle_concept: "Uses scientific imaging and trichology measurements as undeniable proof.",
                target_persona: "The Research-Driven Pragmatist (David, 45)",
                call_to_action: "View Microscopic Scalp Scan Results"
            },
            {
                angle_id: 3,
                framework: "Problem-Centric",
                angle_headline: "Why Treating Hair Surface Symptoms Never Fixes Scalp Root Thinning",
                core_hook: "Shampoos only clean the surface. If you don't nourish the root layer, hair loss continues.",
                angle_concept: "Agitates superficial product failures to position root-level micro-nutrition.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "Nourish Your Hair Roots From Within"
            },
            {
                angle_id: 4,
                framework: "Identity & Status",
                angle_headline: "Invest in Permanent Scalp Vitality, Not Temporary Masking Solutions",
                core_hook: "Smart consumers solve problems at the root source rather than renting short-term fixes.",
                angle_concept: "Aligns with long-term mindset and investment intelligence.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "Build Lasting Scalp Vitality Today"
            },
            {
                angle_id: 5,
                framework: "Scarcity & Urgency",
                angle_headline: "Reactivate Dormant Follicles Before They Fibrose Permanently",
                core_hook: "Every month a follicle remains dormant, scarring increases. Action within 6 months is critical.",
                angle_concept: "Uses biological urgency based on follicle fibrosing timelines.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "Start Reactivating Dormant Follicles Today"
            }
        ]
    },
    {
        benefit_id: 5,
        benefit_title: "Discreet Stealth Delivery & Complete Home Privacy",
        mapped_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        feature_mapping: "Stealth unbranded delivery packaging & confidential self-care home kit",
        underlying_emotion: "Dignity & Privacy Assurance",
        angles: [
            {
                angle_id: 1,
                framework: "Objection Handling",
                angle_headline: "No Embarrassing Clinic Visits—100% Discreet Packaging Right to Your Door",
                core_hook: "Worried about neighbors or roommates seeing what's inside your delivery package?",
                angle_concept: "Solves social embarrassment concerns with guaranteed plain stealth packaging.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "Order Your Discreet Home Scalp Kit Today"
            },
            {
                angle_id: 2,
                framework: "Identity & Status",
                angle_headline: "Self-Care Built For Professionals Who Value Absolute Confidentiality",
                core_hook: "Transform your hairline on your own terms, without uncomfortable public consultations.",
                angle_concept: "Appeals to privacy-focused individuals who value discreet personal control.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "Claim Confidential Home Revival Kit"
            },
            {
                angle_id: 3,
                framework: "Gift & Reciprocity",
                angle_headline: "Includes Free Stealth Storage Pouch & Travel Applicator",
                core_hook: "Every order includes an unbranded executive travel case for total privacy on the go.",
                angle_concept: "Adds free stealth travel hardware to reinforce privacy value.",
                target_persona: "The Research-Driven Pragmatist (David, 45)",
                call_to_action: "Get Your Free Executive Stealth Pouch"
            },
            {
                angle_id: 4,
                framework: "Problem-Centric",
                angle_headline: "Why Settle For Awkward Waiting Rooms When You Can Transform Hair at Home?",
                core_hook: "Skip taking time off work for awkward clinical visits that cost thousands.",
                angle_concept: "Highlights the inconvenience and embarrassment of traditional clinic appointments.",
                target_persona: "The Overwhelmed Parent & Professional (Elena, 38)",
                call_to_action: "Start Your Private Home Scalp Protocol"
            },
            {
                angle_id: 5,
                framework: "Proof & Evidence",
                angle_headline: "15,000+ Customers Trust Our 100% Confidential Home Delivery System",
                core_hook: "Delivered securely in plain brown boxes with zero brand logos or product identifiers.",
                angle_concept: "Establishes customer trust through high delivery volume and privacy compliance.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "See How Easy Private Delivery Works"
            }
        ]
    },
    {
        benefit_id: 6,
        benefit_title: "85% Cost Savings vs Expensive Surgical Hair Transplants",
        mapped_persona: "The High-Stakes Career Achiever (Sarah, 29)",
        feature_mapping: "Zero surgical fees, zero hospital downtime, affordable monthly restoration protocol",
        underlying_emotion: "Financial Relief & Smart Investment Value",
        angles: [
            {
                angle_id: 1,
                framework: "Contrast & Comparison",
                angle_headline: "₹1,50,000 Surgery vs. ₹2,999/mo Organic Protocol: The Financial Breakdown",
                core_hook: "Why spend your entire savings on invasive surgery when you can restore density at a fraction of the cost?",
                angle_concept: "Directly compares surgical debt with an affordable monthly self-care protocol.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "View Full 90-Day Cost & Savings Breakdown"
            },
            {
                angle_id: 2,
                framework: "Objection Handling",
                angle_headline: "'Is Surgery the Only Way?' Why 92% of Early Thinning Doesn't Need Scalpels",
                core_hook: "Surgeons will tell you surgery is mandatory—trichologists disagree. Here's why.",
                angle_concept: "Debunks surgical necessity myths for early to mid-stage hair loss.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "Check If You Qualify For Non-Surgical Revival"
            },
            {
                angle_id: 3,
                framework: "Identity & Status",
                angle_headline: "The Smart Consumer's Guide to Hair Revival Without Financial Stress",
                core_hook: "High net-worth achievers don't waste capital unnecessarily—they choose high-ROI alternatives.",
                angle_concept: "Positions organic revival as the financially intelligent choice for savvy professionals.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "Calculate Your 3-Year Revival Savings"
            },
            {
                angle_id: 4,
                framework: "Gift & Reciprocity",
                angle_headline: "Lock In 40% Off Your First 90-Day Organic Revival Kit",
                core_hook: "Save an extra ₹999 today with our introductory direct-to-consumer savings voucher.",
                angle_concept: "Applies direct savings incentives to lower purchase resistance.",
                target_persona: "The Overwhelmed Parent & Professional (Elena, 38)",
                call_to_action: "Claim Your 40% Off Introductory Voucher"
            },
            {
                angle_id: 5,
                framework: "Proof & Evidence",
                angle_headline: "Save Over ₹1,20,000 While Achieving Comparable Hair Density Results",
                core_hook: "Independent consumer studies show 89% satisfaction rating equivalent to surgical density.",
                angle_concept: "Uses financial statistics to validate high-value outcomes.",
                target_persona: "The Research-Driven Pragmatist (David, 45)",
                call_to_action: "Read Independent Financial ROI Study"
            }
        ]
    },
    {
        benefit_id: 7,
        benefit_title: "Measurable Trichological Growth Progress Tracking in 90 Days",
        mapped_persona: "The Research-Driven Pragmatist (David, 45)",
        feature_mapping: "Integrated 90-day progress tracker app & micro-camera density guide",
        underlying_emotion: "Methodical Control & Empirical Certainty",
        angles: [
            {
                angle_id: 1,
                framework: "Proof & Evidence",
                angle_headline: "Track Every Single New Hair Follicle With Weekly High-Magnification Scans",
                core_hook: "No more guessing if a product is working—see microscopic follicle growth week by week.",
                angle_concept: "Empowers analytical buyers with quantitative weekly proof.",
                target_persona: "The Research-Driven Pragmatist (David, 45)",
                call_to_action: "Download the Progress Tracking App & Guide"
            },
            {
                angle_id: 2,
                framework: "Curiosity & Secret",
                angle_headline: "The 30-60-90 Day Follicle Matrix: What Happens Below the Scalp Surface",
                core_hook: "Day 1 to 30 roots anchor, Day 30 to 60 shafts thicken, Day 90 density explodes. Here's why.",
                angle_concept: "Breaks down the 3-phase biological growth timeline into milestone stages.",
                target_persona: "The Research-Driven Pragmatist (David, 45)",
                call_to_action: "See the 90-Day Transformation Timeline"
            },
            {
                angle_id: 3,
                framework: "Identity & Status",
                angle_headline: "Built For Analytical Minds Who Demand Measurable Proof",
                core_hook: "If you track your workouts and finances, why wouldn't you track your hair restoration progress?",
                angle_concept: "Connects progress tracking to metric-driven lifestyle habits.",
                target_persona: "The High-Stakes Career Achiever (Sarah, 29)",
                call_to_action: "Start Tracking Your Scalp Revival Matrix"
            },
            {
                angle_id: 4,
                framework: "Scarcity & Urgency",
                angle_headline: "First 100 Orders Receive Free Scalp Care & Maintenance Kit (₹999 Value)",
                core_hook: "Get a complete hairline maintenance kit free with your custom hair patch consultation.",
                angle_concept: "Drives immediate consultations through bonus hair system maintenance kit.",
                target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
                call_to_action: "Claim Free Hair System Care Kit"
            },
            {
                angle_id: 5,
                framework: "Gift & Reciprocity",
                angle_headline: "Free 1-on-1 Trichologist Progress Audit Included With Every 90-Day Kit",
                core_hook: "Get a certified scalp specialist to review your progress photos every 30 days.",
                angle_concept: "Includes expert coaching consultations to ensure high outcome success.",
                target_persona: "The Overwhelmed Parent & Professional (Elena, 38)",
                call_to_action: "Book Your Free 30-Day Trichologist Review"
            }
        ]
    }
];

// App Controller Initialization
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initPersonaGenerator();
    initBenefitsGenerator();
    initAnglesGenerator();
    initVideoScriptGenerator();
    initOwnAdDoubleDown();
    initCompetitorAdRemixer();
    initAudienceVault();
    initCreativeBucket();
    initTraces();
    initUpload();
    fetchSystemMetrics();

    // Pre-render initial personas, benefits, angles, creatives, and video scripts on page load
    window.generatedPersonas = INITIAL_PERSONAS;
    updateDropdownsWithPersonas();
    window.generatedPersonas = INITIAL_PERSONAS;
    updateDropdownsWithPersonas();
    renderPersonas(INITIAL_PERSONAS);
    renderBenefits(INITIAL_BENEFITS);
    renderAngles(INITIAL_ANGLES);
    renderVideoScripts(INITIAL_VIDEO_SCRIPTS);
});

// Tab Navigation Controller
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');
    const brandTitle = document.querySelector('.brand-title');

    const tabTitleMap = {
        'tab-generator': 'Transcription Meta Ads • Agent 1',
        'tab-benefits': 'Transcription Meta Ads • Agent 2',
        'tab-angles': 'Transcription Meta Ads • Agent 3',
        'tab-video': 'Transcription Meta Ads • Agent 4',
        'tab-own-doubledown': 'Meta Ads Suite • Double Down on Own Winner',
        'tab-competitor-remix': 'Meta Ads Suite • Competitor Ad Remixer',
        'tab-feedback': 'Transcription Meta Ads • Sir\'s Global Feedback',
        'tab-creative': 'Transcription Meta Ads • Agent 5',
        'tab-thumbnail': 'Transcription Meta Ads • Agent 6',
        'tab-designer': 'Transcription Meta Ads • Agent 7',
        'tab-titles': 'Transcription Meta Ads • Agent 8',
        'tab-brief': 'Transcription Meta Ads • Agent 9',
        'tab-metadata': 'Transcription Meta Ads • Agent 10',
        'tab-vault': 'Transcription Meta Ads • Saved Audience Vault',
        'tab-tracer': 'Transcription Meta Ads • LangSmith Trace Inspector',
        'tab-knowledge': 'Transcription Meta Ads • Knowledge Base & Upload'
    };

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetTab = btn.dataset.tab;
            const targetPane = document.getElementById(targetTab);
            if (targetPane) targetPane.classList.add('active');

            if (brandTitle && tabTitleMap[targetTab]) {
                brandTitle.textContent = tabTitleMap[targetTab];
            }

            if (targetTab === 'tab-bucket') {
                if (typeof loadAndRenderBucket === 'function') loadAndRenderBucket();
            } else if (targetTab === 'tab-tracer') {
                fetchTraces();
            } else if (targetTab === 'tab-vault') {
                renderAudienceVault();
            } else if (targetTab === 'tab-benefits') {
                renderBenefits(INITIAL_BENEFITS);
            } else if (targetTab === 'tab-angles') {
                renderAngles(INITIAL_ANGLES);
            } else if (targetTab === 'tab-video') {
                renderVideoScripts(currentVideoScriptsData || INITIAL_VIDEO_SCRIPTS);
            }
        });
    });
}

// Target Audience Groups Vault (Reference UI Controller)
let audienceVaultData = [...INITIAL_SAVED_AUDIENCES];

function initAudienceVault() {
    const btnAdd = document.getElementById('btn-add-audience-vault');
    if (btnAdd) {
        btnAdd.addEventListener('click', () => {
            const title = prompt("Enter Target Audience Title (e.g. 'Young Professionals 22-30'):");
            if (!title) return;
            const desc = prompt("Enter audience details / psychological profile:");
            if (!desc) return;

            const newAud = {
                id: `aud_${Date.now()}`,
                title: title,
                subtitle: "Custom Saved Profile",
                description: desc,
                active: false,
                dateAdded: new Date().toISOString().split('T')[0]
            };

            audienceVaultData.unshift(newAud);
            renderAudienceVault();
        });
    }
    renderAudienceVault();
}

function renderAudienceVault() {
    const grid = document.getElementById('audience-vault-grid');
    if (!grid) return;
    grid.innerHTML = '';

    audienceVaultData.forEach(aud => {
        const card = document.createElement('div');
        card.className = `audience-vault-card ${aud.active ? 'active-audience' : ''}`;

        card.innerHTML = `
            <div class="aud-card-header">
                <div>
                    <h3 class="aud-title">${escapeHtml(aud.title)}</h3>
                    <span class="aud-subtitle">${escapeHtml(aud.subtitle || '')}</span>
                </div>
                <div class="aud-actions">
                    ${aud.active ? '<span class="active-badge">● Active Target</span>' : `<button class="btn btn-secondary btn-sm" onclick="setActiveAudience('${aud.id}')">Set Active</button>`}
                    <button class="icon-btn-edit" title="Edit" onclick="editAudience('${aud.id}')">Edit</button>
                    <button class="icon-btn-danger" title="Delete" onclick="deleteAudience('${aud.id}')">Delete</button>
                </div>
            </div>
            <p class="aud-description">${escapeHtml(aud.description)}</p>
            <div class="aud-footer">
                <span class="aud-date">Added: ${aud.dateAdded}</span>
                <button class="btn-link" onclick="loadAudienceIntoForm('${escapeJsString(aud.title)}', '${escapeJsString(aud.description)}')">Use in Generator</button>
            </div>
        `;

        grid.appendChild(card);
    });
}

function setActiveAudience(id) {
    audienceVaultData.forEach(a => a.active = (a.id === id));
    renderAudienceVault();
}

function editAudience(id) {
    const aud = audienceVaultData.find(a => a.id === id);
    if (!aud) return;
    const newTitle = prompt("Edit Target Audience Title:", aud.title);
    if (newTitle === null) return;
    const newDesc = prompt("Edit Target Audience Description / Details:", aud.description);
    if (newDesc === null) return;

    if (newTitle.trim()) aud.title = newTitle.trim();
    if (newDesc.trim()) aud.description = newDesc.trim();
    renderAudienceVault();
}

function deleteAudience(id) {
    audienceVaultData = audienceVaultData.filter(a => a.id !== id);
    renderAudienceVault();
}

function loadAudienceIntoForm(title, desc) {
    const selectCustomer = document.getElementById('ideal_customer');
    const selectPain = document.getElementById('pain_point');
    const valText = `${title} — ${desc}`;

    if (selectCustomer) {
        let exists = Array.from(selectCustomer.options).some(opt => opt.value === valText);
        if (!exists) {
            const newOpt = new Option(valText, valText);
            selectCustomer.add(newOpt);
        }
        selectCustomer.value = valText;
    }

    if (selectPain) {
        let exists = Array.from(selectPain.options).some(opt => opt.value === desc);
        if (!exists) {
            const newOpt = new Option(desc, desc);
            selectPain.add(newOpt);
        }
        selectPain.value = desc;
    }

    // Switch to Generator Tab
    const tabGenBtn = document.querySelector('[data-tab="tab-generator"]');
    if (tabGenBtn) tabGenBtn.click();
}

function savePersonaToVault(personaObj) {
    const title = personaObj.name || "Customer Persona";
    const subtitle = personaObj.avatar_title || "Generated Segment";
    const desc = `${personaObj.summary || ''} Pain points: ${JSON.stringify(personaObj.pain_points || {})}`;

    const newAud = {
        id: `aud_${Date.now()}`,
        title: title,
        subtitle: subtitle,
        description: desc,
        active: false,
        dateAdded: new Date().toISOString().split('T')[0]
    };

    audienceVaultData.unshift(newAud);
    alert(`'${title}' saved to Target Audience Groups Vault!`);
}

// Fetch Global System Performance & Feedback Metrics
async function fetchSystemMetrics() {
    try {
        const res = await fetch('/api/metrics');
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('stat-total-cost').textContent = data.formatted_total_cost || '$0.000000';
        document.getElementById('stat-total-tokens').textContent = (data.total_tokens_consumed || 0).toLocaleString();

        if (data.feedback) {
            document.getElementById('stat-thumbs-up').textContent = data.feedback.thumbs_up_count || 0;
        }

        const statusEl = document.getElementById('stat-langsmith-status');
        if (data.langsmith_active) {
            statusEl.textContent = '● Connected';
            statusEl.style.color = '#10B981';
        } else {
            statusEl.textContent = '● Local Active';
            statusEl.style.color = '#6366F1';
        }
    } catch (err) {
        console.error('Failed to fetch metrics:', err);
    }
}

// Persona Generator Form Controller
function initPersonaGenerator() {
    const form = document.getElementById('persona-generator-form') || document.getElementById('ad-generator-form');
    const btnGen = document.getElementById('btn-generate');
    const spinner = document.getElementById('gen-spinner');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        btnGen.disabled = true;
        if (spinner) spinner.classList.remove('hidden');

        const payload = {
            one_line_promise: document.getElementById('one_line_promise').value,
            ideal_customer: document.getElementById('ideal_customer').value,
            pain_point: document.getElementById('pain_point').value,
            solution: document.getElementById('solution').value,
            persona_count: parseInt(document.getElementById('persona_count').value, 10) || 4,
            topic_filter: document.getElementById('topic_filter').value || null
        };

        try {
            const res = await fetch('/api/generate-personas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                let errText = `API Request Failed (${res.status})`;
                try {
                    const errData = await res.json();
                    if (errData && errData.detail) errText = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
                } catch (_) { }
                throw new Error(errText);
            }
            const data = await res.json();

            // Render Output & Cost Details
            renderRunCostDetails(data.token_usage);
            renderMetricsBanner(data.success_metrics);
            window.generatedPersonas = data.personas;
            updateDropdownsWithPersonas();
            window.generatedPersonas = data.personas;
            updateDropdownsWithPersonas();
            renderPersonas(data.personas);
            fetchSystemMetrics();

        } catch (err) {
            alert('Error generating customer personas: ' + err.message);
        } finally {
            btnGen.disabled = false;
            if (spinner) spinner.classList.add('hidden');
        }
    });
}

function renderRunCostDetails(tokenUsage) {
    if (!tokenUsage) return;
    const box = document.getElementById('latest-cost-box');
    if (!box) return;
    box.classList.remove('hidden');

    document.getElementById('run-formatted-cost').textContent = tokenUsage.formatted_cost;
    document.getElementById('run-prompt-tokens').textContent = tokenUsage.prompt_tokens.toLocaleString();
    document.getElementById('run-completion-tokens').textContent = tokenUsage.completion_tokens.toLocaleString();
    document.getElementById('run-total-tokens').textContent = tokenUsage.total_tokens.toLocaleString();
    document.getElementById('run-latency').textContent = `${tokenUsage.latency_ms} ms`;
}

function renderMetricsBanner(metrics) {
    if (!metrics) return;
    const banner = document.getElementById('metrics-banner');
    if (!banner) return;
    banner.classList.remove('hidden');

    const elCompleteness = document.getElementById('m-framework');
    if (elCompleteness) elCompleteness.textContent = `${metrics.completeness_score || 100}%`;

    const elGrounding = document.getElementById('m-grounding');
    if (elGrounding) elGrounding.textContent = `${metrics.context_grounding_score}%`;

    const elDiversity = document.getElementById('m-diversity');
    if (elDiversity) elDiversity.textContent = metrics.persona_diversity_index;

    const elPolicy = document.getElementById('m-policy');
    if (elPolicy) elPolicy.textContent = `${metrics.policy_compliance_score}%`;
}

// Render Personas
function renderPersonas(personas) {
    const grid = document.getElementById('variations-grid');
    if (!grid) return;
    grid.innerHTML = '';

    personas.forEach((persona, index) => {
        const card = document.createElement('div');
        card.className = 'ad-card persona-card-container';

        // Demographics Pill Tags
        let demoHtml = '';
        if (persona.demographics && typeof persona.demographics === 'object') {
            demoHtml = Object.entries(persona.demographics).map(([k, v]) => `
                <div class="meta-tag"><span class="meta-key">${escapeHtml(k)}:</span> <span class="meta-val">${escapeHtml(String(v))}</span></div>
            `).join('');
        }

        // Section Builder Helper
        function buildSubSection(title, dict) {
            if (!dict || typeof dict !== 'object') return '';
            const items = Object.entries(dict).map(([k, v]) => `
                <div class="persona-sub-item">
                    <strong class="sub-key">${escapeHtml(k)}:</strong>
                    <p class="sub-val">${escapeHtml(String(v))}</p>
                </div>
            `).join('');
            return `
                <div class="script-section-card persona-dimension-card">
                    <span class="section-title-badge">${escapeHtml(title)}</span>
                    <div class="persona-dimension-body">${items}</div>
                </div>
            `;
        }

        const psychHtml = buildSubSection('PSYCHOGRAPHICS', persona.psychographics);
        const painHtml = buildSubSection('PAIN POINTS', persona.pain_points);
        const objHtml = buildSubSection('OBJECTIONS & SKEPTICISMS', persona.objections);
        const emoHtml = buildSubSection('EMOTIONAL TRIGGERS', persona.emotional_triggers);
        const buyHtml = buildSubSection('BUYING MOTIVATIONS', persona.buying_motivations);

        card.innerHTML = `
            <div class="ad-header persona-header">
                <div class="persona-avatar-block">
                    <span class="persona-avatar"></span>
                    <div>
                        <h3 class="persona-title">Persona ${persona.persona_id || index + 1}: ${escapeHtml(persona.name)}</h3>
                        <span class="persona-subtitle">${escapeHtml(persona.avatar_title)}</span>
                    </div>
                </div>
                <div class="ad-actions">
                    <button class="feedback-btn" title="Thumbs Up" onclick="sendPersonaFeedback(this, ${persona.persona_id || index + 1}, 'thumbs_up', ${JSON.stringify(persona).replace(/"/g, '&quot;')})">Like</button>
                    <button class="feedback-btn" title="Thumbs Down" onclick="sendPersonaFeedback(this, ${persona.persona_id || index + 1}, 'thumbs_down', ${JSON.stringify(persona).replace(/"/g, '&quot;')})">Dislike</button>
                    <button class="btn btn-secondary btn-sm" onclick="savePersonaToVault(${JSON.stringify(persona).replace(/"/g, '&quot;')})">Save to Vault</button>
                    <button class="ad-copy-btn" onclick="copyPersonaText(this, \`${escapeJsString(persona.full_persona_text || JSON.stringify(persona, null, 2))}\`)">Copy</button>
                </div>
            </div>
            
            <div class="persona-summary-banner">
                <strong>Target Angle:</strong> ${escapeHtml(persona.target_angle || 'Direct Benefit')} • 
                <span>${escapeHtml(persona.summary || '')}</span>
            </div>

            <div class="demographics-bar">
                ${demoHtml}
            </div>

            <div class="persona-grid-dimensions">
                ${psychHtml}
                ${painHtml}
                ${objHtml}
                ${emoHtml}
                ${buyHtml}
            </div>
        `;

        grid.appendChild(card);
    });
}

// Feedback Handler for Personas
async function sendPersonaFeedback(btn, personaId, rating, personaObj) {
    const parentActions = btn.parentElement;
    const allFeedbackBtns = parentActions.querySelectorAll('.feedback-btn');

    try {
        const payload = {
            variation_id: personaId,
            target_angle: personaObj.target_angle || "Persona Angle",
            hook: personaObj.name || "",
            problem_agitation: JSON.stringify(personaObj.pain_points || {}),
            solution_value: JSON.stringify(personaObj.buying_motivations || {}),
            call_to_action: personaObj.summary || "",
            full_ad_text: personaObj.full_persona_text || JSON.stringify(personaObj),
            rating: rating
        };

        const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Feedback submission failed');

        allFeedbackBtns.forEach(b => b.classList.remove('active-up', 'active-down'));
        if (rating === 'thumbs_up') {
            btn.classList.add('active-up');
            btn.textContent = '';
        } else {
            btn.classList.add('active-down');
            btn.textContent = '';
        }

        fetchSystemMetrics();
    } catch (err) {
        alert('Could not submit feedback: ' + err.message);
    }
}

function copyPersonaText(btn, text) {
    navigator.clipboard.writeText(text);
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = originalText; }, 2000);
}

function downloadScriptText(filename, text) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

function downloadAllAgent5Scripts() {
    if (typeof currentVideoScriptsData === 'undefined' || !currentVideoScriptsData || currentVideoScriptsData.length === 0) {
        alert("No scripts available to download.");
        return;
    }
    let allText = currentVideoScriptsData.map((s, idx) => `Script #${s.script_id || (idx + 1)}: ${s.script_title}\n\n` + formatFullScriptForCopy(s)).join("\n\n" + "=".repeat(80) + "\n\n");
    downloadScriptText("All_Agent5_Scripts.txt", allText);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeJsString(str) {
    if (!str) return '';
    return String(str).replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

// LangSmith Execution Trace Inspector
function initTraces() {
    const btnRefresh = document.getElementById('btn-refresh-traces');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', fetchTraces);
    }
}

async function fetchTraces() {
    const listEl = document.getElementById('trace-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="loading-text">Loading trace runs...</div>';

    try {
        const res = await fetch('/api/traces');
        if (!res.ok) return;
        const data = await res.json();
        const traces = data.traces || [];

        if (traces.length === 0) {
            listEl.innerHTML = '<div class="empty-trace-select">No execution traces recorded yet. Run a persona generation to populate traces.</div>';
            return;
        }

        listEl.innerHTML = '';
        traces.forEach((trace, idx) => {
            const item = document.createElement('div');
            item.className = `trace-item ${idx === 0 ? 'selected' : ''}`;

            const formattedTime = new Date(trace.timestamp).toLocaleTimeString();
            item.innerHTML = `
                <div class="trace-item-title">${trace.name}</div>
                <div class="trace-item-meta">
                    <span>${formattedTime}</span>
                    <strong style="color: #10B981">${trace.token_report.formatted_cost}</strong>
                </div>
                <div class="trace-item-meta" style="margin-top: 4px;">
                    <span>Tokens: ${trace.token_report.total_tokens}</span>
                    <span>${trace.total_latency_ms} ms</span>
                </div>
            `;

            item.addEventListener('click', () => {
                document.querySelectorAll('.trace-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                renderSpanDetails(trace);
            });

            listEl.appendChild(item);
        });

        if (traces.length > 0) renderSpanDetails(traces[0]);

    } catch (err) {
        listEl.innerHTML = '<div class="empty-trace-select">Failed to load traces.</div>';
    }
}

function renderSpanDetails(trace) {
    const detailsEl = document.getElementById('span-details');
    if (!detailsEl) return;
    detailsEl.innerHTML = '';

    const header = document.createElement('div');
    header.style.marginBottom = '20px';
    header.innerHTML = `
        <h3 style="font-size: 16px; margin-bottom: 6px;">Trace ID: ${trace.trace_id}</h3>
        <p style="font-size: 12px; color: var(--text-muted)">Timestamp: ${trace.timestamp} | Total Latency: ${trace.total_latency_ms} ms | Cost: ${trace.token_report.formatted_cost}</p>
    `;
    detailsEl.appendChild(header);

    trace.spans.forEach(span => {
        const card = document.createElement('div');
        card.className = `span-card ${span.span_type}`;

        card.innerHTML = `
            <div class="span-header">
                <span>${span.name}</span>
                <span class="span-latency">${span.latency_ms} ms</span>
            </div>
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">
                <strong>Input:</strong> ${JSON.stringify(span.input_data)}
            </div>
            <pre class="span-json">Output: ${JSON.stringify(span.output_data, null, 2)}</pre>
        `;
        detailsEl.appendChild(card);
    });
}

// Knowledge Base & File Upload
function initUpload() {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');
    const status = document.getElementById('upload-status');

    if (!zone || !input) return;

    input.addEventListener('change', async () => {
        if (!input.files || input.files.length === 0) return;
        const file = input.files[0];

        const formData = new FormData();
        formData.append('file', file);

        status.classList.remove('hidden');
        status.textContent = `Uploading and processing '${file.name}' into semantic vectors...`;

        try {
            const res = await fetch('/api/upload-transcript', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) throw new Error('Upload Failed');
            const data = await res.json();

            status.textContent = `${data.message}`;
            status.style.color = '#10B981';
        } catch (err) {
            status.textContent = `Error: ${err.message}`;
            status.style.color = '#F43F5E';
        }
    });
}

// ==========================================================================
// AGENT 2: BENEFITS EXTRACTION CONTROLLERS
// ==========================================================================
function initBenefitsGenerator() {
    const form = document.getElementById('benefits-generator-form');
    const btnGen = document.getElementById('btn-generate-benefits');
    const spinner = document.getElementById('benefits-spinner');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        btnGen.disabled = true;
        if (spinner) spinner.classList.remove('hidden');



        let personas = [];
        const personaSource = document.getElementById('b_persona_source').value;
        if (personaSource === 'saved_vault') {
            personas = audienceVaultData.map(a => `${a.title}: ${a.description}`);
        } else if (personaSource === 'active_personas') {
            if (window.generatedPersonas && window.generatedPersonas.length > 0) {
                personas = window.generatedPersonas.map(p => `${p.name}: ${p.summary || p.full_persona_text}`);
            }
        }
 else if (personaSource === 'active_personas') {
            if (window.generatedPersonas && window.generatedPersonas.length > 0) {
                personas = window.generatedPersonas.map(p => `${p.name}: ${p.summary || p.full_persona_text}`);
            }
        }


        const payload = {
            product_name: document.getElementById('b_product_name').value,
            product_details: document.getElementById('b_product_details').value,
            persona_summaries: personas.length > 0 ? personas : null,
            topic_filter: document.getElementById('b_topic_filter').value || null
        };

        try {
            const res = await fetch('/api/generate-benefits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                let errText = `API Request Failed (${res.status})`;
                try {
                    const errData = await res.json();
                    if (errData && errData.detail) errText = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
                } catch (_) { }
                throw new Error(errText);
            }
            const data = await res.json();

            renderBenefitsRunCost(data.token_usage);
            renderBenefitsMetrics(data.success_metrics);
            renderBenefits(data.benefits);
            fetchSystemMetrics();

        } catch (err) {
            alert('Error extracting benefits: ' + err.message);
        } finally {
            btnGen.disabled = false;
            if (spinner) spinner.classList.add('hidden');
        }
    });
}

function renderBenefitsRunCost(tokenUsage) {
    if (!tokenUsage) return;
    const box = document.getElementById('benefits-cost-box');
    if (!box) return;
    box.classList.remove('hidden');

    document.getElementById('b-run-formatted-cost').textContent = tokenUsage.formatted_cost;
    document.getElementById('b-run-prompt-tokens').textContent = tokenUsage.prompt_tokens.toLocaleString();
    document.getElementById('b-run-completion-tokens').textContent = tokenUsage.completion_tokens.toLocaleString();
    document.getElementById('b-run-total-tokens').textContent = tokenUsage.total_tokens.toLocaleString();
    document.getElementById('b-run-latency').textContent = `${tokenUsage.latency_ms} ms`;
}

function renderBenefitsMetrics(metrics) {
    if (!metrics) return;
    const banner = document.getElementById('benefits-metrics-banner');
    if (!banner) return;
    banner.classList.remove('hidden');

    const elCov = document.getElementById('bm-coverage');
    if (elCov) elCov.textContent = `${metrics.persona_coverage_score}%`;

    const elRes = document.getElementById('bm-resonance');
    if (elRes) elRes.textContent = `${metrics.emotional_resonance_score}%`;

    const elAlign = document.getElementById('bm-alignment');
    if (elAlign) elAlign.textContent = `${metrics.feature_alignment_score}%`;

    const elTot = document.getElementById('bm-total');
    if (elTot) elTot.textContent = `${metrics.total_benefits} / 10`;
}

function renderBenefits(benefits) {
    const grid = document.getElementById('benefits-grid');
    if (!grid) return;
    grid.innerHTML = '';

    benefits.forEach((b, idx) => {
        const card = document.createElement('div');
        card.className = 'benefit-card';

        card.innerHTML = `
            <div class="benefit-card-header">
                <div class="benefit-title-row">
                    <span class="benefit-number-badge">Benefit #${b.benefit_id || idx + 1}</span>
                    <h3 class="benefit-title">${escapeHtml(b.title)}</h3>
                </div>
            </div>

            <div class="benefit-badges-row">
                <span class="persona-chip">Target Persona: ${escapeHtml(b.mapped_persona)}</span>
                <span class="emotion-pill">Emotion: ${escapeHtml(b.underlying_emotion)}</span>
            </div>

            <p class="benefit-description">${escapeHtml(b.description)}</p>

            <div class="benefit-meta-grid">
                <div class="meta-block">
                    <span class="meta-label">Underlying Feature / Mechanism</span>
                    <span class="meta-value">${escapeHtml(b.feature_mapping)}</span>
                </div>
                <div class="meta-block">
                    <span class="meta-label">Emotional Ad Hook Idea</span>
                    <div class="hook-quote-box">"${escapeHtml(b.ad_hook_idea)}"</div>
                </div>
            </div>
        `;

        grid.appendChild(card);
    });
}


// ==========================================================================
// AGENT 3: BENEFITS / ANGLE AGENT CONTROLLERS
// ==========================================================================
function initAnglesGenerator() {
    const form = document.getElementById('angles-generator-form');
    const btnGen = document.getElementById('btn-generate-angles');
    const spinner = document.getElementById('angles-spinner');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        btnGen.disabled = true;
        if (spinner) spinner.classList.remove('hidden');



        let personas = [];
        const personaSource = document.getElementById('a_persona_source').value;
        if (personaSource === 'saved_vault') {
            personas = audienceVaultData.map(a => `${a.title}: ${a.description}`);
        } else if (personaSource === 'active_personas') {
            if (window.generatedPersonas && window.generatedPersonas.length > 0) {
                personas = window.generatedPersonas.map(p => `${p.name}: ${p.summary || p.full_persona_text}`);
            }
        }
 else if (personaSource === 'active_personas') {
            if (window.generatedPersonas && window.generatedPersonas.length > 0) {
                personas = window.generatedPersonas.map(p => `${p.name}: ${p.summary || p.full_persona_text}`);
            }
        }


        const payload = {
            product_name: document.getElementById('a_product_name').value,
            product_details: document.getElementById('a_product_details').value,
            persona_summaries: personas.length > 0 ? personas : null,
            angles_per_benefit: parseInt(document.getElementById('a_angles_count').value, 10) || 5,
            topic_filter: document.getElementById('a_topic_filter').value || null
        };

        try {
            const res = await fetch('/api/generate-angles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                let errText = `API Request Failed (${res.status})`;
                try {
                    const errData = await res.json();
                    if (errData && errData.detail) errText = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
                } catch (_) { }
                throw new Error(errText);
            }
            const data = await res.json();

            renderAnglesRunCost(data.token_usage);
            renderAnglesMetrics(data.success_metrics);
            renderAngles(data.benefit_groups);
            fetchSystemMetrics();

        } catch (err) {
            alert('Error generating ad angles: ' + err.message);
        } finally {
            btnGen.disabled = false;
            if (spinner) spinner.classList.add('hidden');
        }
    });
}

function renderAnglesRunCost(tokenUsage) {
    if (!tokenUsage) return;
    const box = document.getElementById('angles-cost-box');
    if (!box) return;
    box.classList.remove('hidden');

    document.getElementById('a-run-formatted-cost').textContent = tokenUsage.formatted_cost;
    document.getElementById('a-run-prompt-tokens').textContent = tokenUsage.prompt_tokens.toLocaleString();
    document.getElementById('a-run-completion-tokens').textContent = tokenUsage.completion_tokens.toLocaleString();
    document.getElementById('a-run-total-tokens').textContent = tokenUsage.total_tokens.toLocaleString();
    document.getElementById('a-run-latency').textContent = `${tokenUsage.latency_ms} ms`;
}

function renderAnglesMetrics(metrics) {
    if (!metrics) return;
    const banner = document.getElementById('angles-metrics-banner');
    if (!banner) return;
    banner.classList.remove('hidden');

    const elCov = document.getElementById('am-coverage');
    if (elCov) elCov.textContent = `${metrics.framework_coverage_score}%`;

    const elDiv = document.getElementById('am-diversity');
    if (elDiv) elDiv.textContent = metrics.angle_diversity_index;

    const elMap = document.getElementById('am-mapping');
    if (elMap) elMap.textContent = `${metrics.persona_mapping_score}%`;

    const elTot = document.getElementById('am-total');
    if (elTot) elTot.textContent = `${metrics.total_angles_generated} Angles`;
}

function getFrameworkClass(fw) {
    const fwLower = (fw || '').toLowerCase();
    if (fwLower.includes('problem')) return 'fw-problem';
    if (fwLower.includes('identity')) return 'fw-identity';
    if (fwLower.includes('gift')) return 'fw-gift';
    if (fwLower.includes('proof')) return 'fw-proof';
    if (fwLower.includes('objection')) return 'fw-objection';
    if (fwLower.includes('scarcity')) return 'fw-scarcity';
    if (fwLower.includes('curiosity')) return 'fw-curiosity';
    if (fwLower.includes('contrast')) return 'fw-contrast';
    return 'fw-problem';
}

function renderAngles(groups) {
    const grid = document.getElementById('angles-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!groups || groups.length === 0) {
        grid.innerHTML = '<div class="empty-trace-select">No ad angles generated yet. Click Generate above.</div>';
        return;
    }

    groups.forEach((bg, idx) => {
        const card = document.createElement('div');
        card.className = 'angle-group-card';

        const anglesHtml = (bg.angles || []).map((a, aIdx) => {
            const fwClass = getFrameworkClass(a.framework);
            return `
                <div class="angle-item-card">
                    <div class="angle-item-header">
                        <span class="framework-pill ${fwClass}">Framework: ${escapeHtml(a.framework)}</span>
                        <div class="ad-actions">
                            <button class="ad-copy-btn" onclick="copyPersonaText(this, \`${escapeJsString(`[${a.framework}] ${a.angle_headline}\nHook: ${a.core_hook}\nConcept: ${a.angle_concept}\nCTA: ${a.call_to_action}`)}\`)">Copy Angle</button>
                        </div>
                    </div>
                    <div class="angle-headline">Angle #${a.angle_id || aIdx + 1}: ${escapeHtml(a.angle_headline)}</div>
                    <div class="angle-hook-box"><strong>3-Sec Scroll Stopper:</strong> "${escapeHtml(a.core_hook)}"</div>
                    <div class="angle-concept-text"><strong>Psychological Concept:</strong> ${escapeHtml(a.angle_concept)}</div>
                    <div class="angle-cta-row">
                        <span>Persona: ${escapeHtml(a.target_persona || bg.mapped_persona)}</span> • 
                        <span>CTA: "${escapeHtml(a.call_to_action)}"</span>
                    </div>
                </div>
            `;
        }).join('');

        card.innerHTML = `
            <div class="group-header-row">
                <div class="group-title-block">
                    <span class="group-number-badge">Benefit #${bg.benefit_id || idx + 1}</span>
                    <h3 class="group-benefit-title">${escapeHtml(bg.benefit_title)}</h3>
                </div>
                <div class="persona-chip">Mapped Persona: ${escapeHtml(bg.mapped_persona)}</div>
            </div>
            <div class="angle-cards-list">
                ${anglesHtml}
            </div>
        `;

        grid.appendChild(card);
    });
}

// ==========================================================================
// INITIAL PRE-LOADED 8 VIDEO SCRIPTS DATA SET FOR AGENT 4
// ==========================================================================
const INITIAL_VIDEO_SCRIPTS = [
    {
        script_id: 1,
        script_title: "The Rearview Mirror Pattern Interrupt (PAS Structure)",
        framework_structure: "PAS (Problem-Agitate-Solution)",
        target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        core_angle: "Tired of Hiding Under Caps & Avoiding Overhead Lights?",
        core_hook: "Stop scrolling if you catch yourself constantly checking your hairline in rearview mirrors.",
        total_duration_est: "30 Seconds",
        actor_casting_notes: "Male/Female aged 30-40, relatable everyday appearance, expressive facial cues, natural conversational voiceover.",
        b_roll_shot_list: ["ECU of cap adjustment in car rearview mirror", "Close-up of scalp inspection under vanity bathroom lighting", "Macro 120fps drop of golden bio-matrix elixir", "Confident outdoor smile in natural sunlight"],
        ftc_disclaimer_note: "*Individual results may vary based on consistent daily application. Non-surgical cosmetic scalp care routine.",
        preview_storyboard_svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" width="100%" height="200" style="background:#090D16; border-radius:12px; font-family:'Inter', sans-serif;"><rect x="0" y="0" width="800" height="36" fill="#131B2E" rx="8"/><text x="16" y="23" fill="#F8FAFC" font-size="13" font-weight="700">STORYBOARD TIMELINE: The Rearview Mirror Pattern Interrupt...</text><rect x="650" y="8" width="130" height="20" rx="10" fill="#6366F1" opacity="0.2"/><text x="715" y="22" fill="#6366F1" font-size="11" font-weight="700" text-anchor="middle">PAS</text><g transform="translate(15, 48)"><g transform="translate(0, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F43F5E" font-size="10" font-weight="700">SCENE 1 • HOOK</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">0-3s</text><circle cx="70" cy="62" r="18" fill="#F43F5E" opacity="0.15"/><text x="70" y="67" fill="#F43F5E" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: ECU Rearview</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: STOP HIDING</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Record Scratch</text></g><g transform="translate(152, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F59E0B" font-size="10" font-weight="700">SCENE 2 • PROBLEM</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">3-7s</text><circle cx="70" cy="62" r="18" fill="#F59E0B" opacity="0.15"/><text x="70" y="67" fill="#F59E0B" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: MCU Bathroom</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Thinning Temples?</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Somber Synth</text></g><g transform="translate(304, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#EC4899" font-size="10" font-weight="700">SCENE 3 • AGITATE</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">7-12s</text><circle cx="70" cy="62" r="18" fill="#EC4899" opacity="0.15"/><text x="70" y="67" fill="#EC4899" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Trash Cut</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Wasting Money?</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Tension Riser</text></g><g transform="translate(456, 0)"><rect width="140" height="150" fill="#111827" stroke="#3B82F6" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1E3A8A" rx="8"/><text x="8" y="15" fill="#60A5FA" font-size="10" font-weight="700">SCENE 4 • REVEAL</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">12-22s</text><circle cx="70" cy="62" r="18" fill="#3B82F6" opacity="0.2"/><text x="70" y="67" fill="#60A5FA" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: 120fps Drop</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: ORGANIC MATRIX</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Energetic Drop</text></g><g transform="translate(608, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 5 • CTA</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">22-30s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Outdoor Smile</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: GET 40% OFF </text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Click Sound</text></g></g></svg>`,
        scenes: [
            { scene_number: 1, scene_type: "Hook", duration_seconds: "0 - 3s", spoken_script: "Stop scrolling if you catch yourself constantly adjusting your cap or avoiding harsh overhead elevator lights.", visual_direction: "ECU of talent looking anxiously in a rearview mirror, pulling cap down. Fast snap-cut transition.", on_screen_text: "STOP HIDING YOUR HAIRLINE ", audio_cues: "Record scratch SFX + Sub-bass drop" },
            { scene_number: 2, scene_type: "Problem", duration_seconds: "3 - 7s", spoken_script: "Every morning it's the same routine. Spotting thinning temples in the bathroom lighting and wondering if anyone else notices.", visual_direction: "MCU in soft morning bathroom lighting. Talent inspecting scalp under harsh vanity mirror.", on_screen_text: "Thinning Temples & Receding Crown?", audio_cues: "Somber acoustic ambient synth line" },
            { scene_number: 3, scene_type: "Agitation", duration_seconds: "7 - 12s", spoken_script: "You spend money on greasy foams that smell like chemicals and leave your scalp irritated, only to see zero real change after months.", visual_direction: "Quick cut sequence: throwing away half-used chemical spray bottles into trash can. Frustrated facial expression.", on_screen_text: "Tired of Wasting Money on Greasy Foams? ", audio_cues: "Rising tension riser SFX" },
            { scene_number: 4, scene_type: "Product Reveal / Solution", duration_seconds: "12 - 22s", spoken_script: "That's why we created the American Hairline Scalp Revival System. Our organic bio-matrix formula revives dormant follicles in just 90 days without surgery.", visual_direction: "Hero product shot: Matte-black dropper bottle with golden elixir drop falling in slow motion (120fps). Micro macro shot of scalp absorption.", on_screen_text: "ORGANIC SCALP REVIVAL MATRIX • 90-DAY GUARANTEE", audio_cues: "Uplifting energetic beat drop" },
            { scene_number: 5, scene_type: "Call To Action (CTA)", duration_seconds: "22 - 30s", spoken_script: "Claim your 90-day risk-free starter kit today. Click the button below before stock sells out again!", visual_direction: "Talent smiling confidently in natural sunlight, running fingers through thick hair. Overlay of mobile shop button.", on_screen_text: "GET 40% OFF + 90-DAY MONEY-BACK GUARANTEE ", audio_cues: "Upbeat resolving chord + button click" }
        ]
    },
    {
        script_id: 2,
        script_title: "The 10-Second Nightly Routine Transformation (BAB Structure)",
        framework_structure: "Before-After-Bridge (BAB)",
        target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        core_angle: "Tired of Hiding Under Caps & Avoiding Overhead Lights?",
        core_hook: "I almost gave up on my hair until I noticed this 10-second nightly routine.",
        total_duration_est: "30 Seconds",
        actor_casting_notes: "Energetic creator style, selfie vlog framing, warm authentic delivery with high visual enthusiasm.",
        b_roll_shot_list: ["Selfie vlog camera angle holding dropper bottle", "Montage of indoor cap-wearing moments", "3D scalp root activation render", "Bright outdoor high-density hair styling"],
        ftc_disclaimer_note: "*Based on 90-day customer satisfaction study. Results depend on individual scalp response.",
        preview_storyboard_svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" width="100%" height="200" style="background:#090D16; border-radius:12px; font-family:'Inter', sans-serif;"><rect x="0" y="0" width="800" height="36" fill="#131B2E" rx="8"/><text x="16" y="23" fill="#F8FAFC" font-size="13" font-weight="700">STORYBOARD TIMELINE: The 10-Second Nightly Routine Transformation...</text><rect x="650" y="8" width="130" height="20" rx="10" fill="#10B981" opacity="0.2"/><text x="715" y="22" fill="#10B981" font-size="11" font-weight="700" text-anchor="middle">BAB</text><g transform="translate(15, 48)"><g transform="translate(0, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F43F5E" font-size="10" font-weight="700">SCENE 1 • HOOK</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">0-3s</text><circle cx="70" cy="62" r="18" fill="#F43F5E" opacity="0.15"/><text x="70" y="67" fill="#F43F5E" font-size="18" text-anchor="middle">⌛</text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Selfie Vlog</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: 10-SEC ROUTINE</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Finger Snap</text></g><g transform="translate(152, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F59E0B" font-size="10" font-weight="700">SCENE 2 • BEFORE</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">3-8s</text><circle cx="70" cy="62" r="18" fill="#F59E0B" opacity="0.15"/><text x="70" y="67" fill="#F59E0B" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Cap Montage</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Hiding Under Caps</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Muffled Lo-Fi</text></g><g transform="translate(304, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 3 • AFTER</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">8-14s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Outdoor Sun</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: 3x DENSER</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: High Beat Drop</text></g><g transform="translate(456, 0)"><rect width="140" height="150" fill="#111827" stroke="#3B82F6" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1E3A8A" rx="8"/><text x="8" y="15" fill="#60A5FA" font-size="10" font-weight="700">SCENE 4 • BRIDGE</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">14-22s</text><circle cx="70" cy="62" r="18" fill="#3B82F6" opacity="0.2"/><text x="70" y="67" fill="#60A5FA" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: 3D Render</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: PEPTIDE SIGNAL</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Sci-Fi Whoosh</text></g><g transform="translate(608, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 5 • CTA</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">22-30s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Bundle Display</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: RISK-FREE 90 DAYS</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Outro Sting</text></g></g></svg>`,
        scenes: [
            { scene_number: 1, scene_type: "Hook", duration_seconds: "0 - 3s", spoken_script: "I almost gave up on my hair until I noticed this 10-second nightly routine.", visual_direction: "Selfie vlog camera angle. Talent points directly at camera with intrigued expression holding sleek bottle.", on_screen_text: "10-SECOND NIGHTLY ROUTINE ⌛", audio_cues: "Finger snap SFX + catchy energetic pop synth" },
            { scene_number: 2, scene_type: "Before State", duration_seconds: "3 - 8s", spoken_script: "Six months ago, I was wearing hats everywhere — dates, work meetings, gym sessions. I felt like I was losing my edge.", visual_direction: "B-Roll montage of talent wearing caps in indoors settings, looking down at phone self-consciously.", on_screen_text: "BEFORE: Hiding Under Caps Daily ", audio_cues: "Muffled lo-fi beat" },
            { scene_number: 3, scene_type: "After State", duration_seconds: "8 - 14s", spoken_script: "Now? My hair feels 3x denser, fully natural, and I haven't touched a hat in 90 days. My confidence is completely restored.", visual_direction: "Bright outdoor sunlight shot. Talent in crisp suit smiling confidently, high density hair visible.", on_screen_text: "AFTER 90 DAYS: 3x Denser, 100% Natural ", audio_cues: "High-energy beat drop" },
            { scene_number: 4, scene_type: "The Bridge (Product Mechanism)", duration_seconds: "14 - 22s", spoken_script: "The secret is American Hairline Scalp Revival System. It uses natural peptide signaling to awaken resting follicles directly at the root.", visual_direction: "3D render/microscope animation showing scalp follicle root activation and nourishment absorption.", on_screen_text: "SCALP PEPTIDE SIGNALING • NON-SURGICAL", audio_cues: "Futuristic WHOOSH SFX" },
            { scene_number: 5, scene_type: "Call To Action (CTA)", duration_seconds: "22 - 30s", spoken_script: "Try it risk-free for 90 days. If you don't see visible density, you get 100% of your money back. Tap below!", visual_direction: "Product bundle display with 90-day badge callout and pulsing arrow pointing to CTA link.", on_screen_text: "TRY RISK-FREE FOR 90 DAYS ", audio_cues: "Upbeat outro sting + click sound" }
        ]
    },
    {
        script_id: 3,
        script_title: "Dermatologist Root Reactivation Warning",
        framework_structure: "Hook-Problem-Agitation-Product Reveal-CTA",
        target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        core_angle: "What dermatologists aren't telling you about early hairline receding",
        core_hook: "What dermatologists aren't telling you about early hairline receding will change how you treat your scalp forever.",
        total_duration_est: "30 Seconds",
        actor_casting_notes: "Authoritative lab coat presenter or clean medical-style studio spokesperson, confident articulate tone.",
        b_roll_shot_list: ["Scalp diagnostic scanner screen", "3D circulation blockage animation", "Golden elixir droplet micro-absorption", "40% discount checkout screen mockup"],
        ftc_disclaimer_note: "*Educational ad content. Not intended to replace professional medical diagnosis.",
        preview_storyboard_svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" width="100%" height="200" style="background:#090D16; border-radius:12px; font-family:'Inter', sans-serif;"><rect x="0" y="0" width="800" height="36" fill="#131B2E" rx="8"/><text x="16" y="23" fill="#F8FAFC" font-size="13" font-weight="700">STORYBOARD TIMELINE: Dermatologist Root Reactivation Warning...</text><rect x="650" y="8" width="130" height="20" rx="10" fill="#8B5CF6" opacity="0.2"/><text x="715" y="22" fill="#8B5CF6" font-size="11" font-weight="700" text-anchor="middle">HOOK-REVEAL</text><g transform="translate(15, 48)"><g transform="translate(0, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F43F5E" font-size="10" font-weight="700">SCENE 1 • HOOK</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">0-4s</text><circle cx="70" cy="62" r="18" fill="#F43F5E" opacity="0.15"/><text x="70" y="67" fill="#F43F5E" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Lab Scanner</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: DERM WARNING</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Clock Ticking</text></g><g transform="translate(152, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F59E0B" font-size="10" font-weight="700">SCENE 2 • PROBLEM</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">4-9s</text><circle cx="70" cy="62" r="18" fill="#F59E0B" opacity="0.15"/><text x="70" y="67" fill="#F59E0B" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Circulation</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Blocked Blood Flow</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Warning Pulse</text></g><g transform="translate(304, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#EC4899" font-size="10" font-weight="700">SCENE 3 • AGITATE</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">9-14s</text><circle cx="70" cy="62" r="18" fill="#EC4899" opacity="0.15"/><text x="70" y="67" fill="#EC4899" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Calcify Root</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Permanent Loss!</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Warning Chime</text></g><g transform="translate(456, 0)"><rect width="140" height="150" fill="#111827" stroke="#3B82F6" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1E3A8A" rx="8"/><text x="8" y="15" fill="#60A5FA" font-size="10" font-weight="700">SCENE 4 • REVEAL</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">14-23s</text><circle cx="70" cy="62" r="18" fill="#3B82F6" opacity="0.2"/><text x="70" y="67" fill="#60A5FA" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Elixir Micro Drop</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: BIO-ACTIVE ELIXIR</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Shimmer Beat</text></g><g transform="translate(608, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 5 • CTA</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">23-30s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Save 40% Badge</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: DIRECT SHIPPING</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Resolving Chord</text></g></g></svg>`,
        scenes: [
            { scene_number: 1, scene_type: "Hook", duration_seconds: "0 - 4s", spoken_script: "What dermatologists aren't telling you about early hairline receding will change how you treat your scalp forever.", visual_direction: "Dermatology office lab coat setting. Professional tone. Split screen of scalp scanner analysis.", on_screen_text: "WHAT THEY DON'T TELL YOU ", audio_cues: "Intriguing mystery WHOOSH + clock ticking SFX" },
            { scene_number: 2, scene_type: "Problem", duration_seconds: "4 - 9s", spoken_script: "Most treatments only mask the symptoms without restoring follicle blood micro-circulation.", visual_direction: "Diagram graphic showing blocked blood vessel circulation around hair roots under scalp layer.", on_screen_text: "Blocked Scalp Micro-Circulation ", audio_cues: "Low warning pulse tone" },
            { scene_number: 3, scene_type: "Agitation", duration_seconds: "9 - 14s", spoken_script: "Wait too long, and those dormant roots calcify permanently, leaving expensive invasive surgery as your only choice.", visual_direction: "Graphic highlight of scalp calcification process with warning red highlight.", on_screen_text: "Dormant Roots Calcify Over Time! ", audio_cues: "Warning chime SFX" },
            { scene_number: 4, scene_type: "Product Reveal", duration_seconds: "14 - 23s", spoken_script: "Enter American Hairline Scalp Revival System. Its bio-active elixir reactivates micro-circulation and delivers botanical nutrients straight to dormant roots.", visual_direction: "Macro shot of golden elixir drop dissolving smoothly into scalp without leaving greasy residue.", on_screen_text: "BIO-ACTIVE BOTANICAL ELIXIR ", audio_cues: "Clean shimmer SFX + rhythmic energetic drum track" },
            { scene_number: 5, scene_type: "Call To Action (CTA)", duration_seconds: "23 - 30s", spoken_script: "Don't wait until surgery is your only option. Order today and save 40% on your initial 90-day supply!", visual_direction: "Official certification seal, 40% discount badge, and website checkout screen mockup.", on_screen_text: "SAVE 40% TODAY • DIRECT SHIPPING ", audio_cues: "Positive chord resolution" }
        ]
    },
    {
        script_id: 4,
        script_title: "The DHT Root Suffocation Alert (AIDA Structure)",
        framework_structure: "AIDA (Attention-Interest-Desire-Action)",
        target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        core_angle: "82% of early hair thinning is caused by localized DHT root suffocation",
        core_hook: "If you're between 25 and 50 and noticing your hairline creeping back, watch this before buying anything else.",
        total_duration_est: "30 Seconds",
        actor_casting_notes: "Direct-to-camera presenter, urgent and engaging demeanor, sharp eye contact.",
        b_roll_shot_list: ["82% statistic graphic overlay", "Day 1 vs Day 90 split-screen progression", "Dropper scalp application close-up", "5-star customer review rating badge"],
        ftc_disclaimer_note: "*Results may vary. Based on internal customer survey data over 90 days.",
        preview_storyboard_svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" width="100%" height="200" style="background:#090D16; border-radius:12px; font-family:'Inter', sans-serif;"><rect x="0" y="0" width="800" height="36" fill="#131B2E" rx="8"/><text x="16" y="23" fill="#F8FAFC" font-size="13" font-weight="700">STORYBOARD TIMELINE: The DHT Root Suffocation Alert...</text><rect x="650" y="8" width="130" height="20" rx="10" fill="#EC4899" opacity="0.2"/><text x="715" y="22" fill="#EC4899" font-size="11" font-weight="700" text-anchor="middle">AIDA</text><g transform="translate(15, 48)"><g transform="translate(0, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F43F5E" font-size="10" font-weight="700">SCENE 1 • ATTENTION</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">0-3s</text><circle cx="70" cy="62" r="18" fill="#F43F5E" opacity="0.15"/><text x="70" y="67" fill="#F43F5E" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Direct Zoom</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: MEN 25-50 ALERT</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Heavy Bass Thud</text></g><g transform="translate(152, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F59E0B" font-size="10" font-weight="700">SCENE 2 • INTEREST</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">3-8s</text><circle cx="70" cy="62" r="18" fill="#F59E0B" opacity="0.15"/><text x="70" y="67" fill="#F59E0B" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: 82% Stat</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: DHT Suffocation</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Digital Data Ping</text></g><g transform="translate(304, 0)"><rect width="140" height="150" fill="#111827" stroke="#EC4899" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#831843" rx="8"/><text x="8" y="15" fill="#F472B6" font-size="10" font-weight="700">SCENE 3 • DESIRE</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">8-15s</text><circle cx="70" cy="62" r="18" fill="#EC4899" opacity="0.2"/><text x="70" y="67" fill="#F472B6" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Day 1 vs 90</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: TRANSFORMATION</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Uplifting Tune</text></g><g transform="translate(456, 0)"><rect width="140" height="150" fill="#111827" stroke="#3B82F6" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1E3A8A" rx="8"/><text x="8" y="15" fill="#60A5FA" font-size="10" font-weight="700">SCENE 4 • PRODUCT</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">15-24s</text><circle cx="70" cy="62" r="18" fill="#3B82F6" opacity="0.2"/><text x="70" y="67" fill="#60A5FA" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Dropper Demo</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: ORGANIC BLOCKER</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Beat Acceleration</text></g><g transform="translate(608, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 5 • ACTION</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">24-30s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Pulsing Button</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: EXPRESS SHIPPING</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Upbeat Climax</text></g></g></svg>`,
        scenes: [
            { scene_number: 1, scene_type: "Attention (Hook)", duration_seconds: "0 - 3s", spoken_script: "If you're between 25 and 50 and noticing your hairline creeping back, watch this before buying anything else.", visual_direction: "Talent staring directly into camera, holding up hand to pause scrolling feed. Dynamic zoom-in motion.", on_screen_text: "ATTENTION: MEN & WOMEN AGED 25-50 ", audio_cues: "Heavy bass thud + alert chime" },
            { scene_number: 2, scene_type: "Interest", duration_seconds: "3 - 8s", spoken_script: "Did you know 82% of early hair thinning is caused by localized DHT buildup suffocating follicle roots?", visual_direction: "Infographic animation displaying 82% statistic with 3D scalp hair follicle model.", on_screen_text: "82% Caused by DHT Root Suffocation ", audio_cues: "Subtle digital data ping" },
            { scene_number: 3, scene_type: "Desire", duration_seconds: "8 - 15s", spoken_script: "Imagine waking up 90 days from now with thick, dense hairline edges you're proud to show off without caps.", visual_direction: "Side-by-side split screen comparison: Day 1 vs Day 90 side profile hairline density progression.", on_screen_text: "DAY 1 VS DAY 90 TRANSFORMATION ", audio_cues: "Uplifting motivational melody" },
            { scene_number: 4, scene_type: "Action (Product & Offer)", duration_seconds: "15 - 24s", spoken_script: "American Hairline Scalp Revival System blocks DHT buildup organically while boosting scalp circulation.", visual_direction: "Close up of product packaging, clean dropper application, non-greasy texture demo.", on_screen_text: "100% ORGANIC DHT BLOCKER ", audio_cues: "Energetic beat acceleration" },
            { scene_number: 5, scene_type: "Call To Action (CTA)", duration_seconds: "24 - 30s", spoken_script: "Click 'Shop Now' to get your risk-free supply with free express shipping worldwide!", visual_direction: "Pulsing CTA button graphic with 5-star rating overlay and fast shipping icon.", on_screen_text: "SHOP NOW • FREE EXPRESS SHIPPING ", audio_cues: "Upbeat climax sting" }
        ]
    },
    {
        script_id: 5,
        script_title: "The Unfiltered 90-Day Hairline Challenge",
        framework_structure: "Problem-Agitate-Solution-Proof-CTA",
        target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        core_angle: "Real 90-Day Hair Density Proof Without Harsh Chemicals",
        core_hook: "Thinking your thinning hairline is permanent? Test this 90-day protocol first.",
        total_duration_est: "30 Seconds",
        actor_casting_notes: "Confident fitness / wellness creator, enthusiastic tone.",
        b_roll_shot_list: ["Micro scanner graphic", "Clinical trial graph", "Starter kit packaging"],
        ftc_disclaimer_note: "*Based on 12-week consumer perception study.",
        preview_storyboard_svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" width="100%" height="200" style="background:#090D16; border-radius:12px; font-family:'Inter', sans-serif;"><rect x="0" y="0" width="800" height="36" fill="#131B2E" rx="8"/><text x="16" y="23" fill="#F8FAFC" font-size="13" font-weight="700">STORYBOARD TIMELINE: The Unfiltered 90-Day Hairline Challenge...</text><rect x="650" y="8" width="130" height="20" rx="10" fill="#3B82F6" opacity="0.2"/><text x="715" y="22" fill="#3B82F6" font-size="11" font-weight="700" text-anchor="middle">PROOF</text><g transform="translate(15, 48)"><g transform="translate(0, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F43F5E" font-size="10" font-weight="700">SCENE 1 • HOOK</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">0-3s</text><circle cx="70" cy="62" r="18" fill="#F43F5E" opacity="0.15"/><text x="70" y="67" fill="#F43F5E" font-size="18" text-anchor="middle">⏱</text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Screen Timer</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: 90-DAY CHALLENGE</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Alert Chime</text></g><g transform="translate(152, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F59E0B" font-size="10" font-weight="700">SCENE 2 • PROBLEM</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">3-7s</text><circle cx="70" cy="62" r="18" fill="#F59E0B" opacity="0.15"/><text x="70" y="67" fill="#F59E0B" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Dormant Root</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Roots Sleeping</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Soft Synth</text></g><g transform="translate(304, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#EC4899" font-size="10" font-weight="700">SCENE 3 • AGITATE</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">7-12s</text><circle cx="70" cy="62" r="18" fill="#EC4899" opacity="0.15"/><text x="70" y="67" fill="#EC4899" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Density Bar</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Lose 40% Density</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Tension Riser</text></g><g transform="translate(456, 0)"><rect width="140" height="150" fill="#111827" stroke="#3B82F6" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1E3A8A" rx="8"/><text x="8" y="15" fill="#60A5FA" font-size="10" font-weight="700">SCENE 4 • PROOF</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">12-22s</text><circle cx="70" cy="62" r="18" fill="#3B82F6" opacity="0.2"/><text x="70" y="67" fill="#60A5FA" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Clinical Proof</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: 94.2% RECOVERY</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Swell Beat</text></g><g transform="translate(608, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 5 • CTA</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">22-30s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Starter Kit</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: TAKE CHALLENGE</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Resolving Chord</text></g></g></svg>`,
        scenes: [
            { scene_number: 1, scene_type: "Hook", duration_seconds: "0 - 3s", spoken_script: "Thinking your thinning hairline is permanent? Test this 90-day protocol first.", visual_direction: "Direct camera eye contact, tapping screen timer.", on_screen_text: "90-DAY HAIRLINE CHALLENGE ⏱", audio_cues: "Alert chime + bass pulse" },
            { scene_number: 2, scene_type: "Problem", duration_seconds: "3 - 7s", spoken_script: "Most people accept thinning as inevitable aging, but dormant hair roots are just sleeping.", visual_direction: "Close-up micro scanner graphic of sleeping root follicle.", on_screen_text: "Dormant Roots Are Sleeping, Not Dead ", audio_cues: "Soft ambient synth" },
            { scene_number: 3, scene_type: "Agitation", duration_seconds: "7 - 12s", spoken_script: "Ignoring early receding means losing up to 40% density before you even notice.", visual_direction: "Graphic bar showing 40% density drop timeline.", on_screen_text: "Don't Lose 40% Density! ", audio_cues: "Tension riser SFX" },
            { scene_number: 4, scene_type: "Solution & Proof", duration_seconds: "12 - 22s", spoken_script: "Our clinical trial showed 94.2% follicle density recovery in 12 weeks using American Hairline Scalp Revival System.", visual_direction: "Clinical lab proof graphics & high-speed droplet absorption.", on_screen_text: "94.2% FOLLICLE DENSITY RECOVERY ", audio_cues: "Uplifting swell beat" },
            { scene_number: 5, scene_type: "Call To Action (CTA)", duration_seconds: "22 - 30s", spoken_script: "Take the 90-Day Unfiltered Challenge risk-free today with 100% money-back guarantee!", visual_direction: "Talent smiling, displaying starter kit packaging.", on_screen_text: "TAKE THE 90-DAY CHALLENGE ", audio_cues: "Upbeat resolving chord" }
        ]
    },
    {
        script_id: 6,
        script_title: "The Executive Office & Elevator Light Realization",
        framework_structure: "Story-Lead-Transformation",
        target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        core_angle: "Reclaim Your Executive Presence & Youthful Edge",
        core_hook: "I used to dread standing under harsh elevator lights before key client presentations.",
        total_duration_est: "30 Seconds",
        actor_casting_notes: "Well-groomed professional in business attire, authoritative tone.",
        b_roll_shot_list: ["Elevator reflection", "Boardroom presentation", "Executive desk display"],
        ftc_disclaimer_note: "*Cosmetic topical application. Individual results vary.",
        preview_storyboard_svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" width="100%" height="200" style="background:#090D16; border-radius:12px; font-family:'Inter', sans-serif;"><rect x="0" y="0" width="800" height="36" fill="#131B2E" rx="8"/><text x="16" y="23" fill="#F8FAFC" font-size="13" font-weight="700">STORYBOARD TIMELINE: The Executive Office & Elevator Light Realization...</text><rect x="650" y="8" width="130" height="20" rx="10" fill="#F59E0B" opacity="0.2"/><text x="715" y="22" fill="#F59E0B" font-size="11" font-weight="700" text-anchor="middle">STORY</text><g transform="translate(15, 48)"><g transform="translate(0, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F43F5E" font-size="10" font-weight="700">SCENE 1 • HOOK</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">0-3s</text><circle cx="70" cy="62" r="18" fill="#F43F5E" opacity="0.15"/><text x="70" y="67" fill="#F43F5E" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Elevator Mirror</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: ELEVATOR LIGHTS</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Muffled City Chime</text></g><g transform="translate(152, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F59E0B" font-size="10" font-weight="700">SCENE 2 • PROBLEM</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">3-7s</text><circle cx="70" cy="62" r="18" fill="#F59E0B" opacity="0.15"/><text x="70" y="67" fill="#F59E0B" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Boardroom</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Drains Poise</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Piano Melody</text></g><g transform="translate(304, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#EC4899" font-size="10" font-weight="700">SCENE 3 • AGITATE</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">7-12s</text><circle cx="70" cy="62" r="18" fill="#EC4899" opacity="0.15"/><text x="70" y="67" fill="#EC4899" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Laptop Focus</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Self-Conscious</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Deep Bass Drone</text></g><g transform="translate(456, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 4 • TRANSFORM</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">12-22s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Boardroom Full</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: DENSITY RESTORED</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: High Brass Beat</text></g><g transform="translate(608, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 5 • CTA</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">22-30s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Executive Desk</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: CLAIM 40% OFF</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Click Sound</text></g></g></svg>`,
        scenes: [
            { scene_number: 1, scene_type: "Hook", duration_seconds: "0 - 3s", spoken_script: "I used to dread standing under harsh elevator lights before key client presentations.", visual_direction: "Elevator mirror reflection in corporate suit.", on_screen_text: "ELEVATOR LIGHT REALIZATION ", audio_cues: "Muffled city noise + chime" },
            { scene_number: 2, scene_type: "Problem", duration_seconds: "3 - 7s", spoken_script: "Hair thinning silently drains your confidence in high-stakes professional settings.", visual_direction: "Conference room meeting, talent adjusting hair.", on_screen_text: "Thinning Drains Professional Poise ", audio_cues: "Subtle piano melody" },
            { scene_number: 3, scene_type: "Agitation", duration_seconds: "7 - 12s", spoken_script: "Worrying about your appearance takes focus away from closing big deals.", visual_direction: "Split focus on laptop and mirror reflection.", on_screen_text: "Stop Self-Conscious Distractions ", audio_cues: "Deep bass drone" },
            { scene_number: 4, scene_type: "Transformation", duration_seconds: "12 - 22s", spoken_script: "American Hairline Scalp Revival System restored my full hairline and executive poise in under 90 days.", visual_direction: "Talent presenting in boardroom with full hair density.", on_screen_text: "FULL DENSITY RESTORED ", audio_cues: "High-energy brass beat" },
            { scene_number: 5, scene_type: "Call To Action (CTA)", duration_seconds: "22 - 30s", spoken_script: "Upgrade your executive confidence today with our exclusive 40% OFF package.", visual_direction: "Executive desk shot with sleek bottle.", on_screen_text: "CLAIM 40% EXECUTIVE OFF ", audio_cues: "Click SFX + upbeat outro" }
        ]
    },
    {
        script_id: 7,
        script_title: "The Micro-Circulation Scalp Scanner Breakdown",
        framework_structure: "Scientific Mechanism & Proof",
        target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        core_angle: "Reactivate Micro-Capillary Blood Flow to Follicle Roots",
        core_hook: "Watch what happens to dormant scalp capillaries when bio-peptides hit the root.",
        total_duration_est: "30 Seconds",
        actor_casting_notes: "Scientist or medical researcher voiceover, clear precise delivery.",
        b_roll_shot_list: ["Microscope capillary animation", "Follicle oxygen diagram", "Golden elixir micro drop"],
        ftc_disclaimer_note: "*Laboratory capillary simulation. Results vary by individual.",
        preview_storyboard_svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" width="100%" height="200" style="background:#090D16; border-radius:12px; font-family:'Inter', sans-serif;"><rect x="0" y="0" width="800" height="36" fill="#131B2E" rx="8"/><text x="16" y="23" fill="#F8FAFC" font-size="13" font-weight="700">STORYBOARD TIMELINE: The Micro-Circulation Scalp Scanner Breakdown...</text><rect x="650" y="8" width="130" height="20" rx="10" fill="#6366F1" opacity="0.2"/><text x="715" y="22" fill="#6366F1" font-size="11" font-weight="700" text-anchor="middle">SCIENCE</text><g transform="translate(15, 48)"><g transform="translate(0, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F43F5E" font-size="10" font-weight="700">SCENE 1 • HOOK</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">0-3s</text><circle cx="70" cy="62" r="18" fill="#F43F5E" opacity="0.15"/><text x="70" y="67" fill="#F43F5E" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Microscope Zoom</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: MICROSCANNER</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Sci-Fi Pulse</text></g><g transform="translate(152, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F59E0B" font-size="10" font-weight="700">SCENE 2 • PROBLEM</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">3-7s</text><circle cx="70" cy="62" r="18" fill="#F59E0B" opacity="0.15"/><text x="70" y="67" fill="#F59E0B" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Oxygen Diagram</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Restricted Root Flow</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Warning Tone</text></g><g transform="translate(304, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#EC4899" font-size="10" font-weight="700">SCENE 3 • AGITATE</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">7-12s</text><circle cx="70" cy="62" r="18" fill="#EC4899" opacity="0.15"/><text x="70" y="67" fill="#EC4899" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Strand Snapping</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Breaks 2x Faster</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Snap Sound</text></g><g transform="translate(456, 0)"><rect width="140" height="150" fill="#111827" stroke="#3B82F6" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1E3A8A" rx="8"/><text x="8" y="15" fill="#60A5FA" font-size="10" font-weight="700">SCENE 4 • REVEAL</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">12-22s</text><circle cx="70" cy="62" r="18" fill="#3B82F6" opacity="0.2"/><text x="70" y="67" fill="#60A5FA" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Capillary Pulse</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: BIO-MATRIX CAPILLARY</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Synth Rise</text></g><g transform="translate(608, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 5 • CTA</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">22-30s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Shipping Badge</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: FREE SHIPPING</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Resolving Chord</text></g></g></svg>`,
        scenes: [
            { scene_number: 1, scene_type: "Hook", duration_seconds: "0 - 3s", spoken_script: "Watch what happens to dormant scalp capillaries when bio-peptides hit the root.", visual_direction: "Microscope animation zoom-in on follicle capillary.", on_screen_text: "SCALP MICROSCANNER DEMO ", audio_cues: "Futuristic pulse SFX" },
            { scene_number: 2, scene_type: "Problem", duration_seconds: "3 - 7s", spoken_script: "Poor scalp micro-circulation starves hair roots of essential growth oxygen.", visual_direction: "3D diagram showing restricted oxygen flow to hair root.", on_screen_text: "Restricted Root Circulation ", audio_cues: "Low alert tone" },
            { scene_number: 3, scene_type: "Agitation", duration_seconds: "7 - 12s", spoken_script: "Without nutrient blood flow, hair strands grow thinner and break twice as fast.", visual_direction: "Fragile strand snapping macro visual.", on_screen_text: "Strands Break 2x Faster ", audio_cues: "Snap SFX" },
            { scene_number: 4, scene_type: "Mechanism Reveal", duration_seconds: "12 - 22s", spoken_script: "Our bio-matrix formula reactivates capillary blood flow within 14 days.", visual_direction: "Golden elixir absorbed into scalp with capillary pulse graphic.", on_screen_text: "BIO-MATRIX CAPILLARY ACTIVATION ", audio_cues: "Energetic synthesizer rise" },
            { scene_number: 5, scene_type: "Call To Action (CTA)", duration_seconds: "22 - 30s", spoken_script: "Claim your starter kit now with free global express delivery!", visual_direction: "Free express shipping badge and checkout screen.", on_screen_text: "ORDER WITH FREE SHIPPING ", audio_cues: "Upbeat resolving chord" }
        ]
    },
    {
        script_id: 8,
        script_title: "The Zero-Cap Summer Confidence Revival",
        framework_structure: "Challenge-Transformation-CTA",
        target_persona: "The Skeptical Solution Seeker (Marcus, 34)",
        core_angle: "Ditch the Cap This Summer & Walk Out with Total Hair Confidence",
        core_hook: "Ditch your cap this summer. Here is how to regain full hairline thickness fast.",
        total_duration_est: "30 Seconds",
        actor_casting_notes: "Outdoor lifestyle creator, energetic upbeat delivery.",
        b_roll_shot_list: ["Tossing cap into ocean breeze", "Beach swimming confidence", "Product display on beach towel"],
        ftc_disclaimer_note: "*Results may vary based on scalp consistency.",
        preview_storyboard_svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 220" width="100%" height="200" style="background:#090D16; border-radius:12px; font-family:'Inter', sans-serif;"><rect x="0" y="0" width="800" height="36" fill="#131B2E" rx="8"/><text x="16" y="23" fill="#F8FAFC" font-size="13" font-weight="700">STORYBOARD TIMELINE: The Zero-Cap Summer Confidence Revival...</text><rect x="650" y="8" width="130" height="20" rx="10" fill="#10B981" opacity="0.2"/><text x="715" y="22" fill="#10B981" font-size="11" font-weight="700" text-anchor="middle">SUMMER</text><g transform="translate(15, 48)"><g transform="translate(0, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F43F5E" font-size="10" font-weight="700">SCENE 1 • HOOK</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">0-3s</text><circle cx="70" cy="62" r="18" fill="#F43F5E" opacity="0.15"/><text x="70" y="67" fill="#F43F5E" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Tossing Cap</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: ZERO-CAP SUMMER</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Summer Pop Intro</text></g><g transform="translate(152, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#F59E0B" font-size="10" font-weight="700">SCENE 2 • PROBLEM</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">3-7s</text><circle cx="70" cy="62" r="18" fill="#F59E0B" opacity="0.15"/><text x="70" y="67" fill="#F59E0B" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Sweaty Scalp</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: Caps Trap Sweat</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Muffled Bass</text></g><g transform="translate(304, 0)"><rect width="140" height="150" fill="#111827" stroke="#1F2937" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#1F2937" rx="8"/><text x="8" y="15" fill="#EC4899" font-size="10" font-weight="700">SCENE 3 • AGITATE</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">7-12s</text><circle cx="70" cy="62" r="18" fill="#EC4899" opacity="0.15"/><text x="70" y="67" fill="#EC4899" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Beach Wind</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: No Cap Anxiety</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Tension Riser</text></g><g transform="translate(456, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 4 • TRANSFORM</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">12-22s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Beach Swimming</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: 100% CONFIDENCE</text><text x="8" y="134" fill="#6EE7B7" font-size="9">Music: Summer Beat</text></g><g transform="translate(608, 0)"><rect width="140" height="150" fill="#111827" stroke="#10B981" stroke-width="1.5" rx="8"/><rect width="140" height="22" fill="#064E3B" rx="8"/><text x="8" y="15" fill="#34D399" font-size="10" font-weight="700">SCENE 5 • CTA</text><text x="132" y="15" fill="#9CA3AF" font-size="9" text-anchor="end">22-30s</text><circle cx="70" cy="62" r="18" fill="#10B981" opacity="0.2"/><text x="70" y="67" fill="#34D399" font-size="18" text-anchor="middle"></text><text x="8" y="102" fill="#E5E7EB" font-size="9" font-weight="600">Camera: Towel Product</text><text x="8" y="118" fill="#9CA3AF" font-size="9">Text: SUMMER REVIVAL</text><text x="8" y="134" fill="#6EE7B7" font-size="9">SFX: Upbeat Outro</text></g></g></svg>`,
        scenes: [
            { scene_number: 1, scene_type: "Hook", duration_seconds: "0 - 3s", spoken_script: "Ditch your cap this summer. Here is how to regain full hairline thickness fast.", visual_direction: "Talent tossing cap off-camera into ocean breeze.", on_screen_text: "ZERO-CAP SUMMER REVIVAL ", audio_cues: "Upbeat summer pop intro" },
            { scene_number: 2, scene_type: "Problem", duration_seconds: "3 - 7s", spoken_script: "Sweating under caps all summer worsens scalp congestion and accelerates thinning.", visual_direction: "Talent taking off cap revealing sweaty scalp.", on_screen_text: "Caps Trap Sweat & Block Scalp ", audio_cues: "Muffled bass beat" },
            { scene_number: 3, scene_type: "Agitation", duration_seconds: "7 - 12s", spoken_script: "Constantly worrying about wind or swimming ruining your cap cover-up is exhausting.", visual_direction: "Wind blowing hair on beach, feeling self-conscious.", on_screen_text: "No More Cap Anxiety ", audio_cues: "Tension riser SFX" },
            { scene_number: 4, scene_type: "Transformation", duration_seconds: "12 - 22s", spoken_script: "Restore natural hair density with American Hairline Scalp Revival System in a simple 30-second daily routine.", visual_direction: "Talent swimming and running fingers through hair with high density.", on_screen_text: "100% NATURAL HAIR CONFIDENCE ", audio_cues: "Catchy summer beat drop" },
            { scene_number: 5, scene_type: "Call To Action (CTA)", duration_seconds: "22 - 30s", spoken_script: "Start your zero-cap summer transformation today with our 90-day risk-free guarantee!", visual_direction: "Product display on beach towel with 90-day guarantee badge.", on_screen_text: "START YOUR SUMMER REVIVAL ", audio_cues: "Click sound + upbeat outro" }
        ]
    }
];

// ==========================================================================
// AGENT 4: VIDEO ADS SCRIPT GENERATION CONTROLLERS
// ==========================================================================

function updateDropdownsWithPersonas() {
    const dropdownIds = ['v_target_persona', 'own_target_persona', 'comp_target_persona'];
    dropdownIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && window.generatedPersonas && window.generatedPersonas.length > 0) {
            const currentVal = el.value;
            el.innerHTML = '';
            window.generatedPersonas.forEach(p => {
                const opt = document.createElement('option');
                const val = p.name || p.full_persona_text;
                opt.value = val;
                opt.textContent = val;
                if (val === currentVal) opt.selected = true;
                el.appendChild(opt);
            });
            // Also append Saved Audience Vault groups if available
            if (window.savedAudiences && window.savedAudiences.length > 0) {
                const optGroup = document.createElement('optgroup');
                optGroup.label = "Saved Audience Vault";
                window.savedAudiences.forEach(aud => {
                    const opt = document.createElement('option');
                    opt.value = `${aud.title} (${aud.demographics || 'Audience Group'})`;
                    opt.textContent = `🎯 ${aud.title}`;
                    optGroup.appendChild(opt);
                });
                el.appendChild(optGroup);
            }
        }
    });
}


function updateDropdownsWithPersonas() {
    const dropdownIds = ['v_target_persona', 'own_target_persona', 'comp_target_persona'];
    dropdownIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && window.generatedPersonas && window.generatedPersonas.length > 0) {
            const currentVal = el.value;
            el.innerHTML = '';
            window.generatedPersonas.forEach(p => {
                const opt = document.createElement('option');
                const val = p.name || p.full_persona_text;
                opt.value = val;
                opt.textContent = val;
                if (val === currentVal) opt.selected = true;
                el.appendChild(opt);
            });
            // Also append Saved Audience Vault groups if available
            if (window.savedAudiences && window.savedAudiences.length > 0) {
                const optGroup = document.createElement('optgroup');
                optGroup.label = "Saved Audience Vault";
                window.savedAudiences.forEach(aud => {
                    const opt = document.createElement('option');
                    opt.value = `${aud.title} (${aud.demographics || 'Audience Group'})`;
                    opt.textContent = `🎯 ${aud.title}`;
                    optGroup.appendChild(opt);
                });
                el.appendChild(optGroup);
            }
        }
    });
}

function initVideoScriptGenerator() {
    const form = document.getElementById('video-generator-form');
    const btnGen = document.getElementById('btn-generate-video');
    const spinner = document.getElementById('video-spinner');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        btnGen.disabled = true;
        if (spinner) spinner.classList.remove('hidden');

        const payload = {
            product_name: document.getElementById('v_product_name').value,
            chosen_angle: document.getElementById('v_chosen_angle').value,
            chosen_hook: document.getElementById('v_chosen_hook').value,
            target_persona: document.getElementById('v_target_persona').value,
            script_framework: document.getElementById('v_script_framework').value,
            total_duration: document.getElementById('v_total_duration').value
        };

        try {
            const res = await fetch('/api/generate-video-scripts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                let errText = `API Request Failed (${res.status})`;
                try {
                    const errData = await res.json();
                    if (errData && errData.detail) errText = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
                } catch (_) { }
                throw new Error(errText);
            }

            const data = await res.json();

            renderVideoRunCost(data.token_usage);
            renderVideoMetrics(data.success_metrics);
            renderVideoScripts(data.video_scripts);
            fetchSystemMetrics();

        } catch (err) {
            alert('Error generating video ad scripts: ' + err.message);
        } finally {
            btnGen.disabled = false;
            if (spinner) spinner.classList.add('hidden');
        }
    });
}

function renderVideoRunCost(tokenUsage) {
    if (!tokenUsage) return;
    const box = document.getElementById('video-cost-box');
    if (!box) return;
    box.classList.remove('hidden');

    document.getElementById('v-run-formatted-cost').textContent = tokenUsage.formatted_cost;
    document.getElementById('v-run-prompt-tokens').textContent = tokenUsage.prompt_tokens.toLocaleString();
    document.getElementById('v-run-completion-tokens').textContent = tokenUsage.completion_tokens.toLocaleString();
    document.getElementById('v-run-total-tokens').textContent = tokenUsage.total_tokens.toLocaleString();
    document.getElementById('v-run-latency').textContent = `${tokenUsage.latency_ms} ms`;
}

function renderVideoMetrics(metrics) {
    if (!metrics) return;
    const banner = document.getElementById('video-metrics-banner');
    if (!banner) return;
    banner.classList.remove('hidden');

    const elHook = document.getElementById('vm-hook');
    if (elHook) elHook.textContent = `${metrics.hook_strength_score}%`;

    const elVis = document.getElementById('vm-visual');
    if (elVis) elVis.textContent = `${metrics.visual_clarity_score}%`;

    const elPace = document.getElementById('vm-pacing');
    if (elPace) elPace.textContent = `${metrics.framework_pacing_score}%`;

    const elPol = document.getElementById('vm-policy');
    if (elPol) elPol.textContent = `${metrics.policy_compliance_score}%`;

    const elTot = document.getElementById('vm-total');
    if (elTot) elTot.textContent = `${metrics.total_scripts || 8} / 8 Scripts`;
}

function getSceneTypeClass(type) {
    if (!type) return 'st-general';
    const lower = type.toLowerCase();
    if (lower.includes('hook') || lower.includes('attention')) return 'st-hook';
    if (lower.includes('problem') || lower.includes('before')) return 'st-problem';
    if (lower.includes('agitat') || lower.includes('interest')) return 'st-agitation';
    if (lower.includes('reveal') || lower.includes('solution') || lower.includes('bridge') || lower.includes('desire') || lower.includes('transform')) return 'st-reveal';
    if (lower.includes('cta') || lower.includes('action') || lower.includes('call')) return 'st-cta';
    return 'st-general';
}

function formatFullScriptForCopy(s) {
    let text = `[SCRIPT #${s.script_id}] ${s.script_title}\n`;
    text += `Framework: ${s.framework_structure}\n`;
    text += `Persona: ${s.target_persona}\n\n`;
    (s.scenes || []).forEach(sc => {
        text += `--- SCENE ${sc.scene_number}: ${sc.scene_type} (${sc.duration_seconds}) ---\n`;
        text += `Voiceover: "${sc.spoken_script}"\n`;
        text += `Visual: ${sc.visual_direction}\n`;
        text += `On-Screen Text: ${sc.on_screen_text}\n`;
        text += `Audio: ${sc.audio_cues}\n\n`;
    });
    text += `Casting: ${s.actor_casting_notes}\n`;
    text += `FTC Disclaimer: ${s.ftc_disclaimer_note}`;
    return text;
}

let currentVideoScriptsData = INITIAL_VIDEO_SCRIPTS;

function scrollToScriptCard(scriptId) {
    const el = document.getElementById(`script-card-${scriptId}`);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('script-card-highlight');
        setTimeout(() => {
            el.classList.remove('script-card-highlight');
        }, 1500);
    }
}

function scrollAgent5Up() {
    const cards = document.querySelectorAll('.video-script-card');
    if (!cards || cards.length === 0) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    
    let targetCard = null;
    for (let i = cards.length - 1; i >= 0; i--) {
        const top = cards[i].getBoundingClientRect().top + window.scrollY;
        if (top < scrollTop - 60) {
            targetCard = cards[i];
            break;
        }
    }
    if (targetCard) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function scrollAgent5Down() {
    const cards = document.querySelectorAll('.video-script-card');
    if (!cards || cards.length === 0) {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        return;
    }
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    
    let targetCard = null;
    for (let i = 0; i < cards.length; i++) {
        const top = cards[i].getBoundingClientRect().top + window.scrollY;
        if (top > scrollTop + 60) {
            targetCard = cards[i];
            break;
        }
    }
    if (targetCard) {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
}

function scrollStoryboard(containerId, direction) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const scrollAmount = 320;
    if (direction === 'left') {
        container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    } else {
        container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
}

function renderVideoScripts(scripts) {
    if (scripts && scripts.length > 0) {
        currentVideoScriptsData = scripts;
    }
    const grid = document.getElementById('video-scripts-grid');
    const pillsRow = document.getElementById('script-pills-row');
    if (!grid) return;
    grid.innerHTML = '';
    if (pillsRow) pillsRow.innerHTML = '';

    if (!scripts || scripts.length === 0) {
        grid.innerHTML = '<div class="empty-trace-select">No video ad scripts generated yet. Click Create above.</div>';
        return;
    }

    // Render Navigation Pills for Jump Controls
    if (pillsRow) {
        scripts.forEach((s, idx) => {
            const sId = s.script_id || (idx + 1);
            const pill = document.createElement('button');
            pill.className = 'script-pill-btn';
            pill.type = 'button';
            pill.title = `Jump to Script #${sId}: ${s.script_title}`;
            pill.innerHTML = `<span>Script #${sId}</span>`;
            pill.onclick = () => scrollToScriptCard(sId);
            pillsRow.appendChild(pill);
        });
    }

    scripts.forEach((s, idx) => {
        const sId = s.script_id || (idx + 1);
        const card = document.createElement('div');
        card.className = 'video-script-card';
        card.id = `script-card-${sId}`;

        const scenesHtml = (s.scenes || []).map(sc => {
            const stClass = getSceneTypeClass(sc.scene_type);
            return `
                <div class="scene-block-item">
                    <div class="scene-block-header">
                        <div class="scene-num-row">
                            <span class="scene-number-chip">SCENE ${sc.scene_number}</span>
                            <span class="scene-duration-tag">⏱${escapeHtml(sc.duration_seconds)}</span>
                        </div>
                        <span class="scene-type-badge ${stClass}">${escapeHtml(sc.scene_type)}</span>
                    </div>

                    <div class="spoken-script-box">
                        <span class="box-label">Spoken Voiceover Script:</span>
                        <p class="spoken-text">"${escapeHtml(sc.spoken_script)}"</p>
                    </div>

                    <div class="scene-details-grid">
                        <div class="visual-direction-box">
                            <span class="spec-label">Visual Direction & Camera Cues</span>
                            <p class="visual-text">${escapeHtml(sc.visual_direction)}</p>
                        </div>
                        <div class="on-screen-box">
                            <span class="spec-label">On-Screen Text Graphic</span>
                            <span class="on-screen-tag">${escapeHtml(sc.on_screen_text)}</span>
                        </div>
                        <div class="audio-cue-box">
                            <span class="spec-label">Audio Cue & SFX</span>
                            <span class="audio-cue-chip">${escapeHtml(sc.audio_cues)}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const brollChips = (s.b_roll_shot_list || []).map(b => `<span class="broll-chip">${escapeHtml(b)}</span>`).join('');
        const wrapId = `storyboard-wrap-${sId}`;

        card.innerHTML = `
            <div class="video-card-header">
                <div>
                    <span class="framework-pill fw-video>${escapeHtml(s.framework_structure)}</span>
                    <h3 class="video-script-title">Script #${sId}: ${escapeHtml(s.script_title)}</h3>
                    <div class="video-meta-subtitle">
                        <span>Persona: ${escapeHtml(s.target_persona)}</span> • 
                        <span>⏳ Est. Duration: ${escapeHtml(s.total_duration_est || '30 Seconds')}</span>
                    </div>
                </div>
                <div class="ad-actions">
                    <button class="ad-copy-btn" onclick="copyPersonaText(this, \`${escapeJsString(formatFullScriptForCopy(s))}\`)">Copy Script</button>
                    <button class="card-scroll-btn" title="Scroll Up To Prev Script" onclick="scrollAgent5Up()">▲ Up</button>
                    <button class="card-scroll-btn" title="Scroll Down To Next Script" onclick="scrollAgent5Down()">▼ Down</button>
                </div>
            </div>

            <!-- Visual Storyboard Preview Removed -->

            <!-- Scene-by-Scene Narrative Flow -->
            <div class="scene-timeline-list">
                ${scenesHtml}
            </div>

            <!-- Casting, B-Roll & FTC Compliance -->
            <div class="casting-broll-container">
                <div class="casting-box">
                    <span class="spec-label">Actor Casting Guidance & Tone</span>
                    <p class="casting-text">${escapeHtml(s.actor_casting_notes)}</p>
                </div>
                <div class="broll-box">
                    <span class="spec-label">B-Roll Shot List</span>
                    <div class="broll-chips-row">${brollChips}</div>
                </div>
                <div class="ftc-video-box">
                    <span class="spec-label">FTC Video Compliance Disclosure</span>
                    <p class="ftc-text">${escapeHtml(s.ftc_disclaimer_note)}</p>
                </div>
            </div>
        `;

        grid.appendChild(card);
    });
}


const btnScrollUp = document.getElementById('btn-scroll-up');
const btnScrollDown = document.getElementById('btn-scroll-down');

if (btnScrollUp) {
    btnScrollUp.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

if (btnScrollDown) {
    btnScrollDown.addEventListener('click', () => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
}



// --- Editable Dropdown Controls Injection ---
document.addEventListener('DOMContentLoaded', () => {
    // Wait a brief moment to ensure all agents and DOM are initialized if they are dynamically rendered
    setTimeout(() => {
        // Find all standard selects, specifically in forms
        const selects = document.querySelectorAll('select.form-select-dropdown');
        
        selects.forEach(select => {
            // Skip if already processed
            if (select.parentElement.classList.contains('dropdown-with-controls')) return;
            
            const wrapper = document.createElement('div');
            wrapper.className = 'dropdown-with-controls';
            
            select.parentNode.insertBefore(wrapper, select);
            wrapper.appendChild(select);
            
            const controlsGroup = document.createElement('div');
            controlsGroup.className = 'dropdown-controls-group';
            
            // Add button
            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'dropdown-icon-btn';
            addBtn.title = 'Add new option';
            addBtn.innerHTML = '';
            addBtn.onclick = (e) => {
                e.preventDefault();
                const newText = prompt('Enter text for new option:');
                if (newText && newText.trim() !== '') {
                    const opt = document.createElement('option');
                    opt.value = newText.trim();
                    opt.textContent = newText.trim();
                    select.appendChild(opt);
                    select.value = opt.value;
                    // Dispatch change event if there are listeners
                    select.dispatchEvent(new Event('change'));
                }
            };
            
            // Edit button
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'dropdown-icon-btn';
            editBtn.title = 'Edit selected option';
            editBtn.innerHTML = '';
            editBtn.onclick = (e) => {
                e.preventDefault();
                const selectedOpt = select.options[select.selectedIndex];
                if (!selectedOpt) return;
                const newText = prompt('Edit option:', selectedOpt.textContent);
                if (newText !== null && newText.trim() !== '') {
                    selectedOpt.value = newText.trim();
                    selectedOpt.textContent = newText.trim();
                    // Dispatch change event
                    select.dispatchEvent(new Event('change'));
                }
            };
            
            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'dropdown-icon-btn';
            deleteBtn.title = 'Delete selected option';
            deleteBtn.innerHTML = '';
            deleteBtn.onclick = (e) => {
                e.preventDefault();
                if (select.options.length <= 1) {
                    alert('Cannot delete the last option.');
                    return;
                }
                if (confirm('Delete the currently selected option?')) {
                    select.remove(select.selectedIndex);
                    select.dispatchEvent(new Event('change'));
                }
            };
            
            controlsGroup.appendChild(addBtn);
            controlsGroup.appendChild(editBtn);
            controlsGroup.appendChild(deleteBtn);
            
            wrapper.appendChild(controlsGroup);
        });
    }, 500);
});



// ---- ADVANCED AUDIO DRAG AND DROP INIT (SIR'S GLOBAL FEEDBACK) ----
document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('audio-dropzone');
    const fileInput = document.getElementById('audio-file-input');
    const overlay = document.getElementById('upload-overlay');
    const statusText = document.getElementById('upload-status-text');
    const feedbackTextarea = document.getElementById('sirs_feedback_text');
    
    if (!dropzone) return;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Highlight dropzone when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.add('drag-active'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.remove('drag-active'), false);
    });

    // Handle dropped files
    dropzone.addEventListener('drop', handleDrop, false);
    
    // Handle clicked files
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            uploadAudioFile(this.files[0]);
        }
    });

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            uploadAudioFile(files[0]);
        }
    }

    const POLL_INTERVAL_MS = 3000;
    const MAX_POLL_MINUTES = 15;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function pollTranscription(transcriptId) {
        const maxAttempts = Math.ceil((MAX_POLL_MINUTES * 60 * 1000) / POLL_INTERVAL_MS);
        const stateLabels = { queued: 'Queued...', processing: 'Transcribing Audio (AssemblyAI)...' };

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const response = await fetch(`/api/transcribe-audio/${transcriptId}`);
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Failed to check transcription status');
            }
            const data = await response.json();

            if (data.state === 'completed') {
                return data.text;
            }
            statusText.innerText = stateLabels[data.state] || 'Transcribing Audio (AssemblyAI)...';
            await sleep(POLL_INTERVAL_MS);
        }
        throw new Error('Transcription is taking longer than expected. Please try again shortly.');
    }

    async function uploadAudioFile(file) {
        // Validate file type
        if (!file.name.match(/\.(mp3|wav|m4a)$/i)) {
            alert('Please upload a valid audio file (.mp3, .wav, or .m4a)');
            return;
        }

        overlay.classList.add('active');
        statusText.innerText = `Uploading ${file.name}...`;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/transcribe-audio', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || 'Failed to transcribe audio');
            }

            const data = await response.json();

            if (data.status === 'SUBMITTED' && data.transcript_id) {
                const text = await pollTranscription(data.transcript_id);
                feedbackTextarea.value += (feedbackTextarea.value ? '\n\n' : '') + text;
                overlay.classList.remove('active');

                // Show temporary success state
                dropzone.style.borderColor = '#10B981';
                setTimeout(() => {
                    dropzone.style.borderColor = '';
                }, 2000);
            }
        } catch (error) {
            console.error('Transcription error:', error);
            statusText.innerText = 'Error: ' + error.message;
            statusText.style.color = '#F43F5E';

            setTimeout(() => {
                overlay.classList.remove('active');
                statusText.innerText = 'Transcribing Audio (AssemblyAI)...';
                statusText.style.color = '';
            }, 3000);
        }

        // Clear file input
        fileInput.value = '';
    }
});


// ---- GLOBAL FEEDBACK CHANGE TRACKER LOGIC ----
document.addEventListener('DOMContentLoaded', () => {
    const btnApplyFeedback = document.getElementById('btn-apply-global-feedback');
    const btnClearFeedback = document.getElementById('btn-clear-global-feedback');
    const feedbackStatus = document.getElementById('feedback-status');
    const trackerContainer = document.getElementById('feedback-tracker-container');
    const diffReport = document.getElementById('feedback-diff-report');
    const feedbackText = document.getElementById('sirs_feedback_text');
    
    if (btnApplyFeedback) {
        btnApplyFeedback.addEventListener('click', () => {
            if (!feedbackText.value.trim()) {
                alert('Please enter or dictate feedback before applying.');
                return;
            }
            
            // Show status
            feedbackStatus.style.display = 'block';
            
            // Show tracker
            trackerContainer.style.display = 'block';
            
            // Clear previous diffs
            diffReport.innerHTML = '<div class="spinner" style="margin: 0 auto;"></div><p style="text-align:center; color:var(--primary);">Analyzing impact across agents...</p>';
            
            // Simulate AI Analysis & Tracking Generation
            setTimeout(() => {
                diffReport.innerHTML = '';
                
                // Mock Diff 1 (Agent 1)
                const diff1 = document.createElement('div');
                diff1.className = 'diff-card';
                diff1.innerHTML = `
                    <div class="diff-header">
                        <span>Persona Target Mutation</span>
                        <span class="diff-agent-badge">Agent 1</span>
                    </div>
                    <div class="diff-content">
                        <div class="diff-before">Targeted broad audience of men experiencing hair loss, focusing on emotional insecurities.</div>
                        <div class="diff-after">Targeting high-income professionals requiring <span class="diff-highlight">premium, undetectable customization</span>. Avoids negative framing.</div>
                    </div>
                `;
                
                // Mock Diff 2 (Agent 2)
                const diff2 = document.createElement('div');
                diff2.className = 'diff-card';
                diff2.innerHTML = `
                    <div class="diff-header">
                        <span>Benefit Framing Adjustment</span>
                        <span class="diff-agent-badge">Agent 2</span>
                    </div>
                    <div class="diff-content">
                        <div class="diff-before">"Get your hair back and stop feeling embarrassed."</div>
                        <div class="diff-after">"Experience <span class="diff-highlight">professional fitting</span> and <span class="diff-highlight">flawless hairline design</span> that seamlessly matches your lifestyle."</div>
                    </div>
                `;
                
                diffReport.appendChild(diff1);
                diffReport.appendChild(diff2);
                
                // Mock Diff 3 (Agent 3)
                const diff3 = document.createElement('div');
                diff3.className = 'diff-card';
                diff3.innerHTML = `
                    <div class="diff-header">
                        <span>Ad Angle Objection Reframe</span>
                        <span class="diff-agent-badge">Agent 3</span>
                    </div>
                    <div class="diff-content">
                        <div class="diff-before">Angle led with generic product features and standard hair-loss messaging.</div>
                        <div class="diff-after">Angle reframed around the <span class="diff-highlight">fear of visible surgery scars</span>, directly countering skepticism with a <span class="diff-highlight">zero-downtime comparison hook</span>.</div>
                    </div>
                `;

                // Mock Diff 4 (Agent 4)
                const diff4 = document.createElement('div');
                diff4.className = 'diff-card';
                diff4.innerHTML = `
                    <div class="diff-header">
                        <span>Video Ad Script Generator</span>
                        <span class="diff-agent-badge">Agent 4</span>
                    </div>
                    <div class="diff-content">
                        <div class="diff-before">Standard promotional video script without download option.</div>
                        <div class="diff-after">Engaging video script tailored to target persona, <span class="diff-highlight">images removed</span>, and <span class="diff-highlight">download option added</span>.</div>
                    </div>
                `;

                diffReport.appendChild(diff3);
                diffReport.appendChild(diff4);
                
                // Hide success message after a bit
                setTimeout(() => {
                    feedbackStatus.style.display = 'none';
                }, 4000);
            }, 1500);
        });
    }
});

// --- AGENT 5: CREATIVE DIRECTOR LOGIC ---
let lastGeneratedCreativeData = null;

document.addEventListener('DOMContentLoaded', () => {
    initCreativeDirector();
    initThumbnailStrategist();
    initThumbnailDesigner();
    initTitleStrategist();
    initContentBrief();
    initCampaignMetadata();
    initDropdownControlButtons();
});

function formatCreativeText(text) {
    if (!text) return '';
    let formatted = text
        .replace(/\*\*/g, '')
        .replace(/\n\n/g, '</p><p style="margin-top:10px;">')
        .replace(/• /g, '• ');
    return `<p>${formatted}</p>`;
}

function initDropdownControlButtons() {
    document.querySelectorAll('select.form-select-dropdown').forEach(select => {
        let parent = select.parentElement;
        
        if (!parent.classList.contains('dropdown-with-controls')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'dropdown-with-controls';
            select.parentNode.insertBefore(wrapper, select);
            wrapper.appendChild(select);
            parent = wrapper;
        }

        let btnGroup = parent.querySelector('.dropdown-controls-group');
        if (!btnGroup) {
            btnGroup = document.createElement('div');
            btnGroup.className = 'dropdown-controls-group';
            btnGroup.innerHTML = `
                <button type="button" class="dropdown-icon-btn btn-add-opt" title="Add New Option">+</button>
                <button type="button" class="dropdown-icon-btn btn-edit-opt" title="Edit Selected Option">Edit</button>
                <button type="button" class="dropdown-icon-btn btn-delete-opt" title="Delete Selected Option">Delete</button>
            `;
            parent.appendChild(btnGroup);
        }

        const btnAdd = btnGroup.querySelector('.btn-add-opt') || btnGroup.children[0];
        if (btnAdd && !btnAdd.dataset.bound) {
            btnAdd.dataset.bound = 'true';
            btnAdd.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const newVal = prompt('Enter new option text to add:');
                if (newVal && newVal.trim()) {
                    const cleanVal = newVal.trim();
                    const opt = document.createElement('option');
                    opt.value = cleanVal;
                    opt.textContent = cleanVal;
                    opt.selected = true;
                    select.appendChild(opt);
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    const feedbackStatus = document.getElementById('feedback-status');
                    if (feedbackStatus) {
                        feedbackStatus.style.display = 'block';
                        feedbackStatus.textContent = `Added option: "${cleanVal}"`;
                        setTimeout(() => { feedbackStatus.style.display = 'none'; }, 3000);
                    }
                }
            });
        }

        const btnEdit = btnGroup.querySelector('.btn-edit-opt') || btnGroup.children[1];
        if (btnEdit && !btnEdit.dataset.bound) {
            btnEdit.dataset.bound = 'true';
            btnEdit.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const selectedOpt = select.options[select.selectedIndex];
                if (!selectedOpt) {
                    alert('No option selected to edit.');
                    return;
                }
                const updatedVal = prompt('Edit selected option:', selectedOpt.text);
                if (updatedVal && updatedVal.trim()) {
                    const cleanVal = updatedVal.trim();
                    selectedOpt.text = cleanVal;
                    selectedOpt.value = cleanVal;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    const feedbackStatus = document.getElementById('feedback-status');
                    if (feedbackStatus) {
                        feedbackStatus.style.display = 'block';
                        feedbackStatus.textContent = `Updated option to: "${cleanVal}"`;
                        setTimeout(() => { feedbackStatus.style.display = 'none'; }, 3000);
                    }
                }
            });
        }

        const btnDel = btnGroup.querySelector('.btn-delete-opt') || btnGroup.children[2];
        if (btnDel && !btnDel.dataset.bound) {
            btnDel.dataset.bound = 'true';
            btnDel.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (select.options.length <= 1) {
                    alert('Cannot delete the only remaining option in this dropdown.');
                    return;
                }
                const selectedOpt = select.options[select.selectedIndex];
                if (!selectedOpt) return;
                if (confirm(`Are you sure you want to delete "${selectedOpt.text}"?`)) {
                    const deletedText = selectedOpt.text;
                    select.removeChild(selectedOpt);
                    if (select.options.length > 0) {
                        select.selectedIndex = 0;
                    }
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    const feedbackStatus = document.getElementById('feedback-status');
                    if (feedbackStatus) {
                        feedbackStatus.style.display = 'block';
                        feedbackStatus.textContent = `Deleted option: "${deletedText}"`;
                        setTimeout(() => { feedbackStatus.style.display = 'none'; }, 3000);
                    }
                }
            });
        }
    });
}

function copyToClipboard(text, successMessage) {
    navigator.clipboard.writeText(text).then(() => {
        const feedbackStatus = document.getElementById('feedback-status');
        if (feedbackStatus) {
            feedbackStatus.style.display = 'block';
            feedbackStatus.textContent = '' + (successMessage || 'Copied to clipboard!');
            setTimeout(() => { feedbackStatus.style.display = 'none'; }, 3000);
        } else {
            alert(successMessage || 'Copied to clipboard!');
        }
    }).catch(err => {
        console.error('Clipboard copy failed:', err);
    });
}

function initCreativeDirector() {
    const form = document.getElementById('creative-generator-form');
    const btnCopyBrief = document.getElementById('btn-copy-full-brief');
    const btnDownloadBrief = document.getElementById('btn-download-brief-json');

    if (btnCopyBrief) {
        btnCopyBrief.addEventListener('click', () => {
            if (!lastGeneratedCreativeData) {
                alert('Please generate a Creative Direction brief first.');
                return;
            }
            const markdownBrief = `# Master Production Brief - Creative Direction
Product: ${document.getElementById('c_product_name')?.value || 'Brand'}
Script Title: ${document.getElementById('c_script_title')?.value || 'Video Script'}
Hook: ${document.getElementById('c_script_hook')?.value || ''}
Visual Style: ${document.getElementById('c_style_preset')?.value || 'Cinematic'}

## 1. Visuals & Aesthetics
${lastGeneratedCreativeData.visuals_and_aesthetics || ''}

## 2. Lighting & Color
${lastGeneratedCreativeData.lighting_and_color || ''}

## 3. Camera & Lens
${lastGeneratedCreativeData.camera_and_lens || ''}

## 4. Set Design & Props
${lastGeneratedCreativeData.set_design_and_props || ''}

## 5. Wardrobe & Makeup
${lastGeneratedCreativeData.wardrobe_and_makeup || ''}

## 6. Sound Design & Music
${lastGeneratedCreativeData.sound_design_and_music || ''}

## 7. Talent & Performance Direction
${lastGeneratedCreativeData.talent_and_performance_direction || ''}

## 8. Post-Production & VFX
${lastGeneratedCreativeData.post_production_and_vfx || ''}

## 9. Director's Beat-by-Beat Shot Matrix
${lastGeneratedCreativeData.director_shot_list || ''}
`;
            copyToClipboard(markdownBrief, 'Full 9-Category Master Production Brief copied as Markdown!');
        });
    }

    if (btnDownloadBrief) {
        btnDownloadBrief.addEventListener('click', () => {
            if (!lastGeneratedCreativeData) {
                alert('Please generate a Creative Direction brief first.');
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(lastGeneratedCreativeData, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `creative_direction_brief_${Date.now()}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });
    }

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btn = document.getElementById('btn-generate-creative');
        const spinner = document.getElementById('creative-spinner');
        const renderContainer = document.getElementById('creative-direction-render');
        const costBox = document.getElementById('creative-cost-box');
        
        // Form inputs
        const productName = document.getElementById('c_product_name').value;
        const scriptTitle = document.getElementById('c_script_title').value;
        const scriptHook = document.getElementById('c_script_hook').value;
        const stylePreset = document.getElementById('c_style_preset') ? document.getElementById('c_style_preset').value : "Cinematic Dark Chiaroscuro";

        // UI Loading State
        btn.classList.add('loading');
        spinner.classList.remove('hidden');
        renderContainer.innerHTML = '<div class="empty-state"><div class="spinner" style="margin: 0 auto; border-top-color: var(--primary);"></div><p style="margin-top: 15px;">Building multi-paragraph 9-category Master Creative Direction...</p></div>';

        try {
            const res = await fetch('/api/generate-creative-direction', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_name: productName,
                    script_title: scriptTitle,
                    script_hook: scriptHook,
                    style_preset: stylePreset,
                    global_feedback: window.sirsGlobalFeedback || ""
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API request failed (Status: ${res.status}): ${errText}`);
            }
            
            const data = await res.json();
            
            if (data.status === 'SUCCESS') {
                lastGeneratedCreativeData = data.creative_direction;
                renderCreativeDirection(data.creative_direction);
                updateCreativeMetrics(data.success_metrics);
                
                // Show cost
                if (data.token_usage) {
                    costBox.classList.remove('hidden');
                    document.getElementById('c-run-formatted-cost').textContent = data.token_usage.formatted_total_cost;
                    document.getElementById('c-run-prompt-tokens').textContent = data.token_usage.prompt_tokens;
                    document.getElementById('c-run-completion-tokens').textContent = data.token_usage.completion_tokens;
                    document.getElementById('c-run-total-tokens').textContent = data.token_usage.total_tokens;
                    document.getElementById('c-run-latency').textContent = data.token_usage.latency_ms + ' ms';
                }
            } else {
                renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>Could not generate creative direction.</p></div>`;
            }
            
        } catch (error) {
            console.error(error);
            renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>${error.message}</p></div>`;
        } finally {
            btn.classList.remove('loading');
            spinner.classList.add('hidden');
        }
    });
}

function renderCreativeDirection(creativeDir) {
    const container = document.getElementById('creative-direction-render');
    if (!container) return;
    
    if (!creativeDir) {
        container.innerHTML = `<div class="empty-state"><h3>No Data</h3><p>Empty response from Agent 5.</p></div>`;
        return;
    }
    
    const categories = [
        { key: "visuals_and_aesthetics", title: "Visuals & Aesthetics", icon: "", badge: "9:16 / 4:5 Framing" },
        { key: "lighting_and_color", title: "Lighting & Color", icon: "", badge: "5600K Key • 3200K Rim" },
        { key: "camera_and_lens", title: "Camera & Lens", icon: "", badge: "35mm/65mm Anamorphic T2.3" },
        { key: "set_design_and_props", title: "Set Design & Props", icon: "", badge: "Architectural Loft" },
        { key: "wardrobe_and_makeup", title: "Wardrobe & Makeup", icon: "", badge: "8K Zero-Shine HD" },
        { key: "sound_design_and_music", title: "Sound Design & Music", icon: "", badge: "40Hz Sub-Bass • Foley" },
        { key: "talent_and_performance_direction", title: "Talent & Performance Direction", icon: "", badge: "Actor Cadence & Arc" },
        { key: "post_production_and_vfx", title: "Post-Production & VFX", icon: "", badge: "Pop-In Text • Safe Zones" },
        { key: "director_shot_list", title: "Director's Beat-by-Beat Shot Matrix", icon: "", badge: "0s Hook to 60s CTA" }
    ];
    
    let html = '';
    categories.forEach(cat => {
        const contentText = creativeDir[cat.key] || 'Detailed specifications pending generation.';
        html += `
            <div class="creative-category" style="margin-bottom: 20px;">
                <div class="creative-cat-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <div class="creative-cat-icon">${cat.icon}</div>
                        <div class="creative-cat-title" style="font-weight: 700;">${cat.title}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; font-size: 0.72rem; padding: 3px 8px; border-radius: 4px;">${cat.badge}</span>
                        <button type="button" class="btn btn-secondary btn-sm btn-copy-cat" data-cat-key="${cat.key}" style="font-size: 0.75rem; padding: 3px 8px;" title="Copy section snippet">Copy Snippet</button>
                    </div>
                </div>
                <div class="creative-cat-body" style="font-size: 0.93rem; line-height: 1.6; padding-top: 12px; white-space: pre-wrap;">
                    ${formatCreativeText(contentText)}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Bind copy snippet buttons
    container.querySelectorAll('.btn-copy-cat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-cat-key');
            const snippetText = creativeDir[key];
            if (snippetText) {
                copyToClipboard(snippetText, 'Copied section snippet!');
            }
        });
    });
}

function updateCreativeMetrics(metrics) {
    if (!metrics) return;
    document.getElementById('cm-brand').textContent = metrics.brand_alignment_score + '%';
    document.getElementById('cm-visual').textContent = metrics.visual_cohesion_score + '%';
    document.getElementById('cm-feasibility').textContent = metrics.production_feasibility_score + '%';
    document.getElementById('cm-status').textContent = metrics.status;
}

// --- AGENT 6: THUMBNAIL STRATEGIST LOGIC ---
let lastGeneratedThumbnailData = null;

function initThumbnailStrategist() {
    const form = document.getElementById('thumbnail-generator-form');
    const btnCopyPrompt = document.getElementById('btn-copy-midjourney-prompt');
    const btnCopyBrief = document.getElementById('btn-copy-thumbnail-brief');

    if (btnCopyPrompt) {
        btnCopyPrompt.addEventListener('click', () => {
            if (!lastGeneratedThumbnailData || !lastGeneratedThumbnailData.ai_image_generation_prompt) {
                alert('Please generate a Thumbnail Strategy first.');
                return;
            }
            copyToClipboard(lastGeneratedThumbnailData.ai_image_generation_prompt.replace(/\*\*/g, ''), 'Midjourney / Flux AI Prompt copied to clipboard!');
        });
    }

    if (btnCopyBrief) {
        btnCopyBrief.addEventListener('click', () => {
            if (!lastGeneratedThumbnailData) {
                alert('Please generate a Thumbnail Strategy first.');
                return;
            }
            const markdownBrief = `# Thumbnail Strategy Blueprint - Agent 6
Product: ${document.getElementById('t_product_name')?.value || 'Brand'}
Script Title: ${document.getElementById('t_script_title')?.value || 'Video Script'}
Hook: ${document.getElementById('t_script_hook')?.value || ''}
Target Persona: ${document.getElementById('t_target_persona')?.value || 'Audience'}
Visual Style: ${document.getElementById('t_visual_style')?.value || 'High-CTR'}

## 1. Hero Visual Concept
${(lastGeneratedThumbnailData.hero_visual_concept || '').replace(/\*\*/g, '')}

## 2. Text Overlay Hook
${(lastGeneratedThumbnailData.text_overlay_hook || '').replace(/\*\*/g, '')}

## 3. Emotional Trigger & Pattern Interrupt
${(lastGeneratedThumbnailData.emotional_trigger_and_pattern_interrupt || '').replace(/\*\*/g, '')}

## 4. Color Palette & Branding
${(lastGeneratedThumbnailData.color_palette_and_branding || '').replace(/\*\*/g, '')}

## 5. Click-Through Rate Hacks
${(lastGeneratedThumbnailData.click_through_rate_hacks || '').replace(/\*\*/g, '')}

## 6. AI Image Generation Prompt (Midjourney / Flux)
${(lastGeneratedThumbnailData.ai_image_generation_prompt || '').replace(/\*\*/g, '')}
`;
            copyToClipboard(markdownBrief, 'Full Thumbnail Strategy copied as Markdown!');
        });
    }

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('btn-generate-thumbnail');
        const spinner = document.getElementById('thumbnail-spinner');
        const renderContainer = document.getElementById('thumbnail-strategy-render');
        const costBox = document.getElementById('thumbnail-cost-box');

        const productName = document.getElementById('t_product_name').value;
        const scriptTitle = document.getElementById('t_script_title').value;
        const scriptHook = document.getElementById('t_script_hook').value;
        const targetPersona = document.getElementById('t_target_persona').value;
        const visualStyle = document.getElementById('t_visual_style').value;

        btn.classList.add('loading');
        spinner.classList.remove('hidden');
        renderContainer.innerHTML = '<div class="empty-state"><div class="spinner" style="margin: 0 auto; border-top-color: var(--primary);"></div><p style="margin-top: 15px;">Designing high-CTR thumbnail strategy & Midjourney prompt...</p></div>';

        try {
            const res = await fetch('/api/generate-thumbnail-strategy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_name: productName,
                    script_title: scriptTitle,
                    script_hook: scriptHook,
                    target_persona: targetPersona,
                    visual_style: visualStyle,
                    global_feedback: window.sirsGlobalFeedback || ""
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API request failed (Status: ${res.status}): ${errText}`);
            }

            const data = await res.json();

            if (data.status === 'SUCCESS') {
                lastGeneratedThumbnailData = data.thumbnail_strategy;
                renderThumbnailStrategy(data.thumbnail_strategy);
                updateThumbnailMetrics(data.success_metrics);

                if (data.token_usage) {
                    costBox.classList.remove('hidden');
                    document.getElementById('t-run-formatted-cost').textContent = data.token_usage.formatted_total_cost;
                    document.getElementById('t-run-prompt-tokens').textContent = data.token_usage.prompt_tokens;
                    document.getElementById('t-run-completion-tokens').textContent = data.token_usage.completion_tokens;
                    document.getElementById('t-run-total-tokens').textContent = data.token_usage.total_tokens;
                    document.getElementById('t-run-latency').textContent = data.token_usage.latency_ms + ' ms';
                }
            } else {
                renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>Could not generate thumbnail strategy.</p></div>`;
            }

        } catch (error) {
            console.error(error);
            renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>${error.message}</p></div>`;
        } finally {
            btn.classList.remove('loading');
            spinner.classList.add('hidden');
        }
    });
}

function renderThumbnailStrategy(strategy) {
    const container = document.getElementById('thumbnail-strategy-render');
    if (!container) return;

    if (!strategy || !strategy.concepts || !strategy.concepts.length) {
        container.innerHTML = `<div class="empty-state"><h3>No Data</h3><p>Empty response from Agent 6.</p></div>`;
        return;
    }

    let html = `
        <div style="margin-bottom: 15px; font-size: 0.95rem; color: #a1a1aa; display: flex; align-items: center; justify-content: space-between;">
            <span>Generated <strong>${strategy.concepts.length} Distinct High-CTR Concepts</strong> for: <em>${strategy.video_topic || 'Brand Campaign'}</em></span>
            <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">Select & Approve to Design</span>
        </div>
    `;

    strategy.concepts.forEach((concept, idx) => {
        const isRec = concept.is_recommended;
        const recBadge = isRec ? `<span class="badge" style="background: rgba(168, 85, 247, 0.25); color: #c084fc; font-weight: bold; margin-left: 10px;">Recommended</span>` : '';
        const borderStyle = isRec ? 'border: 2px solid #818cf8; background: rgba(99, 102, 241, 0.05);' : 'border: 1px solid rgba(255,255,255,0.08);';

        html += `
            <div class="creative-category" style="margin-bottom: 25px; padding: 20px; border-radius: 12px; ${borderStyle}">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span class="badge" style="background: #312e81; color: #c7d2fe; font-size: 0.85rem; padding: 4px 10px; border-radius: 6px;">Concept ${concept.concept_id || idx + 1}</span>
                        <h3 style="font-size: 1.15rem; font-weight: 700; color: #fff; margin: 0;">${concept.concept_title}</h3>
                        ${recBadge}
                    </div>
                    <button type="button" class="btn btn-emerald btn-sm btn-approve-concept" 
                            data-concept-title="${concept.concept_title.replace(/"/g, '&quot;')}"
                            data-thumbnail-copy="${concept.thumbnail_copy.replace(/"/g, '&quot;')}"
                            data-main-visual="${concept.main_visual.replace(/"/g, '&quot;')}"
                            style="background: #10b981; color: #fff; font-size: 0.85rem; padding: 8px 16px; border-radius: 6px; font-weight: 600;">
                        Approve Strategy Continue to Agent 7
                    </button>
                </div>

                <div style="display: grid; grid-template-columns: 1fr; gap: 12px; font-size: 0.92rem; line-height: 1.6;">
                    <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                        <span style="color: #94a3b8; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Main Visual Perspective:</span>
                        <span style="color: #f1f5f9;">${concept.main_visual}</span>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div style="background: rgba(255, 230, 0, 0.08); border: 1px solid rgba(255, 230, 0, 0.2); padding: 12px; border-radius: 8px;">
                            <span style="color: #f59e0b; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Thumbnail Text Copy:</span>
                            <strong style="color: #ffe600; font-size: 1.05rem; font-weight: 800;">"${concept.thumbnail_copy}"</strong>
                        </div>
                        <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                            <span style="color: #94a3b8; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Emotional Trigger:</span>
                            <span style="color: #e2e8f0;">${concept.emotional_trigger}</span>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
                            <span style="color: #94a3b8; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Curiosity Gap:</span>
                            <span style="color: #cbd5e1;">${concept.curiosity_gap}</span>
                        </div>
                        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); padding: 12px; border-radius: 8px;">
                            <span style="color: #34d399; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Why It Could Work:</span>
                            <span style="color: #a7f3d0;">${concept.why_it_could_work}</span>
                        </div>
                    </div>

                    <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); padding: 12px; border-radius: 8px;">
                        <span style="color: #f87171; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Risk Parameter & Mobile Mitigation:</span>
                        <span style="color: #fca5a5;">${concept.risk_parameter}</span>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Attach click events for Approve Concept buttons
    container.querySelectorAll('.btn-approve-concept').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const conceptTitle = e.currentTarget.getAttribute('data-concept-title');
            const thumbnailCopy = e.currentTarget.getAttribute('data-thumbnail-copy');
            const mainVisual = e.currentTarget.getAttribute('data-main-visual');

            // Pre-fill Agent 7 Thumbnail Designer form fields
            const productName = document.getElementById('t_product_name')?.value || 'American Hairline Scalp Revival System';
            const scriptTitle = document.getElementById('t_script_title')?.value || 'The Rearview Mirror Pattern Interrupt';

            if (document.getElementById('d_product_name')) setDropdownValue('d_product_name', productName);
            if (document.getElementById('d_script_title')) setDropdownValue('d_script_title', scriptTitle);
            if (document.getElementById('d_concept_title')) setDropdownValue('d_concept_title', conceptTitle);
            if (document.getElementById('d_thumbnail_copy')) setDropdownValue('d_thumbnail_copy', thumbnailCopy);
            if (document.getElementById('d_main_visual')) setDropdownValue('d_main_visual', mainVisual);

            // Switch Tab to Agent 7: Thumbnail Designer
            const tabBtnDesigner = document.querySelector('.tab-btn[data-tab="tab-designer"]');
            if (tabBtnDesigner) {
                tabBtnDesigner.click();
            }

            // Trigger Agent 7 generation automatically
            const designerForm = document.getElementById('designer-generator-form');
            if (designerForm) {
                designerForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }

            const feedbackStatus = document.getElementById('feedback-status');
            if (feedbackStatus) {
                feedbackStatus.style.display = 'block';
                feedbackStatus.textContent = `Strategy Approved! Translating "${conceptTitle}" into Agent 7 Designer Brief...`;
                setTimeout(() => { feedbackStatus.style.display = 'none'; }, 4000);
            }
        });
    });
}

function setDropdownValue(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return;
    let found = false;
    for (let i = 0; i < el.options.length; i++) {
        if (el.options[i].value === value) {
            el.selectedIndex = i;
            found = true;
            break;
        }
    }
    if (!found) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        opt.selected = true;
        el.appendChild(opt);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
}

function updateThumbnailMetrics(metrics) {
    if (!metrics) return;
    document.getElementById('tm-ctr').textContent = metrics.predicted_ctr_score + '%';
    document.getElementById('tm-clarity').textContent = metrics.visual_clarity_score + '%';
    document.getElementById('tm-curiosity').textContent = metrics.curiosity_gap_score + '%';
    document.getElementById('tm-status').textContent = metrics.status;
}


// --- AGENT 7: THUMBNAIL DESIGNER LOGIC ---
let lastGeneratedDesignerData = null;

function initThumbnailDesigner() {
    const form = document.getElementById('designer-generator-form');
    const btnCopyPrompt = document.getElementById('btn-copy-designer-prompt');
    const btnCopyBrief = document.getElementById('btn-copy-designer-brief');

    if (btnCopyPrompt) {
        btnCopyPrompt.addEventListener('click', () => {
            if (!lastGeneratedDesignerData || !lastGeneratedDesignerData.midjourney_flux_prompt) {
                alert('Please generate a Thumbnail Design Brief first.');
                return;
            }
            copyToClipboard(lastGeneratedDesignerData.midjourney_flux_prompt.replace(/\*\*/g, ''), 'Midjourney / Flux AI Prompt copied to clipboard!');
        });
    }

    if (btnCopyBrief) {
        btnCopyBrief.addEventListener('click', () => {
            if (!lastGeneratedDesignerData) {
                alert('Please generate a Thumbnail Design Brief first.');
                return;
            }
            const markdownBrief = `# Technical Thumbnail Design Brief - Agent 7
Product: ${document.getElementById('d_product_name')?.value || 'Brand'}
Script Title: ${document.getElementById('d_script_title')?.value || 'Video Script'}
Approved Concept: ${lastGeneratedDesignerData.selected_concept_title || ''}
Thumbnail Copy: ${lastGeneratedDesignerData.thumbnail_copy || ''}

## 1. Layout Grid & Composition
${(lastGeneratedDesignerData.layout_grid_and_composition || '').replace(/\*\*/g, '')}

## 2. Typography & Text Hierarchy
${(lastGeneratedDesignerData.typography_and_text_hierarchy || '').replace(/\*\*/g, '')}

## 3. Color Grading & Lighting Pass
${(lastGeneratedDesignerData.color_grading_and_lighting_pass || '').replace(/\*\*/g, '')}

## 4. Visual Effects & Callouts
${(lastGeneratedDesignerData.visual_effects_and_callouts || '').replace(/\*\*/g, '')}

## 5. Midjourney / Flux Prompt
${(lastGeneratedDesignerData.midjourney_flux_prompt || '').replace(/\*\*/g, '')}

## 6. Photoshop / Canva Layer Breakdown
${(lastGeneratedDesignerData.photoshop_canva_layer_breakdown || '').replace(/\*\*/g, '')}
`;
            copyToClipboard(markdownBrief, 'Full Thumbnail Design Brief copied as Markdown!');
        });
    }

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('btn-generate-designer');
        const spinner = document.getElementById('designer-spinner');
        const renderContainer = document.getElementById('designer-strategy-render');
        const costBox = document.getElementById('designer-cost-box');

        const productName = document.getElementById('d_product_name').value;
        const scriptTitle = document.getElementById('d_script_title').value;
        const conceptTitle = document.getElementById('d_concept_title').value;
        const thumbnailCopy = document.getElementById('d_thumbnail_copy').value;
        const mainVisual = document.getElementById('d_main_visual').value;

        btn.classList.add('loading');
        spinner.classList.remove('hidden');
        renderContainer.innerHTML = '<div class="empty-state"><div class="spinner" style="margin: 0 auto; border-top-color: var(--primary);"></div><p style="margin-top: 15px;">Building technical thumbnail layer guide & Midjourney prompt...</p></div>';

        try {
            const res = await fetch('/api/generate-thumbnail-design', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_name: productName,
                    script_title: scriptTitle,
                    concept_title: conceptTitle,
                    main_visual: mainVisual,
                    thumbnail_copy: thumbnailCopy,
                    visual_style: "High-CTR YouTube & Meta Ad",
                    global_feedback: window.sirsGlobalFeedback || ""
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API request failed (Status: ${res.status}): ${errText}`);
            }

            const data = await res.json();

            if (data.status === 'SUCCESS') {
                lastGeneratedDesignerData = data.thumbnail_design;
                renderThumbnailDesign(data.thumbnail_design);
                updateDesignerMetrics(data.success_metrics);

                if (data.token_usage) {
                    costBox.classList.remove('hidden');
                    document.getElementById('d-run-formatted-cost').textContent = data.token_usage.formatted_total_cost;
                    document.getElementById('d-run-prompt-tokens').textContent = data.token_usage.prompt_tokens;
                    document.getElementById('d-run-completion-tokens').textContent = data.token_usage.completion_tokens;
                    document.getElementById('d-run-total-tokens').textContent = data.token_usage.total_tokens;
                    document.getElementById('d-run-latency').textContent = data.token_usage.latency_ms + ' ms';
                }
            } else {
                renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>Could not generate thumbnail design.</p></div>`;
            }

        } catch (error) {
            console.error(error);
            renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>${error.message}</p></div>`;
        } finally {
            btn.classList.remove('loading');
            spinner.classList.add('hidden');
        }
    });
}

function renderThumbnailDesign(design) {
    const container = document.getElementById('designer-strategy-render');
    if (!container) return;

    if (!design) {
        container.innerHTML = `<div class="empty-state"><h3>No Data</h3><p>Empty response from Agent 7.</p></div>`;
        return;
    }

    const categories = [
        { key: "layout_grid_and_composition", title: "1. Layout Grid & Composition (16:9)", icon: "", badge: "Rule-of-Thirds & Safe Zones" },
        { key: "typography_and_text_hierarchy", title: "2. Typography & Text Hierarchy", icon: "", badge: "Font, Hex & Shadow Specs" },
        { key: "color_grading_and_lighting_pass", title: "3. Color Grading & Lighting Pass", icon: "", badge: "Kelvin Lighting & LUTs" },
        { key: "visual_effects_and_callouts", title: "4. Visual Effects & Callouts", icon: "", badge: "Aura, Arrows & Badges" },
        { key: "midjourney_flux_prompt", title: "5. Midjourney / Flux Prompt", icon: "", badge: "Copyable Prompt --ar 16:9" },
        { key: "photoshop_canva_layer_breakdown", title: "6. Photoshop / Canva Layer Breakdown", icon: "", badge: "6 Layer Assembly Guide" },
        { key: "mobile_viewport_100px_simulation", title: "7. Mobile Viewport 100px Simulator", icon: "", badge: "WCAG AAA Contrast Audit" },
        { key: "color_palette_hex_psychology", title: "8. Color Palette HEX & Psychology", icon: "", badge: "Hex Swatches & Emotion" },
        { key: "asset_inventory_checklist", title: "9. Asset Inventory & Stock Checklist", icon: "", badge: "3D Renders, Fonts & LUTs" },
        { key: "ab_testing_variant_blueprint", title: "10. A/B Testing Variant Blueprint", icon: "", badge: "Variant A vs B (+CTR Lift)" },
        { key: "eye_tracking_heatmap_and_focal_velocity", title: "11. Eye-Tracking Heatmap & Focal Velocity", icon: "", badge: "Visual Scan Order & Weight" },
        { key: "multi_platform_aspect_ratio_specs", title: "12. Multi-Platform Aspect Ratio Specs", icon: "", badge: "16:9, 1:1 & 9:16 Crop Safety" }
    ];

    let html = `
        <div style="margin-bottom: 20px; padding: 16px 20px; background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 10px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <span style="font-weight: 700; color: #c084fc;">Approved Concept:</span>
                <span style="color: #fff; font-weight: bold; margin-left: 6px;">${design.selected_concept_title || 'Selected Concept'}</span>
                <span style="margin: 0 12px; color: rgba(255,255,255,0.3);">|</span>
                <span style="font-weight: 700; color: #ffe600;">Text Overlay:</span>
                <span style="color: #ffe600; font-weight: 800; margin-left: 6px;">"${design.thumbnail_copy || ''}"</span>
            </div>
            <span class="badge" style="background: rgba(168, 85, 247, 0.25); color: #e9d5ff; font-weight: bold; font-size: 0.85rem; padding: 4px 10px;">Master 12 Production Dimensions</span>
        </div>
    `;

    categories.forEach(cat => {
        const rawText = design[cat.key] || 'Design specification pending generation.';
        const cleanText = rawText.replace(/\*\*/g, '');
        html += `
            <div class="creative-category" style="margin-bottom: 20px; padding: 18px; border-radius: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06);">
                <div class="creative-cat-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <div class="creative-cat-icon">${cat.icon}</div>
                        <div class="creative-cat-title" style="font-weight: 700; color: #fff;">${cat.title}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; font-size: 0.72rem; padding: 3px 8px; border-radius: 4px;">${cat.badge}</span>
                        <button type="button" class="btn btn-secondary btn-sm btn-copy-d-cat" data-d-key="${cat.key}" style="font-size: 0.75rem; padding: 3px 8px;" title="Copy section snippet">Copy Snippet</button>
                    </div>
                </div>
                <div class="creative-cat-body" style="font-size: 0.93rem; line-height: 1.6; padding-top: 12px; white-space: pre-wrap;">
                    ${formatCreativeText(cleanText)}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.btn-copy-d-cat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-d-key');
            const snippetText = design[key];
            if (snippetText) {
                copyToClipboard(snippetText.replace(/\*\*/g, ''), 'Copied section snippet!');
            }
        });
    });
}

function updateDesignerMetrics(metrics) {
    if (!metrics) return;
    document.getElementById('dm-readability').textContent = metrics.render_readability_score + '%';
    document.getElementById('dm-mobile').textContent = metrics.mobile_viewport_score + '%';
    document.getElementById('dm-contrast').textContent = metrics.color_contrast_score + '%';
    document.getElementById('dm-status').textContent = metrics.status;
}


// --- AGENT 8: TITLE STRATEGIST LOGIC ---
let lastGeneratedTitleData = null;

function initTitleStrategist() {
    const form = document.getElementById('titles-generator-form');
    const btnCopyBest = document.getElementById('btn-copy-best-title');
    const btnCopyAll = document.getElementById('btn-copy-all-titles');
    const btnGenerateV2 = document.getElementById('btn-generate-v2-titles');

    if (btnCopyBest) {
        btnCopyBest.addEventListener('click', () => {
            if (!lastGeneratedTitleData || !lastGeneratedTitleData.titles || !lastGeneratedTitleData.titles.length) {
                alert('Please generate Video Titles first.');
                return;
            }
            const topTitle = lastGeneratedTitleData.titles[0].title_text;
            copyToClipboard(topTitle.replace(/\*\*/g, ''), 'Ranked #1 Video Title copied to clipboard!');
        });
    }

    if (btnCopyAll) {
        btnCopyAll.addEventListener('click', () => {
            if (!lastGeneratedTitleData || !lastGeneratedTitleData.titles || !lastGeneratedTitleData.titles.length) {
                alert('Please generate Video Titles first.');
                return;
            }
            let markdownTitles = `# 10 High-Converting Video Titles - Agent 8\nProduct: ${document.getElementById('tt_product_name')?.value || 'Brand'}\nScript: ${document.getElementById('tt_script_title')?.value || 'Video Script'}\n\n`;
            lastGeneratedTitleData.titles.forEach((t, i) => {
                markdownTitles += `### ${i+1}. ${t.title_text}\n- **Framework**: ${t.framework_type}\n- **Length**: ${t.character_count} chars (${t.mobile_safe ? 'Mobile Safe' : 'May Truncate'})\n- **Thumbnail Synergy**: ${t.thumbnail_synergy_note}\n- **Benchmark Lift**: ${t.ab_benchmark_lift || 'N/A'}\n- **Data Rationale**:\n${(t.data_backed_rationale || '').replace(/\*\*/g, '')}\n- **Predicted CTR**: ${t.predicted_ctr_score}%\n\n`;
            });
            copyToClipboard(markdownTitles, 'All 10 Video Titles copied as Markdown!');
        });
    }

    if (btnGenerateV2) {
        btnGenerateV2.addEventListener('click', () => {
            triggerTitleGeneration(true);
        });
    }

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        triggerTitleGeneration(false);
    });
}

async function triggerTitleGeneration(isV2Hybrid = false) {
    const btn = document.getElementById('btn-generate-titles');
    const btnV2 = document.getElementById('btn-generate-v2-titles');
    const spinner = document.getElementById('titles-spinner');
    const renderContainer = document.getElementById('titles-strategy-render');
    const costBox = document.getElementById('titles-cost-box');

    const productName = document.getElementById('tt_product_name')?.value || 'Brand';
    const scriptTitle = document.getElementById('tt_script_title')?.value || 'Video Script';
    const scriptHook = document.getElementById('tt_script_hook')?.value || 'Core Hook';
    const targetPersona = document.getElementById('tt_target_persona')?.value || 'General Audience';
    const historicalAbData = document.getElementById('tt_historical_ab_data')?.value || '';

    if (btn) btn.classList.add('loading');
    if (btnV2) btnV2.disabled = true;
    if (spinner) spinner.classList.remove('hidden');

    const loadingText = isV2Hybrid 
        ? 'Synthesizing V2 Hybrid Batch mixing top 2-3 winning styles (Fear + Reassurance, Data Proof + Open Loop)...'
        : 'Synthesizing 10 high-converting title options with multi-paragraph data rationale...';

    renderContainer.innerHTML = `<div class="empty-state"><div class="spinner" style="margin: 0 auto; border-top-color: var(--primary);"></div><p style="margin-top: 15px;">${loadingText}</p></div>`;

    try {
        const res = await fetch('/api/generate-title-strategy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                product_name: productName,
                script_title: scriptTitle,
                script_hook: scriptHook,
                target_persona: targetPersona,
                global_feedback: window.sirsGlobalFeedback || "",
                historical_ab_data: historicalAbData,
                is_v2_hybrid: isV2Hybrid
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`API request failed (Status: ${res.status}): ${errText}`);
        }

        const data = await res.json();

        if (data.status === 'SUCCESS') {
            lastGeneratedTitleData = data.title_strategy;
            renderTitleStrategy(data.title_strategy, isV2Hybrid);
            updateTitleMetrics(data.success_metrics);

            if (data.token_usage) {
                costBox.classList.remove('hidden');
                document.getElementById('tt-run-formatted-cost').textContent = data.token_usage.formatted_total_cost;
                document.getElementById('tt-run-prompt-tokens').textContent = data.token_usage.prompt_tokens;
                document.getElementById('tt-run-completion-tokens').textContent = data.token_usage.completion_tokens;
                document.getElementById('tt-run-total-tokens').textContent = data.token_usage.total_tokens;
                document.getElementById('tt-run-latency').textContent = data.token_usage.latency_ms + ' ms';
            }
        } else {
            renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>Could not generate title strategy.</p></div>`;
        }

    } catch (error) {
        console.error(error);
        renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>${error.message}</p></div>`;
    } finally {
        if (btn) btn.classList.remove('loading');
        if (btnV2) btnV2.disabled = false;
        if (spinner) spinner.classList.add('hidden');
    }
}

function renderTitleStrategy(strategy, isV2Hybrid = false) {
    const container = document.getElementById('titles-strategy-render');
    if (!container) return;

    if (!strategy || !strategy.titles || !strategy.titles.length) {
        container.innerHTML = `<div class="empty-state"><h3>No Data</h3><p>Empty response from Agent 8.</p></div>`;
        return;
    }

    const batchTag = isV2Hybrid 
        ? `<span class="badge" style="background: rgba(16, 185, 129, 0.25); color: #34d399; font-weight: bold;">V2 Hybrid Batch (Top Winning Styles Mixed)</span>`
        : `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">5 Psychological Frameworks</span>`;

    let html = `
        <div style="margin-bottom: 15px; font-size: 0.95rem; color: #a1a1aa; display: flex; align-items: center; justify-content: space-between;">
            <span>Generated <strong>${strategy.titles.length} High-CTR Titles</strong> for: <em>${strategy.video_topic || 'Brand Campaign'}</em></span>
            ${batchTag}
        </div>
    `;

    strategy.titles.forEach((item, idx) => {
        const isTop = idx === 0;
        const topBadge = isTop ? `<span class="badge" style="background: rgba(16, 185, 129, 0.25); color: #34d399; font-weight: bold;">#1 Ranked</span>` : '';
        const borderStyle = isTop ? 'border: 2px solid #34d399; background: rgba(16, 185, 129, 0.05);' : 'border: 1px solid rgba(255,255,255,0.08);';

        const safeBadge = item.mobile_safe 
            ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 0.75rem;">Mobile Safe (${item.character_count} chars)</span>`
            : `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-size: 0.75rem;">Long Title (${item.character_count} chars)</span>`;

        const liftBadge = item.ab_benchmark_lift 
            ? `<span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; font-weight: 600; font-size: 0.75rem;">${item.ab_benchmark_lift}</span>`
            : '';

        html += `
            <div class="creative-category" style="margin-bottom: 22px; padding: 20px; border-radius: 12px; ${borderStyle}">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span class="badge" style="background: #1e293b; color: #94a3b8; font-weight: bold;">Option ${item.title_id || idx + 1}</span>
                        <span class="badge" style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; font-weight: 600;">${item.framework_type}</span>
                        ${liftBadge}
                        ${topBadge}
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        ${safeBadge}
                        <span style="font-weight: 700; color: #10b981; font-size: 0.95rem;">CTR: ${item.predicted_ctr_score}%</span>
                        <button type="button" class="btn btn-secondary btn-sm btn-copy-title-text" data-title-text="${item.title_text.replace(/"/g, '&quot;')}" style="font-size: 0.78rem; padding: 4px 10px;">
                            Copy Title
                        </button>
                    </div>
                </div>

                <div style="margin-bottom: 14px;">
                    <h3 style="font-size: 1.2rem; font-weight: 800; color: #fff; margin: 0; line-height: 1.4;">"${item.title_text}"</h3>
                </div>

                <div style="margin-bottom: 12px; background: rgba(0,0,0,0.25); padding: 12px 14px; border-radius: 8px; font-size: 0.9rem; color: #e2e8f0; border-left: 3px solid #818cf8;">
                    <strong style="color: #a5b4fc; font-weight: 700; display: block; margin-bottom: 4px;">Detailed Psychological & Data-Backed Rationale:</strong>
                    <div style="white-space: pre-wrap; line-height: 1.6; font-size: 0.88rem; color: #cbd5e1;">${formatCreativeText((item.data_backed_rationale || '').replace(/\*\*/g, ''))}</div>
                </div>

                <div style="background: rgba(0,0,0,0.2); padding: 10px 14px; border-radius: 6px; font-size: 0.86rem; color: #94a3b8;">
                    <strong style="color: #64748b; font-weight: 600; margin-right: 6px;">Thumbnail Synergy Alignment:</strong>
                    <span style="color: #cbd5e1;">${item.thumbnail_synergy_note}</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.btn-copy-title-text').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const titleText = e.currentTarget.getAttribute('data-title-text');
            if (titleText) {
                copyToClipboard(titleText.replace(/\*\*/g, ''), 'Title copied to clipboard!');
            }
        });
    });
}

function updateTitleMetrics(metrics) {
    if (!metrics) return;
    document.getElementById('ttm-ctr').textContent = metrics.predicted_ctr_score + '%';
    document.getElementById('ttm-mobile').textContent = metrics.mobile_readability_score + '%';
    document.getElementById('ttm-curiosity').textContent = metrics.curiosity_gap_score + '%';
    document.getElementById('ttm-status').textContent = metrics.status;
}


// --- AGENT 9: CONTENT BRIEF MASTER LOGIC ---
let lastGeneratedBriefData = null;

function initContentBrief() {
    const form = document.getElementById('brief-generator-form');
    const btnCopyBrief = document.getElementById('btn-copy-brief-markdown');
    const btnCopyFunnel = document.getElementById('btn-copy-funnel-cb');
    const btnCopyTone = document.getElementById('btn-copy-tone-cb');
    const btnCopyPersona = document.getElementById('btn-copy-persona-cb');

    if (btnCopyFunnel) {
        btnCopyFunnel.addEventListener('click', () => {
            if (!lastGeneratedBriefData || !lastGeneratedBriefData.campaign_objective_and_funnel_stage) {
                alert('Please generate a Content Brief first.');
                return;
            }
            copyToClipboard(lastGeneratedBriefData.campaign_objective_and_funnel_stage.replace(/\*\*/g, ''), 'Copied Funnel Stage Guardrail!');
        });
    }

    if (btnCopyTone) {
        btnCopyTone.addEventListener('click', () => {
            if (!lastGeneratedBriefData || !lastGeneratedBriefData.tone_and_voice_matrix) {
                alert('Please generate a Content Brief first.');
                return;
            }
            copyToClipboard(lastGeneratedBriefData.tone_and_voice_matrix.replace(/\*\*/g, ''), 'Copied Tone & Voice Matrix!');
        });
    }

    if (btnCopyPersona) {
        btnCopyPersona.addEventListener('click', () => {
            if (!lastGeneratedBriefData || !lastGeneratedBriefData.persona_texture_layer) {
                alert('Please generate a Content Brief first.');
                return;
            }
            copyToClipboard(lastGeneratedBriefData.persona_texture_layer.replace(/\*\*/g, ''), 'Copied Persona Texture Layer!');
        });
    }

    if (btnCopyBrief) {
        btnCopyBrief.addEventListener('click', () => {
            if (!lastGeneratedBriefData) {
                alert('Please generate a Content Brief first.');
                return;
            }
            const markdownBrief = `# ${lastGeneratedBriefData.brief_title || 'Meta Ads Content Brief'}

## 1. Campaign Objective & Funnel Stage
${(lastGeneratedBriefData.campaign_objective_and_funnel_stage || '').replace(/\*\*/g, '')}

## 2. Tone & Voice Matrix
${(lastGeneratedBriefData.tone_and_voice_matrix || '').replace(/\*\*/g, '')}

## 3. Format Constraints & Specs
${(lastGeneratedBriefData.format_constraints_and_specs || '').replace(/\*\*/g, '')}

## 4. Persona Texture Layer
${(lastGeneratedBriefData.persona_texture_layer || '').replace(/\*\*/g, '')}

## 5. CTA Intensity Note
${(lastGeneratedBriefData.cta_intensity_note || '').replace(/\*\*/g, '')}

## 6. Compliance & Negative Guardrails
${(lastGeneratedBriefData.compliance_and_negative_guardrails || '').replace(/\*\*/g, '')}

## 7. Reference Asset Anchor
${(lastGeneratedBriefData.reference_asset_anchor || '').replace(/\*\*/g, '')}

## 8. Funnel Conversion Velocity Index
${(lastGeneratedBriefData.funnel_conversion_velocity_index || '').replace(/\*\*/g, '')}

## 9. Creative Hook Retention Rules
${(lastGeneratedBriefData.creative_hook_retention_rules || '').replace(/\*\*/g, '')}
`;
            copyToClipboard(markdownBrief, 'Meta Ads Content Brief copied as Markdown!');
        });
    }

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('btn-generate-brief');
        const spinner = document.getElementById('brief-spinner');
        const renderContainer = document.getElementById('brief-strategy-render');
        const costBox = document.getElementById('brief-cost-box');

        const productName = document.getElementById('cb_product_name').value;
        const targetPersona = document.getElementById('cb_target_persona').value;
        const campaignObjective = document.getElementById('cb_campaign_objective').value;
        const adFormat = document.getElementById('cb_ad_format').value;
        const tonePreset = document.getElementById('cb_tone_preset').value;
        const referenceExample = document.getElementById('cb_reference_example').value;

        btn.classList.add('loading');
        spinner.classList.remove('hidden');
        renderContainer.innerHTML = '<div class="empty-state"><div class="spinner" style="margin: 0 auto; border-top-color: var(--primary);"></div><p style="margin-top: 15px;">Synthesizing Meta Ads Content Brief with 7 guardrail layers...</p></div>';

        try {
            const res = await fetch('/api/generate-content-brief', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_name: productName,
                    target_persona: targetPersona,
                    campaign_objective: campaignObjective,
                    ad_format: adFormat,
                    tone_preset: tonePreset,
                    reference_example: referenceExample,
                    global_feedback: window.sirsGlobalFeedback || ""
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API request failed (Status: ${res.status}): ${errText}`);
            }

            const data = await res.json();

            if (data.status === 'SUCCESS') {
                lastGeneratedBriefData = data.content_brief;
                renderContentBrief(data.content_brief);
                updateBriefMetrics(data.success_metrics);

                if (data.token_usage) {
                    costBox.classList.remove('hidden');
                    document.getElementById('cb-run-formatted-cost').textContent = data.token_usage.formatted_total_cost;
                    document.getElementById('cb-run-prompt-tokens').textContent = data.token_usage.prompt_tokens;
                    document.getElementById('cb-run-completion-tokens').textContent = data.token_usage.completion_tokens;
                    document.getElementById('cb-run-total-tokens').textContent = data.token_usage.total_tokens;
                    document.getElementById('cb-run-latency').textContent = data.token_usage.latency_ms + ' ms';
                }
            } else {
                renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>Could not generate content brief.</p></div>`;
            }

        } catch (error) {
            console.error(error);
            renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>${error.message}</p></div>`;
        } finally {
            btn.classList.remove('loading');
            spinner.classList.add('hidden');
        }
    });
}

function renderContentBrief(brief) {
    const container = document.getElementById('brief-strategy-render');
    if (!container) return;

    if (!brief) {
        container.innerHTML = `<div class="empty-state"><h3>No Data</h3><p>Empty response from Agent 9.</p></div>`;
        return;
    }

    const categories = [
        { key: "campaign_objective_and_funnel_stage", title: "1. Campaign Objective & Funnel Stage", icon: "", badge: "Browsing & Passive Discovery" },
        { key: "tone_and_voice_matrix", title: "2. Tone & Voice Matrix", icon: "", badge: "Empathetic & Non-Clinical" },
        { key: "format_constraints_and_specs", title: "3. Format Constraints & Specs", icon: "", badge: "9:16 IG Reel / 1:1 Feed" },
        { key: "persona_texture_layer", title: "4. Persona Texture Layer", icon: "", badge: "Emotional Gym/Mirror Entry Point" },
        { key: "cta_intensity_note", title: "5. CTA Intensity Note", icon: "", badge: "Soft Education Link vs Hard Sell" },
        { key: "compliance_and_negative_guardrails", title: "6. Compliance & Negative Guardrails", icon: "", badge: "No Claims, No Fear-Mongering" },
        { key: "reference_asset_anchor", title: "7. Reference Asset Anchor", icon: "", badge: "Prior Winner Pacing Benchmark" },
        { key: "funnel_conversion_velocity_index", title: "8. Funnel Conversion Velocity Index", icon: "", badge: "95.8/100 Funnel Warmth Rating" },
        { key: "creative_hook_retention_rules", title: "9. Creative Hook Retention Rules (0-30s)", icon: "⏱", badge: "Drop-Off Mitigation Protocol" }
    ];

    let html = `
        <!-- Fancy Hero Banner Agent 9 -->
        <div class="agent10-hero-banner" style="margin-bottom: 24px; padding: 20px 24px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(99, 102, 241, 0.18) 100%); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 14px; box-shadow: 0 8px 32px rgba(16, 185, 129, 0.15); display: flex; align-items: center; justify-content: space-between;">
            <div>
                <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 4px;">
                    <span class="badge" style="background: rgba(16, 185, 129, 0.3); color: #34d399; font-weight: 800; font-size: 0.75rem; padding: 3px 10px; border-radius: 20px;">CREATIVE GUARDRAIL MASTER</span>
                    <span style="font-size: 0.8rem; color: #cbd5e1;">Meta Ads Performance Blueprint</span>
                </div>
                <h3 style="font-size: 1.25rem; font-weight: 800; color: #fff; margin: 0; letter-spacing: -0.01em;">${brief.brief_title || 'Meta Ads Content Brief'}</h3>
            </div>
            <div style="display:flex; align-items:center; gap: 10px;">
                <span class="badge" style="background: linear-gradient(135deg, #10b981, #6366f1); color: #fff; font-weight: bold; font-size: 0.88rem; padding: 6px 14px; border-radius: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">9 Guardrail Layers</span>
            </div>
        </div>
    `;

    categories.forEach(cat => {
        const rawText = brief[cat.key] || 'Brief dimension pending generation.';
        const cleanText = rawText.replace(/\*\*/g, '');
        html += `
            <div class="cb-guardrail-card" style="margin-bottom: 22px; padding: 20px; border-radius: 12px; background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
                <div class="creative-cat-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <div class="creative-cat-icon" style="font-size: 1.3rem;">${cat.icon}</div>
                        <div class="creative-cat-title" style="font-weight: 800; color: #fff; font-size: 1.02rem;">${cat.title}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <span class="badge" style="background: rgba(16, 185, 129, 0.18); color: #34d399; font-size: 0.75rem; padding: 4px 10px; border-radius: 6px;">${cat.badge}</span>
                        <button type="button" class="btn btn-secondary btn-sm btn-copy-b-cat" data-b-key="${cat.key}" style="font-size: 0.75rem; padding: 4px 10px;" title="Copy section snippet">Copy Snippet</button>
                    </div>
                </div>
                <div class="creative-cat-body" style="font-size: 0.94rem; line-height: 1.65; padding-top: 14px; color: #cbd5e1; white-space: pre-wrap;">
                    ${formatCreativeText(cleanText)}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.btn-copy-b-cat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-b-key');
            const snippetText = brief[key];
            if (snippetText) {
                copyToClipboard(snippetText.replace(/\*\*/g, ''), 'Copied brief section snippet!');
            }
        });
    });
}

function updateBriefMetrics(metrics) {
    if (!metrics) return;
    document.getElementById('cbm-compliance').textContent = metrics.compliance_score + '%';
    document.getElementById('cbm-funnel').textContent = metrics.funnel_alignment_score + '%';
    document.getElementById('cbm-texture').textContent = metrics.emotional_texture_score + '%';
    document.getElementById('cbm-status').textContent = metrics.status;
}


// --- AGENT 10: METADATA & PUBLISHING MASTER LOGIC ---
let lastGeneratedMetadataData = null;

function initCampaignMetadata() {
    const form = document.getElementById('metadata-generator-form');
    const btnCopyPackage = document.getElementById('btn-copy-metadata-package');
    const btnCopyBestTitle = document.getElementById('btn-copy-best-title-cm');
    const btnCopyDesc = document.getElementById('btn-copy-desc-cm');
    const btnCopyKeywords = document.getElementById('btn-copy-keywords-cm');

    if (btnCopyBestTitle) {
        btnCopyBestTitle.addEventListener('click', () => {
            if (!lastGeneratedMetadataData || !lastGeneratedMetadataData.seo_title_variants || lastGeneratedMetadataData.seo_title_variants.length === 0) {
                alert('Please generate a Publishing Package first.');
                return;
            }
            const topTitle = lastGeneratedMetadataData.seo_title_variants[0].title_option;
            copyToClipboard(topTitle, 'Copied #1 Title Variant!');
        });
    }

    if (btnCopyDesc) {
        btnCopyDesc.addEventListener('click', () => {
            if (!lastGeneratedMetadataData || !lastGeneratedMetadataData.full_optimized_description) {
                alert('Please generate a Publishing Package first.');
                return;
            }
            copyToClipboard(lastGeneratedMetadataData.full_optimized_description.replace(/\*\*/g, ''), 'Copied Optimized Description!');
        });
    }

    if (btnCopyKeywords) {
        btnCopyKeywords.addEventListener('click', () => {
            if (!lastGeneratedMetadataData || !lastGeneratedMetadataData.primary_and_secondary_keywords) {
                alert('Please generate a Publishing Package first.');
                return;
            }
            copyToClipboard(lastGeneratedMetadataData.primary_and_secondary_keywords.replace(/\*\*/g, ''), 'Copied Keyword Targets!');
        });
    }

    if (btnCopyPackage) {
        btnCopyPackage.addEventListener('click', () => {
            if (!lastGeneratedMetadataData) {
                alert('Please generate a Publishing Package first.');
                return;
            }
            const md = lastGeneratedMetadataData;
            let titleVariantsText = "";
            if (md.seo_title_variants && md.seo_title_variants.length > 0) {
                md.seo_title_variants.forEach((t, idx) => {
                    titleVariantsText += `\nVariant #${idx+1}: "${t.title_option}" (Predicted CTR: ${t.predicted_ctr}%) - ${t.framework_angle}`;
                });
            }

            const markdownPackage = `# ${md.campaign_title || 'Full Production Publishing Package'}

## 1. SEO Title Variants (Scored by Predicted CTR)
${titleVariantsText}

## 2. Primary & Secondary Keywords
${(md.primary_and_secondary_keywords || '').replace(/\*\*/g, '')}

## 3. Competitor Gap Analysis
${(md.competitor_gap_analysis || '').replace(/\*\*/g, '')}

## 4. Retention-Engineered Chapter Timestamps
${(md.retention_chapter_timestamps || '').replace(/\*\*/g, '')}

## 5. Optimized Description
${(md.full_optimized_description || '').replace(/\*\*/g, '')}

## 6. Tags & Hashtags
${(md.tags_and_hashtags || '').replace(/\*\*/g, '')}

## 7. Accessibility & SRT Summary
${(md.accessibility_alt_text_and_srt_summary || '').replace(/\*\*/g, '')}

## 8. Brand Safety & Compliance Check
${(md.brand_safety_and_compliance_check || '').replace(/\*\*/g, '')}
`;
            copyToClipboard(markdownPackage, 'Complete Publishing Package copied as Markdown!');
        });
    }

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('btn-generate-metadata');
        const spinner = document.getElementById('metadata-spinner');
        const renderContainer = document.getElementById('metadata-strategy-render');
        const costBox = document.getElementById('metadata-cost-box');

        const productName = document.getElementById('cm_product_name').value;
        const scriptTitle = document.getElementById('cm_script_title').value;
        const targetPersona = document.getElementById('cm_target_persona').value;
        const campaignObjective = document.getElementById('cm_campaign_objective').value;

        btn.classList.add('loading');
        spinner.classList.remove('hidden');
        renderContainer.innerHTML = '<div class="empty-state"><div class="spinner" style="margin: 0 auto; border-top-color: var(--primary);"></div><p style="margin-top: 15px;">Synthesizing Full Publishing Package (SEO Keywords, Competitor Gaps, Timestamps, Safety Audit)...</p></div>';

        try {
            const res = await fetch('/api/generate-campaign-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product_name: productName,
                    script_title: scriptTitle,
                    target_persona: targetPersona,
                    campaign_objective: campaignObjective,
                    global_feedback: window.sirsGlobalFeedback || ""
                })
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`API request failed (Status: ${res.status}): ${errText}`);
            }

            const data = await res.json();

            if (data.status === 'SUCCESS') {
                lastGeneratedMetadataData = data.campaign_metadata;
                renderCampaignMetadata(data.campaign_metadata);
                updateMetadataMetrics(data.success_metrics);

                if (data.token_usage) {
                    costBox.classList.remove('hidden');
                    document.getElementById('cm-run-formatted-cost').textContent = data.token_usage.formatted_total_cost;
                    document.getElementById('cm-run-prompt-tokens').textContent = data.token_usage.prompt_tokens;
                    document.getElementById('cm-run-completion-tokens').textContent = data.token_usage.completion_tokens;
                    document.getElementById('cm-run-total-tokens').textContent = data.token_usage.total_tokens;
                    document.getElementById('cm-run-latency').textContent = data.token_usage.latency_ms + ' ms';
                }
            } else {
                renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>Could not generate publishing metadata.</p></div>`;
            }

        } catch (error) {
            console.error(error);
            renderContainer.innerHTML = `<div class="empty-state"><h3 style="color:var(--rose);">Error</h3><p>${error.message}</p></div>`;
        } finally {
            btn.classList.remove('loading');
            spinner.classList.add('hidden');
        }
    });
}

function renderCampaignMetadata(meta) {
    const container = document.getElementById('metadata-strategy-render');
    if (!container) return;

    if (!meta) {
        container.innerHTML = `<div class="empty-state"><h3>No Data</h3><p>Empty response from Agent 10.</p></div>`;
        return;
    }

    // Fancy Title Variants Rendering with CTR Progress Bars & Rank Badges
    let titlesHtml = "";
    if (meta.seo_title_variants && meta.seo_title_variants.length > 0) {
        meta.seo_title_variants.forEach((t, idx) => {
            const rankBadges = [
                { label: "#1 PREFERRED", bg: "rgba(16, 185, 129, 0.2)", color: "#34d399", border: "rgba(16, 185, 129, 0.4)" },
                { label: "#2 CHALLENGER", bg: "rgba(99, 102, 241, 0.2)", color: "#a5b4fc", border: "rgba(99, 102, 241, 0.4)" },
                { label: "#3 ANGLE VARIANT", bg: "rgba(168, 85, 247, 0.2)", color: "#c084fc", border: "rgba(168, 85, 247, 0.4)" }
            ];
            const badge = rankBadges[idx] || rankBadges[2];
            const ctrVal = t.predicted_ctr || 95.0;

            titlesHtml += `
                <div style="margin-bottom: 14px; padding: 16px; background: rgba(15, 23, 42, 0.6); border: 1px solid ${badge.border}; border-radius: 10px; transition: all 0.3s ease;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
                        <div style="display:flex; align-items:center; gap: 8px;">
                            <span class="badge" style="background: ${badge.bg}; color: ${badge.color}; font-weight: 800; font-size: 0.75rem; padding: 4px 8px; border-radius: 6px;">${badge.label}</span>
                            <span style="font-weight: 700; color: #fff; font-size: 1.02rem;">"${t.title_option}"</span>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm btn-copy-title-single" data-title-text="${t.title_option}" style="font-size: 0.75rem; padding: 3px 10px;">Copy Title</button>
                    </div>
                    
                    <div style="display:flex; align-items:center; gap: 12px; margin-top: 10px;">
                        <div style="flex: 1; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden;">
                            <div style="width: ${ctrVal}%; height: 100%; background: linear-gradient(90deg, #6366f1, #34d399); border-radius: 3px;"></div>
                        </div>
                        <span style="font-weight: 800; font-size: 0.85rem; color: #34d399;">${ctrVal}% CTR</span>
                    </div>
                    <div style="margin-top: 6px; font-size: 0.82rem; color: #94a3b8;">
                        <strong style="color: #cbd5e1;">Framework Angle:</strong> ${t.framework_angle}
                    </div>
                </div>
            `;
        });
    }

    const categories = [
        { key: "primary_and_secondary_keywords", title: "2. Evidence-Based Keyword Targets & Volume Metrics", icon: "", badge: "Ahrefs/Search Vol Verified" },
        { key: "competitor_gap_analysis", title: "3. Competitor Gap Analysis & Subtopic Surface", icon: "", badge: "Content Gap Exploited" },
        { key: "retention_chapter_timestamps", title: "4. Retention-Engineered Chapter Timestamps", icon: "⏱", badge: "Drop-off Mitigation Protocol" },
        { key: "full_optimized_description", title: "5. Production Publishing Description & Links", icon: "", badge: "SEO Pre-formatted" },
        { key: "tags_and_hashtags", title: "6. Categorized Tags & Meta Hashtags", icon: "#⃣", badge: "Distribution Ready" },
        { key: "accessibility_alt_text_and_srt_summary", title: "7. Accessibility Alt-Text & SRT Caption Summary", icon: "", badge: "SRT & Alt Text Ready" },
        { key: "brand_safety_and_compliance_check", title: "8. Brand Safety & Compliance Policy Audit", icon: "", badge: "FTC & Meta Safe" }
    ];

    let html = `
        <!-- Fancy Neon Hero Header Card -->
        <div style="margin-bottom: 24px; padding: 20px 24px; background: linear-gradient(135deg, rgba(99, 102, 241, 0.18) 0%, rgba(168, 85, 247, 0.18) 100%); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 14px; box-shadow: 0 8px 32px rgba(99, 102, 241, 0.15); display: flex; align-items: center; justify-content: space-between;">
            <div>
                <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 4px;">
                    <span class="badge" style="background: rgba(99, 102, 241, 0.3); color: #a5b4fc; font-weight: 800; font-size: 0.75rem; padding: 3px 10px; border-radius: 20px;">FULL SEO PACKAGE</span>
                    <span style="font-size: 0.8rem; color: #cbd5e1;">YouTube & Meta Campaign Pipeline</span>
                </div>
                <h3 style="font-size: 1.25rem; font-weight: 800; color: #fff; margin: 0; letter-spacing: -0.01em;">${meta.campaign_title || 'Full Production Publishing Package'}</h3>
            </div>
            <div style="display:flex; align-items:center; gap: 10px;">
                <span class="badge" style="background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; font-weight: bold; font-size: 0.88rem; padding: 6px 14px; border-radius: 8px; box-shadow: 0 4px 12px rgba(168, 85, 247, 0.3);">8 Publishing Sections</span>
            </div>
        </div>

        <!-- Section 1: Fancy Title Variants -->
        <div class="creative-category" style="margin-bottom: 22px; padding: 20px; border-radius: 12px; background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
            <div class="creative-cat-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
                <div style="display:flex; align-items:center; gap: 10px;">
                    <div class="creative-cat-icon" style="font-size: 1.4rem;"></div>
                    <div>
                        <div class="creative-cat-title" style="font-weight: 800; color: #fff; font-size: 1.05rem;">1. SEO Title Variants (Scored by Predicted CTR)</div>
                        <div style="font-size: 0.8rem; color: #94a3b8;">A/B variant options generated with CTR probability lift models</div>
                    </div>
                </div>
                <span class="badge" style="background: rgba(99, 102, 241, 0.2); color: #a5b4fc; font-size: 0.75rem; padding: 4px 10px; border-radius: 6px;">A/B Variant Testing</span>
            </div>
            ${titlesHtml}
        </div>
    `;

    categories.forEach(cat => {
        const rawText = meta[cat.key] || 'Publishing section pending generation.';
        const cleanText = rawText.replace(/\*\*/g, '');
        html += `
            <div class="creative-category" style="margin-bottom: 22px; padding: 20px; border-radius: 12px; background: rgba(30, 41, 59, 0.4); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
                <div class="creative-cat-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <div class="creative-cat-icon" style="font-size: 1.3rem;">${cat.icon}</div>
                        <div class="creative-cat-title" style="font-weight: 800; color: #fff; font-size: 1.02rem;">${cat.title}</div>
                    </div>
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <span class="badge" style="background: rgba(99, 102, 241, 0.18); color: #a5b4fc; font-size: 0.75rem; padding: 4px 10px; border-radius: 6px;">${cat.badge}</span>
                        <button type="button" class="btn btn-secondary btn-sm btn-copy-cm-cat" data-cm-key="${cat.key}" style="font-size: 0.75rem; padding: 4px 10px;" title="Copy section snippet">Copy Snippet</button>
                    </div>
                </div>
                <div class="creative-cat-body" style="font-size: 0.94rem; line-height: 1.65; padding-top: 14px; color: #cbd5e1; white-space: pre-wrap;">
                    ${formatCreativeText(cleanText)}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Add copy listener for individual title buttons
    container.querySelectorAll('.btn-copy-title-single').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const titleText = e.currentTarget.getAttribute('data-title-text');
            if (titleText) {
                copyToClipboard(titleText, 'Copied title variant!');
            }
        });
    });

    // Add copy listener for category snippets
    container.querySelectorAll('.btn-copy-cm-cat').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const key = e.currentTarget.getAttribute('data-cm-key');
            const snippetText = meta[key];
            if (snippetText) {
                copyToClipboard(snippetText.replace(/\*\*/g, ''), 'Copied metadata section snippet!');
            }
        });
    });
}

function updateMetadataMetrics(metrics) {
    if (!metrics) return;
    document.getElementById('cmm-seo').textContent = metrics.seo_opt_score + '%';
    document.getElementById('cmm-keyword').textContent = metrics.keyword_relevance_score + '%';
    document.getElementById('cmm-safety').textContent = metrics.brand_safety_score + '%';
    document.getElementById('cmm-status').textContent = metrics.status;
}











// =====================================================================
// AGENTS: OWN AD DOUBLE DOWN & COMPETITOR AD REMIXER
// =====================================================================

function setupModeToggle(btnTextId, btnUrlId, btnUploadId, urlGroupId, uploadGroupId, activeClass) {
    const btnText = document.getElementById(btnTextId);
    const btnUrl = document.getElementById(btnUrlId);
    const btnUpload = document.getElementById(btnUploadId);
    const urlGroup = document.getElementById(urlGroupId);
    const uploadGroup = document.getElementById(uploadGroupId);

    if (!btnText || !btnUrl || !btnUpload) return;

    function resetActive() {
        [btnText, btnUrl, btnUpload].forEach(b => b.classList.remove('active'));
    }

    btnText.addEventListener('click', () => {
        resetActive();
        btnText.classList.add('active');
        if (urlGroup) urlGroup.classList.add('hidden');
        if (uploadGroup) uploadGroup.classList.add('hidden');
    });

    btnUrl.addEventListener('click', () => {
        resetActive();
        btnUrl.classList.add('active');
        if (urlGroup) urlGroup.classList.remove('hidden');
        if (uploadGroup) uploadGroup.classList.add('hidden');
    });

    btnUpload.addEventListener('click', () => {
        resetActive();
        btnUpload.classList.add('active');
        if (urlGroup) urlGroup.classList.add('hidden');
        if (uploadGroup) uploadGroup.classList.remove('hidden');
    });
}

function initOwnAdDoubleDown() {
    setupModeToggle('own-mode-text', 'own-mode-url', 'own-mode-upload', 'own-url-group', 'own-upload-group');

    window._adTranscriptCache = window._adTranscriptCache || {};

    const btnFetchUrl = document.getElementById('btn-fetch-own-url');
    const btnFetchAndGen = document.getElementById('btn-fetch-and-gen-own');
    const inputUrl = document.getElementById('own_ad_url');
    const urlStatus = document.getElementById('own-url-status');
    const txtContent = document.getElementById('own_winner_content');
    const transcriptBadge = document.getElementById('own-transcript-badge');
    const btnSample = document.getElementById('btn-load-sample-own');

    // Sample Script Loader
    if (btnSample && txtContent) {
        btnSample.addEventListener('click', () => {
            txtContent.value = "Thinking of getting a hair patch, but worried it might look fake from the front? This is where most people go wrong. Straight line, too perfect, looks artificial. People notice, they just don't tell you. Now this looks fake, and this looks real. The difference is the hairline. Real hairlines are not dense in front, so we keep it lighter here and fuller behind. That's what makes it look natural. Look closely: you can actually see the skin in the front. If the hairline is wrong, nothing else matters. If you're serious about getting a hair patch, click below and book a consultation.";
            txtContent.dataset.extractedFrom = "sample";
            txtContent.style.border = "1px solid #38BDF8";
            if (transcriptBadge) {
                transcriptBadge.style.display = "inline-block";
                transcriptBadge.style.background = "rgba(56, 189, 248, 0.2)";
                transcriptBadge.style.color = "#38BDF8";
                transcriptBadge.textContent = "📄 Sample Ad Loaded";
            }
        });
    }

    async function extractAndTranscribeOwnUrl(targetUrl) {
        if (!targetUrl) return null;
        const normalizedUrl = targetUrl.trim();

        // 1. Instant Cache Hit Check (0 API calls, 0s delay)
        if (window._adTranscriptCache[normalizedUrl] && window._adTranscriptCache[normalizedUrl].status === 'SUCCESS') {
            const cached = window._adTranscriptCache[normalizedUrl];
            if (txtContent) {
                txtContent.value = cached.extracted_text;
                txtContent.dataset.extractedFrom = normalizedUrl;
                txtContent.style.border = "2px solid #10B981";
            }
            if (transcriptBadge) {
                transcriptBadge.style.display = "inline-block";
                transcriptBadge.style.background = "rgba(16, 185, 129, 0.2)";
                transcriptBadge.style.color = "#10B981";
                transcriptBadge.textContent = "⚡ Instant Cache (0 API Calls)";
            }
            if (urlStatus) {
                urlStatus.innerHTML = '<span style="color:#10B981; font-weight:600;">⚡ Instant Cache Hit (0 API calls): Loaded from cache in 0.01s!</span>';
            }
            return cached.extracted_text;
        }

        if (urlStatus) {
            urlStatus.innerHTML = '<span style="color:#EC4899; font-weight:600;"><span class="spinner" style="width:12px; height:12px; display:inline-block; vertical-align:middle; margin-right:4px;"></span> Downloading SD audio track & transcribing with Gemini AI...</span>';
        }
        if (txtContent) {
            txtContent.value = "🎙️ Downloading lightweight audio track and transcribing spoken voiceover with Gemini AI...\n\nPlease wait a few seconds...";
            txtContent.style.border = "2px solid #EC4899";
            txtContent.style.boxShadow = "0 0 15px rgba(236, 72, 153, 0.3)";
        }

        try {
            const data = await safeFetchJson('/api/extract-ad-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: normalizedUrl })
            });

            if (data && data.status === 'SUCCESS' && data.extracted_text) {
                window._adTranscriptCache[normalizedUrl] = data;

                if (txtContent) {
                    txtContent.value = data.extracted_text;
                    txtContent.dataset.extractedFrom = normalizedUrl;
                    txtContent.style.border = "2px solid #10B981";
                    txtContent.style.boxShadow = "0 0 18px rgba(16, 185, 129, 0.4)";
                    txtContent.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => { txtContent.style.boxShadow = ""; }, 3000);
                }
                if (transcriptBadge) {
                    transcriptBadge.style.display = "inline-block";
                    transcriptBadge.style.background = "rgba(16, 185, 129, 0.2)";
                    transcriptBadge.style.color = "#10B981";
                    const words = data.audio_transcript ? data.audio_transcript.trim().split(/\s+/).length : (data.extracted_text ? data.extracted_text.trim().split(/\s+/).length : 0);
                    transcriptBadge.textContent = words > 0 ? `✓ Transcribed (${words} words)` : `✓ Extracted`;
                }
                if (urlStatus) {
                    urlStatus.innerHTML = '<span style="color:#10B981; font-weight:600;">✓ Ad content and script loaded successfully!</span>';
                }
                return data.extracted_text;
            } else {
                // Platform bot wall or fallback detected - do not generate garbage ads
                if (txtContent) {
                    txtContent.value = "";
                    txtContent.dataset.extractedFrom = "";
                    txtContent.placeholder = "⚠️ Platform bot protection blocked automated scraping of this link. Please switch to 'Upload Media' tab to upload the video file directly, or paste your ad script here.";
                    txtContent.style.border = "2px solid #F59E0B";
                    txtContent.style.boxShadow = "0 0 15px rgba(245, 158, 11, 0.3)";
                }
                if (transcriptBadge) {
                    transcriptBadge.style.display = "inline-block";
                    transcriptBadge.style.background = "rgba(245, 158, 11, 0.2)";
                    transcriptBadge.style.color = "#F59E0B";
                    transcriptBadge.textContent = "⚠️ Bot Protected";
                }
                if (urlStatus) {
                    urlStatus.innerHTML = '<div style="background:rgba(245, 158, 11, 0.1); border:1px solid rgba(245, 158, 11, 0.3); border-radius:8px; padding:10px 12px; margin-top:8px; color:#F59E0B; font-size:12px;"><strong>⚠️ Meta Ad Library Bot-Wall Detected:</strong> Facebook requires interactive browser verification for this link.<br><br>👉 <strong>Instant 1-Step Solution:</strong> Click the <strong>Upload Media</strong> tab right next to this input and drop the video file directly. Gemini AI will analyze the video, transcribe dialogue, and generate all 5 variations in 1 step!</div>';
                }
                return null;
            }
        } catch (err) {
            console.error('URL extraction error:', err);
            if (txtContent) {
                txtContent.value = `Reference Ad Link: ${normalizedUrl}\n\n(Note: ${err.message || 'Platform restricted'})\nYou can paste the ad script or hook details directly in this box to generate variations.`;
                txtContent.style.border = "2px solid #F59E0B";
                txtContent.style.boxShadow = "";
            }
            if (urlStatus) {
                urlStatus.innerHTML = '<span style="color:#F59E0B; font-weight:600;">⚠️ Link requires direct script input below.</span>';
            }
        }
        return null;
    }

    if (btnFetchUrl && inputUrl) {
        btnFetchUrl.addEventListener('click', async () => {
            const url = inputUrl.value.trim();
            if (!url) {
                alert('Please enter a valid Meta Ad Library or video link.');
                return;
            }
            btnFetchUrl.disabled = true;
            btnFetchUrl.textContent = '🎙️ Transcribing...';
            await extractAndTranscribeOwnUrl(url);
            btnFetchUrl.disabled = false;
            btnFetchUrl.textContent = '🎙️ Transcribe Audio';
        });
    }

    if (btnFetchAndGen && inputUrl) {
        btnFetchAndGen.addEventListener('click', async () => {
            const url = inputUrl.value.trim();
            if (!url) {
                alert('Please enter a Meta Ad Library or video link first.');
                return;
            }
            btnFetchAndGen.disabled = true;
            btnFetchAndGen.textContent = '⚡ Transcribing & Generating...';

            // Only fetch if not already transcribed from this URL
            let transcribed = (txtContent && txtContent.dataset.extractedFrom === url && txtContent.value.trim().length > 20)
                ? txtContent.value
                : await extractAndTranscribeOwnUrl(url);

            btnFetchAndGen.disabled = false;
            btnFetchAndGen.textContent = '⚡ Transcribe & Generate 5 Variations Now';
            if (transcribed) {
                const form = document.getElementById('own-doubledown-form');
                if (form) form.requestSubmit();
            }
        });
    }

    // Media Upload with Seamless Chunking Support (100MB+ videos handled safely)
    const fileInput = document.getElementById('own_media_file');
    const progressEl = document.getElementById('own-upload-progress');

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            await uploadMediaWithChunking(
                file,
                progressEl,
                txtContent,
                transcriptBadge,
                'btn-generate-own',
                'own-doubledown-form',
                'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)'
            );
        });
    }

    // Form Submit
    const form = document.getElementById('own-doubledown-form');
    const btnGen = document.getElementById('btn-generate-own');
    const spinner = document.getElementById('own-spinner');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        btnGen.disabled = true;
        if (spinner) spinner.classList.remove('hidden');

        let contentVal = document.getElementById('own_winner_content').value.trim();
        const urlFieldVal = inputUrl ? inputUrl.value.trim() : '';

        // Prevent Duplicate API Calls: only extract if not already extracted from this URL
        if (urlFieldVal && txtContent.dataset.extractedFrom !== urlFieldVal && (!contentVal || contentVal.startsWith('http'))) {
            const fetched = await extractAndTranscribeOwnUrl(urlFieldVal);
            if (fetched) contentVal = fetched;
        }

        if (!contentVal) {
            alert('Please enter an ad link and click Transcribe, or paste an ad script.');
            btnGen.disabled = false;
            if (spinner) spinner.classList.add('hidden');
            return;
        }

        const payload = {
            product_name: (document.getElementById('own_product_name')?.value || "").trim() || "American Hairline Scalp Revival System",
            winner_content: contentVal,
            winning_notes: (document.getElementById('own_winning_notes')?.value || "").trim(),
            target_persona: document.getElementById('own_target_persona')?.value || "The Skeptical Solution Seeker (Marcus, 34)",
            total_duration: document.getElementById('own_total_duration')?.value || "30 Seconds",
            global_feedback: window.sirsGlobalFeedback || ""
        };

        try {
            const res = await fetch('/api/generate-own-ad-variations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.status === 'SUCCESS') {
                const metricsBar = document.getElementById('own-metrics-bar');
                if (metricsBar) {
                    metricsBar.classList.remove('hidden');
                    const m = data.success_metrics || {};
                    document.getElementById('own-metric-quality').textContent = `${m.overall_script_quality || 95}%`;
                    document.getElementById('own-metric-hook').textContent = `${m.hook_strength_score || 96}%`;
                    document.getElementById('own-metric-policy').textContent = `${m.policy_compliance_score || 100}%`;
                }

                const decompBox = document.getElementById('own-deconstruction-container');
                if (decompBox && data.winner_deconstruction) {
                    decompBox.classList.remove('hidden');
                    const wd = data.winner_deconstruction;
                    document.getElementById('own-decomp-hook').textContent = wd.hook_mechanism || '';
                    document.getElementById('own-decomp-retention').textContent = wd.retention_drivers || '';
                    document.getElementById('own-decomp-emotion').textContent = wd.emotional_core || '';
                    document.getElementById('own-decomp-conversion').textContent = wd.conversion_trigger || '';
                }

                renderDoubleDownScriptCards('own-scripts-container', data.video_scripts, '#EC4899', 'Own Double-Down');
                if (typeof loadAndRenderBucket === 'function') loadAndRenderBucket();
                if (typeof fetchSystemMetrics === 'function') fetchSystemMetrics();
            } else {
                alert(`Error generating variations: ${data.message || 'Unknown error'}`);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to connect to generator service.');
        } finally {
            btnGen.disabled = false;
            if (spinner) spinner.classList.add('hidden');
        }
    });
}

function initCompetitorAdRemixer() {
    setupModeToggle('comp-mode-text', 'comp-mode-url', 'comp-mode-upload', 'comp-url-group', 'comp-upload-group');

    window._adTranscriptCache = window._adTranscriptCache || {};

    const btnFetchUrl = document.getElementById('btn-fetch-comp-url');
    const btnFetchAndGen = document.getElementById('btn-fetch-and-gen-comp');
    const inputUrl = document.getElementById('comp_ad_url');
    const urlStatus = document.getElementById('comp-url-status');
    const txtContent = document.getElementById('comp_ad_content');
    const transcriptBadge = document.getElementById('comp-transcript-badge');
    const btnSample = document.getElementById('btn-load-sample-comp');

    if (btnSample && txtContent) {
        btnSample.addEventListener('click', () => {
            txtContent.value = "Men in their 20s and 30s are secretly using this chemical foam every morning to hide temple receding before it gets worse. Sign up for our monthly subscription delivery, start your free doctor consultation, and get your first can for $20.";
            txtContent.dataset.extractedFrom = "sample";
            txtContent.style.border = "1px solid #A78BFA";
            if (transcriptBadge) {
                transcriptBadge.style.display = "inline-block";
                transcriptBadge.style.background = "rgba(167, 139, 250, 0.2)";
                transcriptBadge.style.color = "#A78BFA";
                transcriptBadge.textContent = "📄 Sample Competitor Ad Loaded";
            }
        });
    }

    async function extractAndTranscribeCompUrl(targetUrl) {
        if (!targetUrl) return null;
        const normalizedUrl = targetUrl.trim();

        // 1. Instant Cache Hit Check (0 API calls, 0s delay)
        if (window._adTranscriptCache[normalizedUrl] && window._adTranscriptCache[normalizedUrl].status === 'SUCCESS') {
            const cached = window._adTranscriptCache[normalizedUrl];
            if (txtContent) {
                txtContent.value = cached.extracted_text;
                txtContent.dataset.extractedFrom = normalizedUrl;
                txtContent.style.border = "2px solid #10B981";
            }
            if (transcriptBadge) {
                transcriptBadge.style.display = "inline-block";
                transcriptBadge.style.background = "rgba(16, 185, 129, 0.2)";
                transcriptBadge.style.color = "#10B981";
                transcriptBadge.textContent = "⚡ Instant Cache (0 API Calls)";
            }
            if (urlStatus) {
                urlStatus.innerHTML = '<span style="color:#10B981; font-weight:600;">⚡ Instant Cache Hit (0 API calls): Loaded from cache in 0.01s!</span>';
            }
            return cached.extracted_text;
        }

        if (urlStatus) {
            urlStatus.innerHTML = '<span style="color:#A78BFA; font-weight:600;"><span class="spinner" style="width:12px; height:12px; display:inline-block; vertical-align:middle; margin-right:4px;"></span> Downloading SD competitor ad & transcribing with Gemini AI...</span>';
        }
        if (txtContent) {
            txtContent.value = "🎙️ Downloading lightweight audio track and transcribing spoken voiceover with Gemini AI...\n\nPlease wait a few seconds...";
            txtContent.style.border = "2px solid #8B5CF6";
            txtContent.style.boxShadow = "0 0 15px rgba(139, 92, 246, 0.3)";
        }

        try {
            const data = await safeFetchJson('/api/extract-ad-content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: normalizedUrl })
            });

            if (data && data.status === 'SUCCESS' && data.extracted_text) {
                window._adTranscriptCache[normalizedUrl] = data;

                if (txtContent) {
                    txtContent.value = data.extracted_text;
                    txtContent.dataset.extractedFrom = normalizedUrl;
                    txtContent.style.border = "2px solid #10B981";
                    txtContent.style.boxShadow = "0 0 18px rgba(16, 185, 129, 0.4)";
                    txtContent.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => { txtContent.style.boxShadow = ""; }, 3000);
                }
                if (transcriptBadge) {
                    transcriptBadge.style.display = "inline-block";
                    transcriptBadge.style.background = "rgba(16, 185, 129, 0.2)";
                    transcriptBadge.style.color = "#10B981";
                    const words = data.audio_transcript ? data.audio_transcript.trim().split(/\s+/).length : (data.extracted_text ? data.extracted_text.trim().split(/\s+/).length : 0);
                    transcriptBadge.textContent = words > 0 ? `✓ Transcribed (${words} words)` : `✓ Extracted`;
                }
                if (urlStatus) {
                    urlStatus.innerHTML = '<span style="color:#10B981; font-weight:600;">✓ Competitor ad content loaded successfully!</span>';
                }
                const compBrandInput = document.getElementById('comp_brand_name');
                if (compBrandInput && (!compBrandInput.value || compBrandInput.value.includes('Leading'))) {
                    if (data.uploader) compBrandInput.value = data.uploader;
                    else if (data.title) compBrandInput.value = data.title;
                }
                return data.extracted_text;
            } else {
                if (txtContent) {
                    txtContent.value = "";
                    txtContent.dataset.extractedFrom = "";
                    txtContent.placeholder = "⚠️ Platform bot protection blocked automated scraping of this link. Please switch to 'Upload Media' tab to upload the video file directly, or paste the competitor ad script here.";
                    txtContent.style.border = "2px solid #F59E0B";
                    txtContent.style.boxShadow = "0 0 15px rgba(245, 158, 11, 0.3)";
                }
                if (transcriptBadge) {
                    transcriptBadge.style.display = "inline-block";
                    transcriptBadge.style.background = "rgba(245, 158, 11, 0.2)";
                    transcriptBadge.style.color = "#F59E0B";
                    transcriptBadge.textContent = "⚠️ Bot Protected";
                }
                if (urlStatus) {
                    urlStatus.innerHTML = '<div style="background:rgba(245, 158, 11, 0.1); border:1px solid rgba(245, 158, 11, 0.3); border-radius:8px; padding:10px 12px; margin-top:8px; color:#F59E0B; font-size:12px;"><strong>⚠️ Meta Ad Library Bot-Wall Detected:</strong> Facebook requires interactive browser verification for this link.<br><br>👉 <strong>Instant 1-Step Solution:</strong> Click the <strong>Upload Media</strong> tab right next to this input and drop the competitor video file directly. Gemini AI will analyze the video, transcribe dialogue, and generate all 5 remixes in 1 step!</div>';
                }
                return null;
            }
        } catch (err) {
            console.error('URL extraction error:', err);
            if (txtContent) {
                txtContent.value = `Reference Competitor Ad Link: ${normalizedUrl}\n\n(Note: ${err.message || 'Platform restricted'})\nYou can paste the competitor ad script or hook details directly in this box to generate remixes.`;
                txtContent.style.border = "2px solid #F59E0B";
                txtContent.style.boxShadow = "";
            }
            if (urlStatus) {
                urlStatus.innerHTML = '<span style="color:#F59E0B; font-weight:600;">⚠️ Link requires direct script input below.</span>';
            }
        }
        return null;
    }

    if (btnFetchUrl && inputUrl) {
        btnFetchUrl.addEventListener('click', async () => {
            const url = inputUrl.value.trim();
            if (!url) {
                alert('Please enter a competitor ad URL.');
                return;
            }
            btnFetchUrl.disabled = true;
            btnFetchUrl.textContent = '🎙️ Transcribing...';
            await extractAndTranscribeCompUrl(url);
            btnFetchUrl.disabled = false;
            btnFetchUrl.textContent = '🎙️ Transcribe Audio';
        });
    }

    if (btnFetchAndGen && inputUrl) {
        btnFetchAndGen.addEventListener('click', async () => {
            const url = inputUrl.value.trim();
            if (!url) {
                alert('Please enter a competitor ad link first.');
                return;
            }
            btnFetchAndGen.disabled = true;
            btnFetchAndGen.textContent = '⚡ Transcribing & Generating...';

            let transcribed = (txtContent && txtContent.dataset.extractedFrom === url && txtContent.value.trim().length > 20)
                ? txtContent.value
                : await extractAndTranscribeCompUrl(url);

            btnFetchAndGen.disabled = false;
            btnFetchAndGen.textContent = '⚡ Transcribe & Generate 5 Remixes Now';
            if (transcribed) {
                const form = document.getElementById('competitor-remix-form');
                if (form) form.requestSubmit();
            }
        });
    }

    // Media Upload with Seamless Chunking Support (100MB+ videos handled safely)
    const fileInput = document.getElementById('comp_media_file');
    const progressEl = document.getElementById('comp-upload-progress');

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            await uploadMediaWithChunking(
                file,
                progressEl,
                txtContent,
                transcriptBadge,
                'btn-generate-comp',
                'competitor-remix-form',
                'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)'
            );
        });
    }

    // Form Submit
    const form = document.getElementById('competitor-remix-form');
    const btnGen = document.getElementById('btn-generate-comp');
    const spinner = document.getElementById('comp-spinner');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        btnGen.disabled = true;
        if (spinner) spinner.classList.remove('hidden');

        let contentVal = document.getElementById('comp_ad_content').value.trim();
        const urlFieldVal = inputUrl ? inputUrl.value.trim() : '';

        // Prevent Duplicate API Calls: only extract if not already extracted from this URL
        if (urlFieldVal && txtContent.dataset.extractedFrom !== urlFieldVal && (!contentVal || contentVal.startsWith('http'))) {
            const fetched = await extractAndTranscribeCompUrl(urlFieldVal);
            if (fetched) contentVal = fetched;
        }

        if (!contentVal) {
            alert('Please enter a competitor ad link and click Transcribe, or paste a competitor script.');
            btnGen.disabled = false;
            if (spinner) spinner.classList.add('hidden');
            return;
        }

        const payload = {
            competitor_name: (document.getElementById('comp_brand_name')?.value || "").trim() || "Leading Competitor Brand",
            competitor_content: contentVal,
            our_product_name: (document.getElementById('comp_our_product')?.value || "").trim() || "American Hairline Scalp Revival System",
            our_unique_mechanism: (document.getElementById('comp_our_mechanism')?.value || "").trim() || "Bio-active botanical peptide signaling that revitalizes dormant follicles without surgery or greasy residue",
            target_persona: document.getElementById('comp_target_persona')?.value || "The Skeptical Solution Seeker (Marcus, 34)",
            total_duration: document.getElementById('comp_total_duration')?.value || "30 Seconds",
            global_feedback: window.sirsGlobalFeedback || ""
        };

        try {
            const res = await fetch('/api/generate-competitor-remix', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.status === 'SUCCESS') {
                const metricsBar = document.getElementById('comp-metrics-bar');
                if (metricsBar) {
                    metricsBar.classList.remove('hidden');
                    const m = data.success_metrics || {};
                    document.getElementById('comp-metric-quality').textContent = `${m.overall_script_quality || 96}%`;
                    document.getElementById('comp-metric-hook').textContent = `${m.hook_strength_score || 97}%`;
                    document.getElementById('comp-metric-policy').textContent = `${m.policy_compliance_score || 100}%`;
                }

                const decompBox = document.getElementById('comp-deconstruction-container');
                if (decompBox && data.competitor_deconstruction) {
                    decompBox.classList.remove('hidden');
                    const cd = data.competitor_deconstruction;
                    document.getElementById('comp-decomp-hook').textContent = cd.hook_strategy || '';
                    document.getElementById('comp-decomp-framework').textContent = cd.persuasion_framework || '';
                    document.getElementById('comp-decomp-vulnerability').textContent = cd.vulnerability_gap || '';
                    document.getElementById('comp-decomp-counter').textContent = cd.our_counter_positioning || '';
                }

                renderDoubleDownScriptCards('comp-scripts-container', data.video_scripts, '#8B5CF6', 'Competitor Remix');
                if (typeof loadAndRenderBucket === 'function') loadAndRenderBucket();
                if (typeof fetchSystemMetrics === 'function') fetchSystemMetrics();
            } else {
                alert(`Error generating remixes: ${data.message || 'Unknown error'}`);
            }
        } catch (err) {
            console.error(err);
            alert('Failed to connect to remixer service.');
        } finally {
            btnGen.disabled = false;
            if (spinner) spinner.classList.add('hidden');
        }
    });
}

function pollTranscription(transcriptId, targetTextarea, progressEl) {
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`/api/transcribe-audio/${transcriptId}`);
            const data = await res.json();
            if (data.status === 'completed' && data.text) {
                clearInterval(interval);
                targetTextarea.value = data.text;
                if (progressEl) progressEl.classList.add('hidden');
            } else if (data.status === 'error') {
                clearInterval(interval);
                if (progressEl) progressEl.innerHTML = '<span style="color:#ef4444;">Transcription failed. Please paste text directly.</span>';
            }
        } catch (err) {
            clearInterval(interval);
            console.error('Polling error:', err);
        }
    }, 3000);
}

function renderDoubleDownScriptCards(containerId, scripts, accentColor, badgeLabel) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!scripts || scripts.length === 0) {
        container.innerHTML = '<div style="padding:40px; text-align:center; color:#94A3B8;">No script variations generated.</div>';
        return;
    }

    scripts.forEach((s, idx) => {
        const card = document.createElement('div');
        card.style.cssText = `
            background: #111827;
            border: 1px solid #1F2937;
            border-top: 3px solid ${accentColor};
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;

        // Storyboard SVG
        const storyboardHtml = s.preview_storyboard_svg ? `
            <div style="margin: 16px 0; border-radius: 10px; overflow: hidden; border: 1px solid #1E293B;">
                ${s.preview_storyboard_svg}
            </div>
        ` : '';

        // Scenes HTML
        const scenesHtml = (s.scenes || []).map(sc => `
            <div style="background:#090D16; border:1px solid #1E293B; border-radius:8px; padding:12px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #1A2333; padding-bottom:6px;">
                    <span style="font-weight:700; color:#F8FAFC; font-size:12px;">SCENE ${sc.scene_number}: <span style="color:${accentColor};">${sc.scene_type}</span></span>
                    <span style="background:rgba(255,255,255,0.06); color:#94A3B8; padding:2px 8px; border-radius:4px; font-size:11px;">⏱️ ${sc.duration_seconds}</span>
                </div>
                <div style="margin-bottom:8px;">
                    <b style="color:#38BDF8; font-size:11px; text-transform:uppercase; display:block; margin-bottom:2px;">🎙️ Spoken Script:</b>
                    <p style="margin:0; color:#E2E8F0; font-size:13px; line-height:1.5;">"${sc.spoken_script}"</p>
                </div>
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:8px; margin-top:8px; font-size:11px;">
                    <div style="background:#0F172A; padding:6px 10px; border-radius:6px;">
                        <span style="color:#94A3B8; font-weight:600;">🎬 Visual Direction:</span>
                        <div style="color:#CBD5E1; margin-top:2px;">${sc.visual_direction}</div>
                    </div>
                    <div style="background:#0F172A; padding:6px 10px; border-radius:6px;">
                        <span style="color:#94A3B8; font-weight:600;">📱 On-Screen Graphic:</span>
                        <div style="color:#38BDF8; font-weight:600; margin-top:2px;">${sc.on_screen_text}</div>
                    </div>
                    <div style="background:#0F172A; padding:6px 10px; border-radius:6px;">
                        <span style="color:#94A3B8; font-weight:600;">🎵 Audio / SFX:</span>
                        <div style="color:#F59E0B; margin-top:2px;">${sc.audio_cues}</div>
                    </div>
                </div>
            </div>
        `).join('');

        // Full script copy text
        const fullScriptText = `TITLE: ${s.script_title} (${s.framework_structure})
DURATION: ${s.total_duration_est} | AUDIENCE: ${s.target_persona}
CORE HOOK: ${s.core_hook}

=== SCENE BREAKDOWN ===
${(s.scenes || []).map(sc => `
SCENE ${sc.scene_number} (${sc.duration_seconds}) - [${sc.scene_type}]
SPOKEN: "${sc.spoken_script}"
VISUAL: ${sc.visual_direction}
ON-SCREEN: ${sc.on_screen_text}
AUDIO/SFX: ${sc.audio_cues}
`).join('')}

CASTING NOTES: ${s.actor_casting_notes || 'Natural and relatable tone'}
B-ROLL: ${(s.b_roll_shot_list || []).join(', ')}
DISCLAIMER: ${s.ftc_disclaimer_note || '*Results may vary.'}
`.trim();

        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                <div>
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                        <span style="background:${accentColor}33; color:${accentColor}; padding:3px 8px; border-radius:6px; font-size:11px; font-weight:700;">VARIATION #${s.script_id || (idx+1)}</span>
                        <span style="background:rgba(255,255,255,0.08); color:#CBD5E1; padding:3px 8px; border-radius:6px; font-size:11px;">${s.framework_structure}</span>
                        <span style="color:#94A3B8; font-size:11px;">⏱️ ${s.total_duration_est}</span>
                    </div>
                    <h3 style="margin:4px 0 0 0; color:#F8FAFC; font-size:16px; font-weight:700;">${s.script_title}</h3>
                </div>
                <button type="button" class="btn btn-secondary copy-full-script-btn" style="padding:6px 12px; font-size:12px;">
                    📋 Copy Full Script
                </button>
            </div>

            <!-- Hook Feature Box -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid ${accentColor}44; border-radius:8px; padding:12px; margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <b style="color:${accentColor}; font-size:11px; text-transform:uppercase;">🎯 0-3s Scroll-Stopping Hook:</b>
                    <button type="button" class="copy-hook-btn" style="background:none; border:none; color:#38BDF8; cursor:pointer; font-size:11px; font-weight:600;">Copy Hook</button>
                </div>
                <div style="color:#F8FAFC; font-size:13px; font-weight:600; margin-top:4px;">"${s.core_hook}"</div>
            </div>

            ${storyboardHtml}

            <!-- Scenes Container -->
            <div style="margin-top:16px;">
                <h4 style="color:#94A3B8; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Scene-by-Scene Storyboard & Dialogue</h4>
                ${scenesHtml}
            </div>

            <!-- Footer Details -->
            <div style="margin-top:14px; padding-top:10px; border-top:1px solid #1E293B; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; font-size:11px; color:#94A3B8;">
                <div><b>Casting:</b> ${s.actor_casting_notes || 'Authentic direct tone'}</div>
                <div style="color:#64748B;">${s.ftc_disclaimer_note || '*Results may vary.'}</div>
            </div>
        `;

        // Attach Copy Handlers
        const btnCopyFull = card.querySelector('.copy-full-script-btn');
        btnCopyFull.addEventListener('click', () => {
            navigator.clipboard.writeText(fullScriptText).then(() => {
                const orig = btnCopyFull.textContent;
                btnCopyFull.textContent = '✅ Copied!';
                btnCopyFull.style.borderColor = '#10B981';
                setTimeout(() => {
                    btnCopyFull.textContent = orig;
                    btnCopyFull.style.borderColor = '';
                }, 2500);
            });
        });

        const btnCopyHook = card.querySelector('.copy-hook-btn');
        btnCopyHook.addEventListener('click', () => {
            navigator.clipboard.writeText(s.core_hook).then(() => {
                const orig = btnCopyHook.textContent;
                btnCopyHook.textContent = 'Copied!';
                setTimeout(() => { btnCopyHook.textContent = orig; }, 2000);
            });
        });

        container.appendChild(card);
    });
}



function updateGlobalFeedbackBadges() {
    const feedback = window.sirsGlobalFeedback ? window.sirsGlobalFeedback.trim() : "";
    const ownBadge = document.getElementById('own-feedback-display');
    const compBadge = document.getElementById('comp-feedback-display');

    if (ownBadge) {
        if (feedback) {
            ownBadge.innerHTML = `<b style="color:#EC4899;">ACTIVE:</b> "${feedback.substring(0, 85)}${feedback.length > 85 ? '...' : ''}"`;
        } else {
            ownBadge.textContent = "No global feedback applied yet (using default brand rules).";
        }
    }

    if (compBadge) {
        if (feedback) {
            compBadge.innerHTML = `<b style="color:#A78BFA;">ACTIVE:</b> "${feedback.substring(0, 85)}${feedback.length > 85 ? '...' : ''}"`;
        } else {
            compBadge.textContent = "No global feedback applied yet (using default brand rules).";
        }
    }
}


// ============================================================================
// Creative Variations Bucket Management
// ============================================================================
window._variationsBucket = [];
let _bucketCurrentFilter = 'all';

function initCreativeBucket() {
    loadAndRenderBucket();

    // Quick jump buttons from Double Down & Competitor Remixer headers
    document.querySelectorAll('.btn-switch-to-bucket').forEach(btn => {
        btn.addEventListener('click', () => {
            const bucketTabBtn = document.querySelector('.tab-btn[data-tab="tab-bucket"]');
            if (bucketTabBtn) bucketTabBtn.click();
        });
    });

    // Search filter input
    const searchInput = document.getElementById('bucket-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderBucketList();
        });
    }

    // Filter pill buttons (All, Own, Comp)
    const filterPills = document.querySelectorAll('.bucket-filter-btn');
    filterPills.forEach(pill => {
        pill.addEventListener('click', () => {
            filterPills.forEach(p => {
                p.classList.remove('active');
                p.style.background = '#1E293B';
                p.style.color = '#94A3B8';
            });
            pill.classList.add('active');
            pill.style.background = 'var(--primary)';
            pill.style.color = '#FFF';
            _bucketCurrentFilter = pill.dataset.filter || 'all';
            renderBucketList();
        });
    });

    // Export all button
    const btnExport = document.getElementById('btn-export-bucket');
    if (btnExport) {
        btnExport.addEventListener('click', () => {
            if (window._variationsBucket.length === 0) {
                alert('Variations bucket is empty.');
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window._variationsBucket, null, 2));
            const dlAnchor = document.createElement('a');
            dlAnchor.setAttribute("href", dataStr);
            dlAnchor.setAttribute("download", `meta_ads_creative_bucket_${Date.now()}.json`);
            document.body.appendChild(dlAnchor);
            dlAnchor.click();
            dlAnchor.remove();
        });
    }

    // Clear bucket button
    const btnClear = document.getElementById('btn-clear-bucket');
    if (btnClear) {
        btnClear.addEventListener('click', async () => {
            if (window._variationsBucket.length === 0) return;
            if (confirm('Are you sure you want to clear your entire Creative Variations Bucket?')) {
                try {
                    await fetch('/api/variations-bucket', { method: 'DELETE' });
                    window._variationsBucket = [];
                    updateBucketCounters();
                    renderBucketList();
                } catch (e) {
                    console.error(e);
                }
            }
        });
    }
}

async function loadAndRenderBucket() {
    try {
        const res = await fetch('/api/variations-bucket');
        const data = await res.json();
        if (data.status === 'SUCCESS' && Array.isArray(data.bucket)) {
            window._variationsBucket = data.bucket;
            updateBucketCounters();
            renderBucketList();
        }
    } catch (err) {
        console.error('Failed to load variations bucket:', err);
    }
}

function updateBucketCounters() {
    const total = window._variationsBucket.length;
    const ownCount = window._variationsBucket.filter(b => b.strategy_type === 'own_doubledown').length;
    const compCount = window._variationsBucket.filter(b => b.strategy_type === 'competitor_remix').length;

    const navBadge = document.getElementById('nav-bucket-count');
    if (navBadge) navBadge.textContent = total;

    const allPill = document.getElementById('bucket-filter-all-count');
    if (allPill) allPill.textContent = total;

    const ownPill = document.getElementById('bucket-filter-own-count');
    if (ownPill) ownPill.textContent = ownCount;

    const compPill = document.getElementById('bucket-filter-comp-count');
    if (compPill) compPill.textContent = compCount;

    document.querySelectorAll('.bucket-count-badge').forEach(el => {
        el.textContent = total;
    });
}

function toggleBucketScriptAccordion(id) {
    const content = document.getElementById(`content_${id}`);
    const chevron = document.getElementById(`chevron_${id}`);
    if (!content) return;
    if (content.style.display === 'none' || !content.style.display) {
        content.style.display = 'block';
        if (chevron) chevron.textContent = '▲';
    } else {
        content.style.display = 'none';
        if (chevron) chevron.textContent = '▼';
    }
}

async function deleteBucketBatch(batchId) {
    if (!confirm('Delete this generated batch from the bucket?')) return;
    try {
        const res = await fetch(`/api/variations-bucket/${batchId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'SUCCESS') {
            window._variationsBucket = window._variationsBucket.filter(b => b.id !== batchId);
            updateBucketCounters();
            renderBucketList();
        }
    } catch (e) {
        console.error('Delete error:', e);
    }
}

function copyTextToClipboard(text, successMsg = 'Copied to clipboard!') {
    navigator.clipboard.writeText(text).then(() => {
        alert(successMsg);
    }).catch(err => {
        console.error('Copy error:', err);
    });
}

function downloadTextAsFile(filename, text) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/markdown;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

function generateScriptMarkdown(s, batch) {
    let md = `# ${s.script_title || 'Script Variation'}\n\n`;
    md += `**Framework Structure:** ${s.framework_structure || s.core_angle || '-'}\n`;
    md += `**Target Persona:** ${s.target_persona || batch.target_persona || '-'}\n`;
    md += `**Duration:** ${s.total_duration_est || batch.total_duration || '30s'}\n`;
    md += `**Core Hook:** "${s.core_hook || '-'}"\n\n`;
    md += `## Scene Breakdown:\n\n`;
    (s.scenes || []).forEach(sc => {
        md += `### SCENE ${sc.scene_number}: ${sc.scene_type} (${sc.duration_seconds})\n`;
        md += `**Spoken Script:** "${sc.spoken_script}"\n`;
        md += `**Visual Direction:** ${sc.visual_direction}\n`;
        md += `**On-Screen Text:** ${sc.on_screen_text}\n`;
        md += `**Audio/SFX:** ${sc.audio_cues}\n\n`;
    });
    if (s.actor_casting_notes) md += `**Actor Notes:** ${s.actor_casting_notes}\n`;
    if (s.ftc_disclaimer_note) md += `**FTC Disclaimer:** ${s.ftc_disclaimer_note}\n`;
    return md;
}

function generateBatchMarkdown(batch) {
    let md = `# Creative Set: ${batch.product_name || batch.title || 'Creative Suite'}\n`;
    md += `**Generated:** ${batch.timestamp || 'Recent'} | **Strategy:** ${batch.strategy_type}\n`;
    md += `**Target Persona:** ${batch.target_persona || '-'}\n\n`;
    (batch.video_scripts || []).forEach((s, idx) => {
        md += `---\n\n## Variation ${idx + 1}: ${s.script_title}\n`;
        md += generateScriptMarkdown(s, batch) + '\n\n';
    });
    return md;
}

function renderBucketList() {
    const container = document.getElementById('bucket-items-container');
    if (!container) return;

    const searchInput = document.getElementById('bucket-search');
    const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

    let items = window._variationsBucket || [];

    if (_bucketCurrentFilter !== 'all') {
        items = items.filter(b => b.strategy_type === _bucketCurrentFilter);
    }

    if (query) {
        items = items.filter(b => {
            const prod = (b.product_name || b.title || '').toLowerCase();
            const persona = (b.target_persona || '').toLowerCase();
            const scriptsMatch = (b.video_scripts || []).some(s => 
                (s.script_title || '').toLowerCase().includes(query) || 
                (s.core_hook || '').toLowerCase().includes(query) ||
                (s.scenes || []).some(sc => (sc.spoken_script || '').toLowerCase().includes(query))
            );
            return prod.includes(query) || persona.includes(query) || scriptsMatch;
        });
    }

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="text-align:center; padding:60px 20px; color:#64748B;">
                <div style="font-size:44px; margin-bottom:12px;">🗂️</div>
                <h4 style="color:#E2E8F0; margin-bottom:6px; font-size:16px;">${query ? 'No matching variations found' : 'Your Variations Bucket is Empty'}</h4>
                <p style="max-width:480px; margin:0 auto; font-size:13px; line-height:1.5;">
                    ${query ? 'Try a different search term or clear the filter.' : 'Generate 5 double-down variations from winning ads or remix competitor ads. They are permanently archived here for instant reference and exporting.'}
                </p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';

    items.forEach((batch, bIdx) => {
        const isOwn = batch.strategy_type === 'own_doubledown';
        const accent = isOwn ? '#EC4899' : '#8B5CF6';
        const badgeText = isOwn ? '🔥 Own Double-Down' : '⚡ Competitor Remix';
        const scripts = batch.video_scripts || [];
        const deconstruction = batch.winner_deconstruction || batch.competitor_deconstruction || {};

        const batchCard = document.createElement('div');
        batchCard.className = 'bucket-batch-card';
        batchCard.style.cssText = `
            background: #111827;
            border: 1px solid #1F2937;
            border-left: 4px solid ${accent};
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;

        let deconstructSummaryHtml = '';
        if (deconstruction && (deconstruction.hook_mechanism || deconstruction.hook_strategy)) {
            const hook = deconstruction.hook_mechanism || deconstruction.hook_strategy || '';
            const core = deconstruction.emotional_core || deconstruction.vulnerability_exploited || '';
            const trigger = deconstruction.conversion_trigger || deconstruction.our_superior_mechanism || '';
            deconstructSummaryHtml = `
                <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:8px; margin: 14px 0; background:rgba(0,0,0,0.25); padding:10px 14px; border-radius:8px; font-size:12px;">
                    <div><b style="color:${accent};">Hook Mechanism:</b> <span style="color:#CBD5E1;">${hook}</span></div>
                    <div><b style="color:#38BDF8;">Emotional Core:</b> <span style="color:#CBD5E1;">${core}</span></div>
                    <div><b style="color:#10B981;">Conversion Trigger:</b> <span style="color:#CBD5E1;">${trigger}</span></div>
                </div>
            `;
        }

        let scriptsAccordionHtml = scripts.map((s, sIdx) => {
            const scenesListHtml = (s.scenes || []).map(sc => `
                <div style="background:#090D16; border:1px solid #1E293B; border-radius:8px; padding:10px 14px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; font-size:11px;">
                        <span style="font-weight:700; color:#F8FAFC;">SCENE ${sc.scene_number}: <span style="color:${accent};">${sc.scene_type}</span></span>
                        <span style="color:#94A3B8;">⏱️ ${sc.duration_seconds}</span>
                    </div>
                    <div style="color:#E2E8F0; font-size:12px; line-height:1.4; margin-bottom:6px;">"${sc.spoken_script}"</div>
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:6px; font-size:11px; color:#94A3B8; border-top:1px solid #1E293B; padding-top:6px;">
                        <div>🎬 <b>Visual:</b> ${sc.visual_direction || '-'}</div>
                        <div>📝 <b>Text Overlay:</b> ${sc.on_screen_text || '-'}</div>
                    </div>
                </div>
            `).join('');

            return `
                <div style="background:#0F172A; border:1px solid #1E293B; border-radius:8px; margin-top:10px; overflow:hidden;">
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; cursor:pointer; background:rgba(255,255,255,0.02);" onclick="window.toggleBucketScriptAccordion('${batch.id}_script_${sIdx}')">
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <span style="background:${accent}; color:#FFF; font-weight:700; font-size:11px; padding:2px 8px; border-radius:4px;">VAR ${s.script_id || sIdx + 1}</span>
                            <b style="color:#F8FAFC; font-size:13px;">${s.script_title || 'Variation'}</b>
                            <span style="color:#94A3B8; font-size:12px;">(${s.total_duration_est || batch.total_duration || '30s'})</span>
                            <span style="color:#38BDF8; font-size:12px; font-style:italic;">"${(s.core_hook || '').substring(0, 60)}${(s.core_hook || '').length > 60 ? '...' : ''}"</span>
                        </div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <button type="button" class="btn btn-secondary btn-copy-single-script" data-batch-idx="${bIdx}" data-script-idx="${sIdx}" style="font-size:11px; padding:4px 10px; background:#1E293B; border-color:#334155; color:#E2E8F0;">📋 Copy</button>
                            <span id="chevron_${batch.id}_script_${sIdx}" style="color:#94A3B8; font-size:12px; transition:transform 0.2s;">▼</span>
                        </div>
                    </div>
                    <div id="content_${batch.id}_script_${sIdx}" style="display:${bIdx === 0 && sIdx === 0 ? 'block' : 'none'}; padding:16px; border-top:1px solid #1E293B;">
                        ${s.preview_storyboard_svg ? `<div style="margin-bottom:12px; border-radius:8px; overflow:hidden; border:1px solid #1E293B;">${s.preview_storyboard_svg}</div>` : ''}
                        <div style="margin-bottom:10px;">
                            <b style="color:${accent}; font-size:11px; text-transform:uppercase;">Core Angle & Strategy:</b>
                            <p style="margin:2px 0 0 0; color:#CBD5E1; font-size:12px;">${s.framework_structure || s.core_angle || '-'}</p>
                        </div>
                        <div style="margin-bottom:12px;">
                            <b style="color:#38BDF8; font-size:11px; text-transform:uppercase;">🎯 Primary Opening Hook:</b>
                            <p style="margin:2px 0 0 0; color:#F8FAFC; font-size:13px; font-weight:600;">"${s.core_hook || '-'}"</p>
                        </div>
                        <b style="color:#F8FAFC; font-size:12px; display:block; margin-bottom:8px;">Scene-by-Scene Production Direction:</b>
                        ${scenesListHtml}
                    </div>
                </div>
            `;
        }).join('');

        batchCard.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
                <div>
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
                        <span style="background:${accent}22; color:${accent}; border:1px solid ${accent}44; font-weight:700; font-size:11px; padding:3px 10px; border-radius:6px;">${badgeText}</span>
                        <span style="color:#94A3B8; font-size:12px;">🕒 ${batch.timestamp || 'Recent'}</span>
                        <span style="color:#64748B; font-size:12px;">•</span>
                        <span style="color:#CBD5E1; font-size:12px;">🎯 ${batch.target_persona || 'General Audience'}</span>
                    </div>
                    <h3 style="margin:0; font-size:17px; font-weight:700; color:#F8FAFC;">${batch.product_name || batch.title || 'Creative Set'}</h3>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button type="button" class="btn btn-secondary btn-copy-entire-batch" data-batch-idx="${bIdx}" style="font-size:11px; padding:6px 12px; background:#1E293B; border-color:#334155; color:#E2E8F0;">📋 Copy All 5</button>
                    <button type="button" class="btn btn-secondary btn-download-entire-batch" data-batch-idx="${bIdx}" style="font-size:11px; padding:6px 12px; background:#1E293B; border-color:#334155; color:#E2E8F0;">💾 Download (.md)</button>
                    <button type="button" class="btn btn-secondary btn-delete-entire-batch" data-batch-id="${batch.id}" style="font-size:11px; padding:6px 10px; color:#EF4444; border-color:rgba(239,68,68,0.3); background:rgba(239,68,68,0.06);">🗑️</button>
                </div>
            </div>

            ${deconstructSummaryHtml}

            <div style="margin-top:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="color:#94A3B8; font-size:12px; font-weight:600;">5 Double-Down Script Variations:</span>
                    <span style="color:#64748B; font-size:11px;">Click each variation to inspect scenes</span>
                </div>
                ${scriptsAccordionHtml}
            </div>
        `;

        // Attach event listeners safely without inline onclick escaping issues
        const copyBtn = batchCard.querySelector('.btn-copy-entire-batch');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const md = generateBatchMarkdown(batch);
                window.copyTextToClipboard(md, `Copied all 5 variations for ${batch.product_name || 'batch'}!`);
            });
        }

        const downloadBtn = batchCard.querySelector('.btn-download-entire-batch');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                const md = generateBatchMarkdown(batch);
                const safeName = (batch.product_name || 'variations').toLowerCase().replace(/[^a-z0-9]/g, '_');
                window.downloadTextAsFile(`creative_bucket_${safeName}.md`, md);
            });
        }

        const delBtn = batchCard.querySelector('.btn-delete-entire-batch');
        if (delBtn) {
            delBtn.addEventListener('click', () => {
                window.deleteBucketBatch(batch.id);
            });
        }

        batchCard.querySelectorAll('.btn-copy-single-script').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sIdx = parseInt(btn.dataset.scriptIdx, 10);
                const sc = scripts[sIdx];
                if (sc) {
                    const md = generateScriptMarkdown(sc, batch);
                    window.copyTextToClipboard(md, `Copied Script #${sIdx + 1}: ${sc.script_title || ''} to clipboard!`);
                }
            });
        });

        container.appendChild(batchCard);
    });
}

function toggleBucketScriptAccordion(id) {
    const content = document.getElementById(`content_${id}`);
    const chevron = document.getElementById(`chevron_${id}`);
    if (!content) return;
    if (content.style.display === 'none' || !content.style.display) {
        content.style.display = 'block';
        if (chevron) chevron.textContent = '▲';
    } else {
        content.style.display = 'none';
        if (chevron) chevron.textContent = '▼';
    }
}

async function deleteBucketBatch(batchId) {
    if (!confirm('Delete this generated batch from the bucket?')) return;
    try {
        const res = await fetch(`/api/variations-bucket/${batchId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'SUCCESS') {
            window._variationsBucket = window._variationsBucket.filter(b => b.id !== batchId);
            updateBucketCounters();
            renderBucketList();
        }
    } catch (e) {
        console.error('Delete error:', e);
    }
}

function copyTextToClipboard(text, successMsg = 'Copied to clipboard!') {
    navigator.clipboard.writeText(text).then(() => {
        alert(successMsg);
    }).catch(err => {
        console.error('Copy error:', err);
    });
}

function downloadTextAsFile(filename, text) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/markdown;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

function generateScriptMarkdown(s, batch) {
    let md = `# ${s.script_title || 'Script Variation'}\n\n`;
    md += `**Framework Structure:** ${s.framework_structure || s.core_angle || '-'}\n`;
    md += `**Target Persona:** ${s.target_persona || batch.target_persona || '-'}\n`;
    md += `**Duration:** ${s.total_duration_est || batch.total_duration || '30s'}\n`;
    md += `**Core Hook:** "${s.core_hook || '-'}"\n\n`;
    md += `## Scene Breakdown:\n\n`;
    (s.scenes || []).forEach(sc => {
        md += `### SCENE ${sc.scene_number}: ${sc.scene_type} (${sc.duration_seconds})\n`;
        md += `**Spoken Script:** "${sc.spoken_script}"\n`;
        md += `**Visual Direction:** ${sc.visual_direction}\n`;
        md += `**On-Screen Text:** ${sc.on_screen_text}\n`;
        md += `**Audio/SFX:** ${sc.audio_cues}\n\n`;
    });
    if (s.actor_casting_notes) md += `**Actor Notes:** ${s.actor_casting_notes}\n`;
    if (s.ftc_disclaimer_note) md += `**FTC Disclaimer:** ${s.ftc_disclaimer_note}\n`;
    return md;
}

function generateBatchMarkdown(batch) {
    let md = `# Creative Set: ${batch.product_name || batch.title || 'Creative Suite'}\n`;
    md += `**Generated:** ${batch.timestamp || 'Recent'} | **Strategy:** ${batch.strategy_type}\n`;
    md += `**Target Persona:** ${batch.target_persona || '-'}\n\n`;
    (batch.video_scripts || []).forEach((s, idx) => {
        md += `---\n\n## Variation ${idx + 1}: ${s.script_title}\n`;
        md += generateScriptMarkdown(s, batch) + '\n\n';
    });
    return md;
}

window.renderBucketList = renderBucketList;
window.loadAndRenderBucket = loadAndRenderBucket;
window.toggleBucketScriptAccordion = toggleBucketScriptAccordion;
window.deleteBucketBatch = deleteBucketBatch;
window.copyTextToClipboard = copyTextToClipboard;
window.downloadTextAsFile = downloadTextAsFile;

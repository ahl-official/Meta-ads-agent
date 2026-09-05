import re

with open('static/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

single_persona = """const INITIAL_PERSONAS = [
    {
        persona_id: 1,
        name: "American Hairline General Persona",
        avatar_title: "Target Demographic • Hair Loss Solutions",
        target_angle: "Confidence Restoration Angle",
        summary: "Primary target audience looking for non-surgical, guaranteed hair density recovery to restore their confidence and youthful appearance.",
        demographics: {
            "Age": "25 - 55 years old",
            "Gender": "All Genders",
            "Income": "$50,000 - $150,000 / year",
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
];"""

# Replace the block from const INITIAL_PERSONAS to the end of its array declaration.
# The array ends right before `// Pre-loaded Sample 10 Core Benefits Data Set (Initial Demonstration for Agent 2)`
pattern = re.compile(r'const INITIAL_PERSONAS\s*=\s*\[.*?\];', re.DOTALL)
new_content = pattern.sub(single_persona, content)

with open('static/app.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Updated app.js INITIAL_PERSONAS")

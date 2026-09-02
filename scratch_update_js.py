import sys
import re

with open('static/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Store generatedPersonas globally when Agent 1 finishes
# Search for: renderPersonas(data.personas);
# Replace with: window.generatedPersonas = data.personas; updateDropdownsWithPersonas(); renderPersonas(data.personas);
content = content.replace(
    'renderPersonas(data.personas);',
    'window.generatedPersonas = data.personas;\n            updateDropdownsWithPersonas();\n            renderPersonas(data.personas);'
)

# 2. Also initialize it with INITIAL_PERSONAS at startup
# Search for: renderPersonas(INITIAL_PERSONAS);
# Replace with: window.generatedPersonas = INITIAL_PERSONAS; updateDropdownsWithPersonas(); renderPersonas(INITIAL_PERSONAS);
content = content.replace(
    'renderPersonas(INITIAL_PERSONAS);',
    'window.generatedPersonas = INITIAL_PERSONAS;\n    updateDropdownsWithPersonas();\n    renderPersonas(INITIAL_PERSONAS);'
)

# 3. Add updateDropdownsWithPersonas function
# Add it before initVideoScriptGenerator
func_code = """
function updateDropdownsWithPersonas() {
    const vTargetPersona = document.getElementById('v_target_persona');
    if (vTargetPersona && window.generatedPersonas && window.generatedPersonas.length > 0) {
        vTargetPersona.innerHTML = '';
        window.generatedPersonas.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name || p.full_persona_text;
            opt.textContent = p.name || p.full_persona_text;
            vTargetPersona.appendChild(opt);
        });
    }
}
"""
content = content.replace('function initVideoScriptGenerator() {', func_code + '\nfunction initVideoScriptGenerator() {')

# 4. Agent 2 b_persona_source logic
# Search for:
#         let personas = [];
#         const personaSource = document.getElementById('b_persona_source').value;
#         if (personaSource === 'saved_vault') {
#             personas = audienceVaultData.map(a => `${a.title}: ${a.description}`);
#         }
b_persona_replace = """
        let personas = [];
        const personaSource = document.getElementById('b_persona_source').value;
        if (personaSource === 'saved_vault') {
            personas = audienceVaultData.map(a => `${a.title}: ${a.description}`);
        } else if (personaSource === 'active_personas') {
            if (window.generatedPersonas && window.generatedPersonas.length > 0) {
                personas = window.generatedPersonas.map(p => `${p.name}: ${p.summary || p.full_persona_text}`);
            }
        }
"""
content = content.replace(
    "        let personas = [];\n        const personaSource = document.getElementById('b_persona_source').value;\n        if (personaSource === 'saved_vault') {\n            personas = audienceVaultData.map(a => `${a.title}: ${a.description}`);\n        }",
    b_persona_replace
)

# 5. Agent 3 a_persona_source logic
# Search for the same pattern but with a_persona_source
a_persona_replace = """
        let personas = [];
        const personaSource = document.getElementById('a_persona_source').value;
        if (personaSource === 'saved_vault') {
            personas = audienceVaultData.map(a => `${a.title}: ${a.description}`);
        } else if (personaSource === 'active_personas') {
            if (window.generatedPersonas && window.generatedPersonas.length > 0) {
                personas = window.generatedPersonas.map(p => `${p.name}: ${p.summary || p.full_persona_text}`);
            }
        }
"""
content = content.replace(
    "        let personas = [];\n        const personaSource = document.getElementById('a_persona_source').value;\n        if (personaSource === 'saved_vault') {\n            personas = audienceVaultData.map(a => `${a.title}: ${a.description}`);\n        }",
    a_persona_replace
)

with open('static/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated app.js")

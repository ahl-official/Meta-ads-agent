import re

with open('static/app.js', 'r', encoding='utf-8') as f:
    js = f.read()

# 1. Add global feedback variables and event listeners
feedback_logic = '''
// --- GLOBAL FEEDBACK LOGIC (AGENT 5) ---
window.sirsGlobalFeedback = '';

document.addEventListener('DOMContentLoaded', () => {
    const btnApplyFeedback = document.getElementById('btn-apply-global-feedback');
    const btnClearFeedback = document.getElementById('btn-clear-global-feedback');
    const feedbackText = document.getElementById('sirs_feedback_text');
    const feedbackStatus = document.getElementById('feedback-status');

    if (btnApplyFeedback) {
        btnApplyFeedback.addEventListener('click', () => {
            window.sirsGlobalFeedback = feedbackText.value.trim();
            if (window.sirsGlobalFeedback) {
                feedbackStatus.style.display = 'block';
                feedbackStatus.textContent = '? Feedback locked in. It will now be applied to all future agent generations.';
                setTimeout(() => { feedbackStatus.style.display = 'none'; }, 5000);
            }
        });
    }

    if (btnClearFeedback) {
        btnClearFeedback.addEventListener('click', () => {
            if (feedbackText) feedbackText.value = '';
            window.sirsGlobalFeedback = '';
            if (feedbackStatus) {
                feedbackStatus.style.display = 'block';
                feedbackStatus.textContent = 'Feedback cleared.';
                feedbackStatus.style.color = '#ef4444';
                setTimeout(() => { 
                    feedbackStatus.style.display = 'none'; 
                    feedbackStatus.style.color = '#00d26a';
                }, 3000);
            }
        });
    }
});
'''
if '// --- GLOBAL FEEDBACK LOGIC (AGENT 5) ---' not in js:
    js = feedback_logic + '\n' + js

# 2. Inject feedback into Agent 1 payload
if 'const payload = {\n            one_line_promise: document.getElementById(\'one_line_promise\').value,' in js:
    js = js.replace(
        '''const payload = {
            one_line_promise: document.getElementById('one_line_promise').value,
            ideal_customer: document.getElementById('ideal_customer').value,
            pain_point: document.getElementById('pain_point').value,
            solution: document.getElementById('solution').value,
            persona_count: 1
        };''',
        '''const payload = {
            one_line_promise: document.getElementById('one_line_promise').value + (window.sirsGlobalFeedback ? '\\n\\n[CRITICAL MANAGER FEEDBACK YOU MUST FOLLOW]: ' + window.sirsGlobalFeedback : ''),
            ideal_customer: document.getElementById('ideal_customer').value,
            pain_point: document.getElementById('pain_point').value,
            solution: document.getElementById('solution').value,
            persona_count: 1
        };'''
    )

# 3. Inject feedback into Agent 2 payload
if 'const payload = {\n            product_name: document.getElementById(\'b_product_name\').value,' in js:
    js = js.replace(
        '''const payload = {
            product_name: document.getElementById('b_product_name').value,
            target_personas: personas,
            topic_filter: document.getElementById('b_topic_filter').value
        };''',
        '''const payload = {
            product_name: document.getElementById('b_product_name').value + (window.sirsGlobalFeedback ? '\\n\\n[CRITICAL MANAGER FEEDBACK YOU MUST FOLLOW]: ' + window.sirsGlobalFeedback : ''),
            target_personas: personas,
            topic_filter: document.getElementById('b_topic_filter').value
        };'''
    )

# 4. Inject feedback into Agent 3 payload
if 'const payload = {\n            product_name: document.getElementById(\'a_product_name\').value,' in js:
    js = js.replace(
        '''const payload = {
            product_name: document.getElementById('a_product_name').value,
            target_personas: personas,
            benefit_focus: document.getElementById('a_benefit_focus').value
        };''',
        '''const payload = {
            product_name: document.getElementById('a_product_name').value + (window.sirsGlobalFeedback ? '\\n\\n[CRITICAL MANAGER FEEDBACK YOU MUST FOLLOW]: ' + window.sirsGlobalFeedback : ''),
            target_personas: personas,
            benefit_focus: document.getElementById('a_benefit_focus').value
        };'''
    )

# 5. Inject feedback into Agent 4 payload
if 'const payload = {\n            product_name: \'American Hairline Custom Hair Patch\',' in js:
    js = js.replace(
        '''const payload = {
            product_name: 'American Hairline Custom Hair Patch',
            target_persona: document.getElementById('v_target_persona').value,
            core_benefit: document.getElementById('v_core_benefit').value,
            angle: document.getElementById('v_target_angle').value,
            duration: document.getElementById('v_duration').value
        };''',
        '''const payload = {
            product_name: 'American Hairline Custom Hair Patch' + (window.sirsGlobalFeedback ? '\\n\\n[CRITICAL MANAGER FEEDBACK YOU MUST FOLLOW]: ' + window.sirsGlobalFeedback : ''),
            target_persona: document.getElementById('v_target_persona').value,
            core_benefit: document.getElementById('v_core_benefit').value,
            angle: document.getElementById('v_target_angle').value,
            duration: document.getElementById('v_duration').value
        };'''
    )

with open('static/app.js', 'w', encoding='utf-8') as f:
    f.write(js)

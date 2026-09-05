import re

with open('static/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

nav_insertion = '''<button class="tab-btn" data-tab="tab-feedback">?? Agent 5: Sir's Global Feedback</button>
            <button class="tab-btn" data-tab="tab-vault">'''
if '<button class="tab-btn" data-tab="tab-feedback">' not in html:
    html = html.replace('<button class="tab-btn" data-tab="tab-vault">', nav_insertion)

agent5_section = '''
            <!-- TAB 5: GLOBAL MANAGER FEEDBACK -->
            <section id="tab-feedback" class="tab-pane">
                <div class="grid-layout">
                    <div class="card control-panel" style="grid-column: span 12;">
                        <h2 class="card-title">Sir's Review / Manager Feedback</h2>
                        <p class="card-description">
                            <b>Agent 5:</b> Paste your manager's feedback, transcribed video notes, or specific instructions here. This feedback will be <b>automatically applied</b> to all generations across Agents 1, 2, 3, and 4 without altering their configurations.
                        </p>
                        
                        <div class="form-group">
                            <label for="sirs_feedback_text">GLOBAL FEEDBACK / INSTRUCTIONS</label>
                            <textarea id="sirs_feedback_text" class="form-textarea" rows="10" placeholder="Paste Sir's text reply...\\n\\nExample: Focus on customization, density, hairline design and professional fitting. Avoid negative framing."></textarea>
                        </div>
                        
                        <div style="display: flex; gap: 15px; margin-top: 20px;">
                            <button type="button" class="btn btn-primary" id="btn-apply-global-feedback" style="flex: 1; background-color: #00d26a; color: #000; font-weight: 800;">
                                <span class="btn-text">Approve (Apply Global Feedback)</span>
                            </button>
                            <button type="button" class="btn btn-secondary" id="btn-clear-global-feedback" style="flex: 1;">
                                <span class="btn-text">Clear Feedback</span>
                            </button>
                        </div>
                        
                        <div id="feedback-status" style="margin-top: 15px; font-weight: 600; color: #00d26a; display: none;">
                            ? Feedback locked in. It will now be applied to all future agent generations.
                        </div>
                    </div>
                </div>
            </section>
'''

if '<!-- TAB 5: GLOBAL MANAGER FEEDBACK -->' not in html:
    html = html.replace('<!-- TAB 6: SAVED AUDIENCE GROUPS VAULT -->', agent5_section + '\n            <!-- TAB 6: SAVED AUDIENCE GROUPS VAULT -->')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)

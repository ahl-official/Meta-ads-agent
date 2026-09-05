with open('static/app.js', 'a', encoding='utf-8') as f:
    f.write('''\n
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
                        <span>Video Script Hook Enhancement</span>
                        <span class="diff-agent-badge">Agent 3</span>
                    </div>
                    <div class="diff-content">
                        <div class="diff-before">"Are you losing hair? We can help."</div>
                        <div class="diff-after">"Don't let hair loss dictate your confidence. <span class="diff-highlight">Reclaim your professional image</span> with our undetectable hair systems."</div>
                    </div>
                `;
                
                // Mock Diff 4 (Agent 4)
                const diff4 = document.createElement('div');
                diff4.className = 'diff-card';
                diff4.innerHTML = `
                    <div class="diff-header">
                        <span>Visual Generation Tone</span>
                        <span class="diff-agent-badge">Agent 4</span>
                    </div>
                    <div class="diff-content">
                        <div class="diff-before">Generate an image of a bald man.</div>
                        <div class="diff-after">Generate an image of a <span class="diff-highlight">confident, successful executive</span> looking in the mirror.</div>
                    </div>
                `;

                // Mock Diff 5 (Agent 5)
                const diff5 = document.createElement('div');
                diff5.className = 'diff-card';
                diff5.innerHTML = `
                    <div class="diff-header">
                        <span>Video Ad Script Generator</span>
                        <span class="diff-agent-badge">Agent 5</span>
                    </div>
                    <div class="diff-content">
                        <div class="diff-before">Standard promotional video script without download option.</div>
                        <div class="diff-after">Engaging video script tailored to target persona, <span class="diff-highlight">images removed</span>, and <span class="diff-highlight">download option added</span>.</div>
                    </div>
                `;

                diffReport.appendChild(diff3);
                diffReport.appendChild(diff4);
                diffReport.appendChild(diff5);
                
                // Hide success message after a bit
                setTimeout(() => {
                    feedbackStatus.style.display = 'none';
                }, 4000);
            }, 1500);
        });
    }
    
    if (btnClearFeedback) {
        btnClearFeedback.addEventListener('click', () => {
            feedbackText.value = '';
            trackerContainer.style.display = 'none';
            feedbackStatus.style.display = 'none';
        });
    }
});
''')

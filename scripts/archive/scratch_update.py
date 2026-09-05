import sys
with open('static/index.html', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = False
for line in lines:
    if '<button class="tab-btn" data-tab="tab-creative">' in line:
        continue
    if '<!-- TAB: AGENT 4 IMAGE / CREATIVE GENERATION AGENT -->' in line:
        skip = True
    if skip and '<!-- TAB: AGENT 5 VIDEO ADS SCRIPT GENERATION AGENT -->' in line:
        skip = False
    
    if not skip:
        # replace Agent 5 with Agent 4
        if 'Agent 5:' in line:
            line = line.replace('Agent 5:', 'Agent 4:')
        if 'Agent 5' in line:
            line = line.replace('Agent 5', 'Agent 4')
        if 'AGENT 5' in line:
            line = line.replace('AGENT 5', 'AGENT 4')
        if '5. Video Ads' in line:
            line = line.replace('5. Video Ads', '4. Video Ads')
        new_lines.append(line)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

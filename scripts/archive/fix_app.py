import re

with open('static/app.js', 'r', encoding='utf-8') as f:
    js = f.read()

# Fix tabTitleMap
if "'tab-feedback'" not in js:
    js = js.replace("'tab-knowledge': 'Transcription Meta Ads • Knowledge Base & Upload'", "'tab-knowledge': 'Transcription Meta Ads • Knowledge Base & Upload',\n        'tab-feedback': 'Transcription Meta Ads • Agent 5'")

with open('static/app.js', 'w', encoding='utf-8') as f:
    f.write(js)

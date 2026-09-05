import re
import os

with open('static/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

# First, fix known real ? marks that shouldn't turn into s
text = text.replace('css?v=3.0', 'css_QUESTION_MARK_v=3.0')
text = text.replace('?? Agent 5', 'EMOJI_AGENT_5')
text = text.replace('?? Agent 4', 'EMOJI_AGENT_4')
text = text.replace('?? Agent 3', 'EMOJI_AGENT_3')
text = text.replace('? Agent 2', 'EMOJI_AGENT_2')
text = text.replace('?? Saved', 'EMOJI_SAVED')
text = text.replace('?? LangSmith', 'EMOJI_LANGSMITH')
text = text.replace('?? Knowledge', 'EMOJI_KNOWLEDGE')

# Emojis on metric chips
text = text.replace('? Pattern', 'EMOJI_THUMBS Pattern')
text = text.replace('Pattern? Learned', 'Patterns Learned')

# Emojis in tab bar (the script left some as is or messed them up)
text = text.replace('👤 Agent 1', 'EMOJI_AGENT_1')
text = text.replace('⚡ Agent 2', 'EMOJI_AGENT_2')
text = text.replace('🎯 Agent 3', 'EMOJI_AGENT_3')
text = text.replace('🎬 Agent 4', 'EMOJI_AGENT_4')
text = text.replace('🎯 Saved', 'EMOJI_SAVED')
text = text.replace('🔍 LangSmith', 'EMOJI_LANGSMITH')
text = text.replace('📚 Knowledge', 'EMOJI_KNOWLEDGE')

# Any other literal ? marks?
# Like placeholders "Paste Sir's text reply...\\n\\nExample:" wait, no question marks there.
# "What is your problem?" not there either.
# "Sir'? Review" - the ' was actually replaced so it became `Sir'?` instead of `Sir's`.

# Now replace all ? with s
text = text.replace('?', 's')

# Restore the placeholders
text = text.replace('css_QUESTION_MARK_v=3.0', 'css?v=3.0')
text = text.replace('EMOJI_AGENT_5', '🧠 Agent 5')
text = text.replace('EMOJI_AGENT_1', '👤 Agent 1')
text = text.replace('EMOJI_AGENT_2', '⚡ Agent 2')
text = text.replace('EMOJI_AGENT_3', '🎯 Agent 3')
text = text.replace('EMOJI_AGENT_4', '🎬 Agent 4')
text = text.replace('EMOJI_SAVED', '🎯 Saved')
text = text.replace('EMOJI_LANGSMITH', '🔍 LangSmith')
text = text.replace('EMOJI_KNOWLEDGE', '📚 Knowledge')
text = text.replace('EMOJI_THUMBS', '👍')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(text)

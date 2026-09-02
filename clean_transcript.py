"""
clean_transcript.py

Cleans a transcript .docx WITHOUT deleting any real content, speakers, or topics.

What it does:
  1. Collapses stutter / ASR-repeat artifacts, e.g.
       "तो तो हम देखेंगे"                      -> "तो हम देखेंगे"
       "अब अब हम अब हम सीखेंगे"                -> "अब हम सीखेंगे"
     It works by repeatedly finding a run of words (1 to 5 words long) that is
     immediately followed by an exact copy of itself, and collapsing the pair
     down to a single copy. This only removes duplicated words, never unique ones.
  2. Normalizes whitespace (multiple spaces -> one, trims edges) and tidies
     spacing around punctuation like Devanagari "।", commas, and question marks.
  3. Leaves everything else untouched: every speaker (Speaker A-F), every
     sentence, every topic (including casual/off-topic chit-chat), and the
     original paragraph/line structure are all preserved.

Usage:
    python3 clean_transcript.py input.docx output.docx
"""

import os
import re
import sys
import docx

def collapse_repeats(text: str, max_ngram: int = 5) -> str:
    """Collapse immediately-repeated word sequences (stutters), any length 1-5 words.
    Repeats until no more collapses are possible, so nested stutters
    (e.g. A A B A B -> A B A B -> A B) get fully cleaned."""
    words = text.split(" ")
    changed = True
    while changed:
        changed = False
        result = []
        i = 0
        n = len(words)
        while i < n:
            matched = False
            # try longest n-gram first so we don't break a longer repeated phrase
            max_size = min(max_ngram, (n - i) // 2)
            for size in range(max_size, 0, -1):
                if words[i:i + size] == words[i + size:i + 2 * size]:
                    # keep the surviving copy as separate word-tokens (not one
                    # merged string) so later passes can still match against
                    # its individual words
                    result.extend(words[i:i + size])
                    i += 2 * size
                    matched = True
                    changed = True
                    break
            if not matched:
                result.append(words[i])
                i += 1
        words = result
    return " ".join(words)


def tidy_whitespace_and_punctuation(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    # no space before punctuation
    text = re.sub(r"\s+([।,.?!])", r"\1", text)
    # ensure single space after punctuation if followed by a word char
    text = re.sub(r"([।,.?!])(?=\S)", r"\1 ", text)
    return text.strip()


def clean_paragraph_text(text: str) -> str:
    """Cleans one paragraph's text, keeping a leading 'Speaker X: ' label intact."""
    m = re.match(r"^(Speaker [A-Za-z]:\s*)(.*)$", text, flags=re.DOTALL)
    if m:
        label, body = m.group(1), m.group(2)
    else:
        label, body = "", text

    body = tidy_whitespace_and_punctuation(body)
    body = collapse_repeats(body)
    body = tidy_whitespace_and_punctuation(body)  # cleanup after collapsing

    return (label.strip() + " " + body).strip() if label else body


def clean_docx(input_path: str, output_path: str) -> None:
    if not os.path.exists(input_path):
        print(f"Error: File '{input_path}' not found.")
        print("Please replace 'input.docx' with the actual path or filename of your transcript file.")
        # Check for any .docx files in the current directory to help the user
        docx_files = [f for f in os.listdir('.') if f.endswith('.docx')]
        if docx_files:
            print("\nFound these .docx files in current directory:")
            for f in docx_files:
                print(f"  - {f}")
        sys.exit(1)

    doc = docx.Document(input_path)

    for para in doc.paragraphs:
        original = para.text
        if not original.strip():
            continue  # keep blank spacer paragraphs exactly as they are

        cleaned = clean_paragraph_text(original)
        if cleaned == original:
            continue

        # Rewrite the paragraph's runs with the cleaned text, keeping the
        # formatting (font, size, etc.) of the paragraph's first run.
        if para.runs:
            para.runs[0].text = cleaned
            for run in para.runs[1:]:
                run.text = ""
        else:
            para.add_run(cleaned)

    try:
        doc.save(output_path)
    except PermissionError:
        print(f"\nError: Permission denied when saving to '{output_path}'.")
        print("This usually happens because the output file is currently open in Microsoft Word or another application.")
        filename = os.path.basename(output_path)
        print(f"Please close '{filename}' in Word (or another application) and try running the command again.")
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print("Usage: python clean_transcript.py <your_transcript.docx> [output.docx]")
        sys.exit(1)
    
    inp = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) == 3 else os.path.splitext(inp)[0] + "_cleaned.docx"
    clean_docx(inp, out)
    print(f"Cleaned document saved to: {out}")


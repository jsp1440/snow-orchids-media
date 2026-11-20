"""Fixed pronunciations for the Snow Orchids recordings.

The voice engine does not know the name "Claus" and says it like "close". Kokoro accepts a spelled-out sound for any
word written as [word](/sounds/). This module adds those spellings to the text sent to the voice engine only; the
words shown on the page, and the word-by-word highlighting, are not changed.

The list lives in kokoro-cast.json under "pronunciations". American voices (a) and British voices (b) use slightly
different sound symbols, so each word has one spelling for each.
"""
import re


def _spelling(by_lang, code):
    return by_lang.get(code) or by_lang.get('a')


def _pattern(pron):
    words = sorted(pron, key=len, reverse=True)           # longest first, so "Claus's" wins over "Claus"
    if not words:
        return None
    return re.compile(r'(?<!\w)(' + '|'.join(re.escape(w) for w in words) + r')(?!\w)')


def apply(text, pron, code):
    """The text to give the voice engine, with the fixed pronunciations marked."""
    pat = _pattern(pron)
    if not pat:
        return text
    return pat.sub(lambda m: f'[{m.group(0)}](/{_spelling(pron[m.group(0)], code)}/)', text)


def tag(text, pron, code):
    """A short label for the fixes used in this passage (empty if none). It is part of the passage's recorded
    'voice id', so changing a pronunciation re-records exactly the passages that contain that word."""
    pat = _pattern(pron)
    if not pat:
        return ''
    used = sorted({m.group(0) for m in pat.finditer(text)})
    return ('+' + ','.join(f'{w}={_spelling(pron[w], code)}' for w in used)) if used else ''

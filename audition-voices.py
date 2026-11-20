#!/usr/bin/env python3
"""
Narrator voice audition for Snow Orchids (Kokoro-82M, free). Reads two real passages from Chapter 1 aloud in each
candidate voice, with the corrected pronunciation of "Claus", and saves one short clip per voice in audition/.
Nothing in the book is changed. Open audition/README.md on GitHub and tap a link to listen.
"""
import json, os, subprocess, sys, wave
import numpy as np
import kokoro_pron as kp

ROOT = os.path.dirname(os.path.abspath(__file__))
SR = 24000
PASSAGES = ['c1-p019-01', 'c1-p033-01']          # Mrs. Claus described; and "Mrs. Claus's greenhouse"
VOICES = [   # (voice, what it is)
    ('bm_george', 'the current narrator (British man), for comparison'),
    ('bf_emma', 'British woman, warm and clear: the closest match to the current storyteller feel'),
    ('af_heart', "American woman, Kokoro's highest-quality voice (Mrs. Claus uses it today, so she would need a new voice)"),
    ('af_nicole', 'American woman, soft and gentle'),
    ('af_sarah', 'American woman, friendly and bright'),
    ('bf_lily', 'British woman, light and young'),
]
SPEED = 0.95

plan = json.load(open(os.path.join(ROOT, 'audio-plan.json'), encoding='utf-8'))
cast = json.load(open(os.path.join(ROOT, 'kokoro-cast.json'), encoding='utf-8'))
PRON = cast.get('pronunciations', {})
byid = {s['id']: s for s in plan['segments']}
texts = [byid[i]['text'] for i in PASSAGES]

from kokoro import KPipeline
pipes = {}
def pipe(voice):
    if voice[0] not in pipes: pipes[voice[0]] = KPipeline(lang_code=voice[0], repo_id='hexgrad/Kokoro-82M')
    return pipes[voice[0]]

def speak(voice, text):
    parts = []
    for r in pipe(voice)(kp.apply(text, PRON, voice[0]), voice=voice, speed=SPEED, split_pattern=r'\n+'):
        a = r.audio
        if a is None: continue
        a = a.detach().cpu().numpy() if hasattr(a, 'detach') else np.asarray(a)
        parts.append(a.astype(np.float32))
    return np.concatenate(parts)

out = os.path.join(ROOT, 'audition'); os.makedirs(out, exist_ok=True)
gap = np.zeros(int(SR * 0.9), np.float32)
made, failed = [], []
for voice, why in VOICES:
    try:
        audio = np.concatenate([speak(voice, texts[0]), gap, speak(voice, texts[1])])
        wav = os.path.join(out, voice + '.wav'); mp3 = os.path.join(out, voice + '.mp3')
        with wave.open(wav, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-ac', '1', '-b:a', '64k', mp3], check=True); os.remove(wav)
        made.append((voice, why, len(audio) / SR)); print(f'  {voice}: {len(audio) / SR:.0f}s', flush=True)
    except Exception as err:
        failed.append(voice); print(f'  PROBLEM with {voice}: {type(err).__name__}: {err}', flush=True)

base = 'https://raw.githubusercontent.com/jsp1440/snow-orchids-media/main/audition/'
lines = ['# Narrator voice audition', '',
         'Tap a voice to listen (about 40 seconds each). Every clip reads the same two passages from Chapter 1 and uses the corrected "Claus".', '']
for voice, why, secs in made:
    lines += [f'- **[{voice}]({base}{voice}.mp3)**: {why}']
lines += ['', 'Passages read:', '']
for i, t in zip(PASSAGES, texts): lines += [f'> {t}', '']
open(os.path.join(out, 'README.md'), 'w', encoding='utf-8').write('\n'.join(lines))
print('Done.' + (f' Problems: {", ".join(failed)}' if failed else ''))
sys.exit(1 if failed and not made else 0)

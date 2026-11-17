#!/usr/bin/env python3
"""
Snow Orchids cast recording with Kokoro-82M (open-source voices, Apache 2.0). Free: no account, no key, no credits.
Runs in the snow-orchids-media repository (GitHub Actions). Reads audio-plan.json and kokoro-cast.json, and writes
audio/c<N>/<passage>.mp3, a .json of word timings beside each, and audio/produced.json. The storybook plays these files.

  python kokoro-audio.py --chapter 1 --sample      the Chapter 1 sample passages
  python kokoro-audio.py --chapter 3               all of chapter 3
  python kokoro-audio.py --chapter 1 --dry-run     list what would be recorded, record nothing
Passages already recorded with the same text and the same voice are skipped, so runs can be repeated safely.
"""
import argparse, json, os, re, subprocess, sys, time, wave
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
SR = 24000
ap = argparse.ArgumentParser()
ap.add_argument('--chapter', type=int, required=True)
ap.add_argument('--sample', action='store_true')
ap.add_argument('--dry-run', action='store_true')
ap.add_argument('--max-minutes', type=float, default=300)
args = ap.parse_args()

plan = json.load(open(os.path.join(ROOT, 'audio-plan.json'), encoding='utf-8'))
cast = json.load(open(os.path.join(ROOT, 'kokoro-cast.json'), encoding='utf-8'))
segs = [s for s in plan['segments'] if s['chapter'] == args.chapter]
if args.sample:
    segs = [s for s in segs if s['chapter'] == plan['sample']['chapter'] and s['para'] in plan['sample']['paragraphs']]

def voice_for(role):
    c = cast['roles'].get(role) or cast['default']
    return c['voice'], float(c.get('speed', 1.0))

OUT = os.path.join(ROOT, 'audio')
os.makedirs(OUT, exist_ok=True)
ppath = os.path.join(OUT, 'produced.json')
produced = json.load(open(ppath, encoding='utf-8')) if os.path.exists(ppath) else {'version': 1, 'segments': {}}
def done(s):
    p = produced['segments'].get(s['id']); v, sp = voice_for(s['role'])
    return bool(p) and p.get('hash') == s['hash'] and p.get('voiceId') == f'kokoro:{v}@{sp}'
todo = [s for s in segs if not done(s)]
print(f"Chapter {args.chapter}{' sample' if args.sample else ''}: {len(segs)} passages, {len(todo)} to record, {sum(len(s['text']) for s in todo):,} characters.")
by = {}
for s in todo:
    v, _ = voice_for(s['role']); by[f"{s['role']} -> {v}"] = by.get(f"{s['role']} -> {v}", 0) + 1
for k, n in sorted(by.items(), key=lambda x: -x[1]): print(f'  {k}: {n}')
if args.dry_run or not todo:
    print('Nothing recorded.' if args.dry_run else 'Everything here is already recorded.'); sys.exit(0)

from kokoro import KPipeline
pipes = {}
def pipe(voice):
    code = voice[0]   # 'a' American, 'b' British
    if code not in pipes: pipes[code] = KPipeline(lang_code=code, repo_id='hexgrad/Kokoro-82M')
    return pipes[code]

def char_timings(text, results, offsets):
    """Start and end time of every character of `text`, from Kokoro's word timestamps."""
    n = len(text); start = [None] * n; end = [None] * n; cur = 0
    for r, off in zip(results, offsets):
        for t in (getattr(r, 'tokens', None) or []):
            w = (getattr(t, 'text', '') or '').strip(); ts, te = getattr(t, 'start_ts', None), getattr(t, 'end_ts', None)
            if not w or ts is None or te is None: continue
            pos = text.find(w, cur)
            if pos < 0 or pos - cur > 60: continue
            for i in range(pos, pos + len(w)): start[i] = off + float(ts); end[i] = off + float(te)
            cur = pos + len(w)
    return start, end

def fill(start, end, total):
    """Give untimed characters (spaces, punctuation, unmatched words) sensible times; keep times non-decreasing."""
    n = len(start)
    if not any(v is not None for v in start):          # no word timings at all: spread evenly
        return [total * i / max(1, n) for i in range(n)], [total * (i + 1) / max(1, n) for i in range(n)]
    last_start = last_end = 0.0
    for i in range(n):
        if start[i] is None: start[i] = end[i] = last_end          # spaces and punctuation sit at the end of the word before
        start[i] = max(start[i], last_start); end[i] = max(end[i], start[i])
        last_start, last_end = start[i], end[i]
    return [round(x, 3) for x in start], [round(x, 3) for x in end]

t0 = time.time(); made = 0; failed = []
for s in todo:
    if (time.time() - t0) / 60 > args.max_minutes: print('Stopping at the time limit; run again to continue.'); break
    voice, speed = voice_for(s['role'])
    try:
        results = list(pipe(voice)(s['text'], voice=voice, speed=speed, split_pattern=r'\n+'))
        chunks, offsets, t = [], [], 0.0
        for r in results:
            a = r.audio
            if a is None: continue
            a = a.detach().cpu().numpy() if hasattr(a, 'detach') else np.asarray(a)
            offsets.append(t); chunks.append(a.astype(np.float32)); t += len(a) / SR
            gap = np.zeros(int(SR * 0.25), np.float32); chunks.append(gap); t += 0.25      # a breath between lines of verse
        if not chunks: raise RuntimeError('no audio was produced')
        audio = np.concatenate(chunks[:-1]); total = len(audio) / SR
        d = os.path.join(OUT, f"c{s['chapter']}"); os.makedirs(d, exist_ok=True)
        wav = os.path.join(d, s['id'] + '.wav'); mp3 = os.path.join(d, s['id'] + '.mp3')
        with wave.open(wav, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', wav, '-ac', '1', '-b:a', '64k', mp3], check=True); os.remove(wav)
        st, en = fill(*char_timings(s['text'], [r for r in results if r.audio is not None], offsets), total)
        json.dump({'chars': s['text'], 'start': st, 'end': en}, open(os.path.join(d, s['id'] + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        produced['segments'][s['id']] = {'hash': s['hash'], 'voiceId': f'kokoro:{voice}@{speed}', 'chars': len(s['text']), 'timings': True}
        produced['model'] = 'kokoro-82m'; produced['updated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        json.dump(produced, open(ppath, 'w', encoding='utf-8'), indent=1)
        made += 1
        print(f"  recorded {s['id']}  {s['role']} ({voice})  {total:.1f}s")
    except Exception as err:            # one bad passage must not stop the chapter; it is listed and can be recorded again
        failed.append(s['id']); print(f"  PROBLEM with {s['id']} ({s['role']}, {voice}): {type(err).__name__}: {err}", flush=True)
print(f'Done: {made} passages recorded in {(time.time() - t0) / 60:.1f} minutes.' + (f' {len(failed)} had a problem: {", ".join(failed)}' if failed else ''))
sys.exit(1 if failed and not made else 0)

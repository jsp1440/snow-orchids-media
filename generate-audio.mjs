#!/usr/bin/env node
/**
 * Snow Orchids cast recording, for the snow-orchids-media repository (Famous AI does not sync this one).
 * Reads audio-plan.json (exported from the storybook) and writes audio/c<N>/<passage>.mp3 + .json timings
 * and audio/produced.json. The storybook plays these files from this repository.
 *
 * Free (no speech, no credits):
 *   node generate-audio.mjs --chapter 1 --sample          estimate for the Chapter 1 sample
 *   node generate-audio.mjs                               estimate for the whole book
 *   ELEVENLABS_API_KEY=... node generate-audio.mjs --check-voices    confirm every approved voice exists
 * Spends credits (every guard required):
 *   ELEVENLABS_API_KEY=... node generate-audio.mjs --chapter 1 --sample --max-chars 1300 --generate --confirm
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const fmt = (n) => n.toLocaleString('en-US');

// ElevenLabs pricing FAQ (checked November 2026): Multilingual v2 = 1 credit per character.
const MODEL = opt('model', 'eleven_multilingual_v2');
const RATE = { eleven_multilingual_v2: 1, eleven_v3: 1, eleven_v4: 1, eleven_flash_v2_5: 1 }[MODEL] ?? 1;   // Flash may cost less (0.5-1); estimate at 1
const plan = JSON.parse(readFileSync(join(ROOT, 'audio-plan.json'), 'utf8'));
const OUT = join(ROOT, 'audio');

let segs = plan.segments;
if (opt('chapter')) segs = segs.filter(s => s.chapter === Number(opt('chapter')));
if (flag('sample')) segs = segs.filter(s => s.chapter === plan.sample.chapter && plan.sample.paragraphs.includes(s.para));
const assigned = segs.filter(s => s.voiceId), unassigned = segs.filter(s => !s.voiceId);
const chars = assigned.reduce((n, s) => n + s.text.length, 0);

console.log(`\nSnow Orchids cast recording: ${flag('sample') ? 'Chapter 1 sample' : opt('chapter') ? `chapter ${opt('chapter')}` : 'all nine chapters'}`);
console.log(`Model: ${MODEL}`);
console.log(`Passages: ${fmt(segs.length)}   with an approved voice: ${fmt(assigned.length)}   without: ${fmt(unassigned.length)}`);
console.log(`Characters to generate: ${fmt(chars)}   Estimated credits: ${fmt(Math.ceil(chars * RATE))}`);
const byVoice = {};
for (const s of assigned) byVoice[s.slot] = (byVoice[s.slot] ?? 0) + s.text.length;
console.log('\nCharacters by voice:'); Object.entries(byVoice).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(40)} ${fmt(v).padStart(8)}`));
if (unassigned.length) console.log(`\nSkipped, no approved voice yet: ${unassigned.map(s => `${s.id} (${s.role})`).join(', ')}`);

const KEY = process.env.ELEVENLABS_API_KEY;

if (flag('check-voices')) {
  if (!KEY) { console.error('\nNo ELEVENLABS_API_KEY secret found. Add it in this repository: Settings > Secrets and variables > Actions.'); process.exit(1); }
  const unique = new Map();
  for (const v of plan.voices) unique.set(v.voiceId, [...(unique.get(v.voiceId) ?? []), v.slot]);
  console.log(`\nChecking ${unique.size} approved voice IDs with ElevenLabs (free lookup, no speech):`);
  let missing = 0;
  for (const [id, slots] of unique) {
    const r = await fetch(`https://api.elevenlabs.io/v1/voices/${id}`, { headers: { 'xi-api-key': KEY } });
    if (r.ok) { const v = await r.json(); console.log(`  OK       ${id}  ${String(v.name).slice(0, 38).padEnd(38)}  ${slots.join(', ')}`); }
    else { missing++; console.log(`  MISSING  ${id}  (HTTP ${r.status})  ${slots.join(', ')}`); }
  }
  if (missing) { console.error(`\n${missing} approved voice(s) not found. Add them to "My Voices" in ElevenLabs before recording.`); process.exit(3); }
  console.log('All approved voices are available.');
}

if (!flag('generate')) { console.log('\nNothing was sent to ElevenLabs for speech, and no credits were used.\n'); process.exit(0); }

const MAX = Number(opt('max-chars', '0'));
const problems = [];
if (!flag('confirm')) problems.push('add --confirm');
if (!opt('chapter')) problems.push('name one --chapter');
if (!MAX) problems.push('set a --max-chars cap');
if (!KEY) problems.push('add the ELEVENLABS_API_KEY secret');
if (MAX && chars > MAX) problems.push(`this run needs ${fmt(chars)} characters, more than the cap of ${fmt(MAX)}`);
if (problems.length) { console.error(`\nNot recording: ${problems.join('; ')}.`); process.exit(1); }

const producedPath = join(OUT, 'produced.json');
mkdirSync(OUT, { recursive: true });
const produced = existsSync(producedPath) ? JSON.parse(readFileSync(producedPath, 'utf8')) : { version: 1, model: MODEL, segments: {} };
const dict = process.env.ELEVENLABS_PRONUNCIATION_DICTIONARY_ID ? [{ pronunciation_dictionary_id: process.env.ELEVENLABS_PRONUNCIATION_DICTIONARY_ID }] : undefined;
let spent = 0;
for (let i = 0; i < assigned.length; i++) {
  const s = assigned[i];
  if (produced.segments[s.id]?.hash === s.hash) continue;          // already recorded, unchanged
  if (spent + s.text.length > MAX) { console.log(`Stopping at the cap (${fmt(spent)} characters used).`); break; }
  const prev = assigned[i - 1]?.chapter === s.chapter ? assigned[i - 1].text : undefined;
  const next = assigned[i + 1]?.chapter === s.chapter ? assigned[i + 1].text : undefined;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${s.voiceId}/with-timestamps?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': KEY },
    body: JSON.stringify({ text: s.text, model_id: MODEL, previous_text: prev, next_text: next, ...(dict ? { pronunciation_dictionary_locators: dict } : {}) }),
  });
  if (!res.ok) { console.error(`ElevenLabs error ${res.status} on ${s.id}: ${(await res.text()).slice(0, 300)}`); break; }
  const data = await res.json();
  const dir = join(OUT, `c${s.chapter}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${s.id}.mp3`), Buffer.from(data.audio_base64, 'base64'));
  const a = data.alignment;
  writeFileSync(join(dir, `${s.id}.json`), JSON.stringify(a ? { chars: a.characters.join(''), start: a.character_start_times_seconds, end: a.character_end_times_seconds } : null));
  produced.segments[s.id] = { hash: s.hash, voiceId: s.voiceId, chars: s.text.length, timings: !!a };
  produced.model = MODEL; produced.updated = new Date().toISOString();
  writeFileSync(producedPath, JSON.stringify(produced, null, 1));
  spent += s.text.length;
  console.log(`  recorded ${s.id} (${s.slot}, ${s.text.length} characters)`);
}
console.log(`\nDone. Characters sent this run: ${fmt(spent)}.`);

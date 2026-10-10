# Text-to-speech (TTS)

Audio units are rendered by a `TtsClient` (`packages/api/src/providers/tts.ts`), selected by `TTS_PROVIDER`.

| Provider | Quality (German) | Runs | Voice (`TTS_VOICE`) |
|---|---|---|---|
| `silent` | — (silent WAV, realistic length) | in-process | ignored |
| `piper` | robotic | `.piper/venv`, fast | Piper voice name, e.g. `de_DE-thorsten-high` |
| `chatterbox` | natural | `.chatterbox/venv`, slower than real time | reference WAV (~10 s) or built-in voice |
| `qwen` | natural | `.qwen-tts/venv` | reference WAV, `design:<description>` or preset speaker |

`chatterbox` and `qwen` are local Python servers (`scripts/tts/*_server.py`) with Piper's contract:
`POST /synthesize {text, length_scale}` → WAV, `GET /health`. The API sends the script in sentence chunks
(Chatterbox ≤280 chars, Qwen ≤500) and joins the WAVs. Raw renders are cached on disk
(`.chatterbox/cache`, `.qwen-tts/cache`) by voice + text; `length_scale` only time-stretches cached audio, so the
pipeline's 3–5 min duration fitting doesn't re-generate. Both run on Apple Silicon (MPS), batch only — not for production
servers without a GPU.

## Setup

Requires `brew install uv` (creates the venvs; Chatterbox needs Python 3.11, Qwen 3.12). First start installs packages
and downloads the model (several GB).

```bash
# .env
TTS_PROVIDER=qwen              # or chatterbox
TTS_URL=http://localhost:5100/synthesize
TTS_VOICE=design:Warme, ruhige Frauenstimme, Mitte 30, erklärt sachlich und freundlich
TTS_QWEN_SIZE=1.7B             # 0.6B = faster, lower quality
TTS_LENGTH_SCALE=1
```

`pnpm dev:all` starts the selected server automatically (log: `/tmp/wizzn-<provider>.log`).
Standalone: `pnpm tts:server qwen` / `pnpm tts:server chatterbox` (foreground; extra args override `.env`,
e.g. `--port 5101 --voice Serena`).

## Qwen voices

| `TTS_VOICE` | Model | Notes |
|---|---|---|
| `voices/anna.wav` | Base (clone) | Put the transcript in `voices/anna.txt` for best quality; without it only the speaker embedding is used. ~3+ s clean speech. |
| `design:<description>` | VoiceDesign → Base | Renders one reference sample from the description at startup (cached), then clones it → identical voice across chunks and units. |
| `Serena` or `Serena\|ruhig, sachlich` | CustomVoice | Preset speakers (Vivian, Serena, Uncle_Fu, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee) + optional style instruction. Not native German speakers. |

Fix a designed voice as a file (so it survives cache wipes and can be versioned/reused):

```bash
pnpm tts:voice voices/anna.wav --voice "design:Warme, ruhige Frauenstimme, Mitte 30"
# → voices/anna.wav + voices/anna.txt; then TTS_VOICE=voices/anna.wav
```

Changing the voice or model size changes the cache key → everything re-renders.

## Chatterbox voices

`TTS_VOICE=voices/ref.wav` clones from ~10 s of clean German speech (mono, ≥24 kHz, no music/reverb). Anything that is
not a file → built-in voice (slight accent). Tuning: `--exaggeration`, `--cfg-weight`, `--temperature` on the server.

Reference audio rights: only voices you have consent for (own recordings, paid speakers) or CC0 (Thorsten-Voice).

## Testing & comparing

`tts:entry` re-renders one unit (or ad-hoc text) and writes WAV + MP3 + loudness, DB untouched:

```bash
pnpm tts:entry --text "Heute geht es um Photosynthese…"     # uses .env
pnpm tts:entry <unitId>                                     # script from the unit
pnpm tts:entry <unitId> --fit                               # with 3–5 min duration fitting
```

Output: `packages/api/tts-debug/<id>[.<provider>].raw.wav` / `.mp3`.

A/B two engines on different ports:

```bash
pnpm tts:server chatterbox --port 5100      # terminal 1
pnpm tts:server qwen --port 5101            # terminal 2
pnpm tts:entry <unitId> --provider chatterbox --url http://localhost:5100/synthesize
pnpm tts:entry <unitId> --provider qwen --url http://localhost:5101/synthesize
```

Apply a new engine/voice to existing units: `pnpm audio:rerender` (see README).

## Commands

| Command | What it does |
|---|---|
| `pnpm tts:server <chatterbox\|qwen> [args]` | Install (first time) + run a TTS server in the foreground |
| `pnpm tts:voice <out.wav> --voice "design:…"` | Qwen: render a designed reference voice to a file and exit |
| `pnpm tts:entry …` | Render one unit / text to `tts-debug/`, options `--fit`, `--provider`, `--url` |
| `pnpm audio:rerender` | Re-render stored audio units with current settings |

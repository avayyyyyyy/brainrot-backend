# Brainrot Backend

Server-side API that generates short-form "brainrot" scripts with OpenAI and then converts those scripts into stylized speech locally with ONNX-based text-to-speech (TTS) models. The backend exposes simple HTTP endpoints so any client (web, mobile, command line) can request viral-ready copy and immediately receive an audio file ready for playback or editing.

## Key Features

1. **Viral script generation** – Streams GPT-4.1-nano completions with a custom system prompt tuned for chaotic, high-retention monologues.@src/services/script.service.ts#4-21 @src/constants/prompts.ts#1-48
2. **Local speech synthesis** – Runs a Supertonic TTS pipeline entirely on-device using ONNX Runtime for duration prediction, text encoding, latent diffusion, and vocoding.@src/lib/tts.ts#1-189 @src/services/tts.service.ts#1-40
3. **Voice styles & tuning** – Ships with precomputed voice embeddings (e.g., `voice_styles/F2.json`) plus knobs for inference steps and playback speed.@src/config/env.ts#17-23 @voice_styles/F2.json#1-200
4. **Streaming-friendly API** – `/api/generate` streams script text chunk-by-chunk and `/api/tts` responds with raw WAV bytes for easy piping to a player.@src/controllers/script.controller.ts#4-30 @src/controllers/tts.controller.ts#4-33

## Architecture Overview

```text
src/
├─ app.ts           Express app + middleware setup
├─ index.ts         HTTP server bootstrap
├─ config/env.ts    Environment loading & model paths
├─ routes/          API route registration
├─ controllers/     Request validation & response handling
├─ services/        Script + TTS orchestration
└─ lib/             Low-level integrations (OpenAI + Supertonic)
```

- **Express server** wires routes under `/api` and health checks under `/health`.@src/app.ts#1-10 @src/routes/index.ts#1-17
- **OpenAI client** streams chat completions using the bespoke prompt for tonal control.@src/lib/openai.ts#1-7 @src/services/script.service.ts#4-21
- **Supertonic TTS** lazily loads ONNX models (`models/`) and a default voice embedding (`voice_styles/F2.json`), then stitches chunked audio with natural silence gaps.@src/lib/tts.ts#15-189 @src/services/tts.service.ts#1-39

## Prerequisites

- Node.js 18+ (required by `onnxruntime-node`).
- pnpm 8+ (recommended because the repo ships with a `pnpm-lock.yaml`).
- Access to the local ONNX models referenced in `models/` and at least one voice style JSON in `voice_styles/`.

## Setup

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Provide model assets**
   - Place ONNX models (`duration_predictor.onnx`, `text_encoder.onnx`, `vector_estimator.onnx`, `vocoder.onnx`, etc.) plus `tts.json` and `unicode_indexer.json` inside `models/`.
   - Add at least one voice style JSON file under `voice_styles/` (see provided `F2.json`, `M1.json`, etc.).

3. **Configure environment** – Create a `.env` file in the project root:

   ```env
   OPENAI_API_KEY=sk-...
   PORT=3001                # optional, defaults to 3001
   TTS_MODEL_DIR=./models   # optional override
   TTS_VOICE_FILE=./voice_styles/F2.json
   ```

   Required variables are validated at startup.@src/config/env.ts#4-23

## Available Scripts

| Command       | Description                                 |
| ------------- | ------------------------------------------- |
| `pnpm dev`    | Run the server with ts-node (hot reload).   |
| `pnpm build`  | Compile TypeScript to `dist/`.              |
| `pnpm start`  | Serve the compiled JavaScript from `dist/`. |
| `pnpm format` | Format the codebase with Prettier.          |

## API Reference

Base URL: `http://localhost:3001`

### Health Check

- **GET** `/health`
- Returns `{ "status": "ok" }` to confirm the process is running.@src/routes/index.ts#12-16

### Generate a Script

- **POST** `/api/generate`
- **Body**

  ```json
  { "prompt": "Tell me about my villain arc at summer camp" }
  ```

- **Response**: streamed text chunks (Transfer-Encoding: chunked). Capture the stream client-side to render in real time.

### Synthesize Speech

- **POST** `/api/tts`
- **Body**

  ```json
  {
    "text": "I just accidentally joined a cult.",
    "speed": 1.0,
    "steps": 12
  }
  ```

- **Response**: `audio/wav` file plus `X-Audio-Duration` header containing the clip length in seconds.@src/controllers/tts.controller.ts#4-32
- `speed` slows/speeds playback; `steps` controls diffusion iterations (trade speed for fidelity).@src/services/tts.service.ts#31-39

#### cURL Examples

```bash
# Stream a script
curl -N -X POST http://localhost:3001/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"give me a chaotic apology"}'

# Download a WAV
curl -o brainrot.wav -X POST http://localhost:3001/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"I broke the simulation and it broke back."}'
```

## Voice Styles & Customization

- Voice style JSON files store tensors (`style_ttl`, `style_dp`) that influence tone and pacing. Swap the file referenced by `TTS_VOICE_FILE` to change the voice.@src/lib/tts.ts#52-66 @src/config/env.ts#17-23
- Add new files under `voice_styles/` to experiment with different deliveries (e.g., calm, chaotic, masc/fem energy).

## Deployment Notes

1. Run `pnpm build` and deploy the `dist/` output along with the `models/` + `voice_styles/` directories.
2. Ensure the host has enough memory for ONNX Runtime (hundreds of MB per session) and allows filesystem access to the model assets.
3. Provide the same `.env` values used locally; sensitive keys (OpenAI) should come from your secret manager.

## Troubleshooting

- **Missing env var** – Startup will throw `Missing required environment variable: OPENAI_API_KEY` until `.env` (or host env) is populated.@src/config/env.ts#6-12
- **Model load hangs** – The `TTSService` uses a lazy `ensureLoaded` gate; if requests pile up before models finish loading, they briefly wait until the first load completes.@src/services/tts.service.ts#9-29
- **Audio glitches** – Adjust `steps` (higher = cleaner) or `speed` (<1 = slower, >1 = faster). Also verify voice style tensors were exported correctly.

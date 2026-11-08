# Speech-to-Text Remote — Chrome Extension

A Chrome side-panel extension that transcribes speech with [Qwen3-ASR 1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B).
The model runs in a Docker container on an Intel GPU (XPU) server; the extension on your PC only sends the audio to it.

Sister project of [voice-clone-remote](https://github.com/paulchi-intel/voice-clone-remote) (text-to-speech), with the same look and workflow.

## Features

- 🎧 **Any audio file** — drop or pick wav, mp3, m4a, aac, ogg, opus, webm, flac (up to 200 MB)
- 🌐 **Language** — auto-detect, or pick one of 14 languages (Chinese, English, Cantonese, Japanese, Korean, …) for better accuracy
- 繁 / 简 **Chinese script follows the UI** — with the UI in 繁體中文 the transcript is Traditional (Taiwan wording); in 简体中文 it is Simplified
- 📋 **Task queue** — enqueue several files; they run one at a time
- ⏹ / ↺ **Stop / Retry** — abort or retry any task
- ↕ **Drag-to-reorder** — grab the handle on the left of a waiting task
- 📝 **Copy & expand** — hover the transcript to copy it or expand long text
- 🔔 **Update notice** — a banner appears when a newer GitHub Release exists
- 🌐 **UI languages** — English, 繁體中文, 简体中文

---

## Architecture

```
Chrome extension (your PC)
  sidepanel.js  ──HTTP──▶  http://<SERVER_IP>:17495
                                   │
                    server: container speech-to-text-asr
                         server/asr_server.py
                         ffmpeg → 16 kHz mono WAV → Qwen3-ASR 1.7B on one Intel GPU (XPU)
                         → OpenCC (Traditional / Simplified Chinese)
                                   │
                             transcript (JSON)  ──▶  queue card
```

API:

| Endpoint | Description |
|---|---|
| `GET /health` | `{"status":"ok","model_loaded":true,"device":"xpu","languages":[…]}` |
| `POST /transcribe` | body `{"audio_base64","filename","language","script"}` (`language` = `auto` or a code such as `zh`, `en`; `script` = `zh-TW`, `zh-CN` or empty) → `{"status":"ok","text","raw_text","language","duration_sec","elapsed_sec"}` |
| `POST /convert` | body `{"texts":[…],"script"}` → `{"status":"ok","texts":[…]}` — re-renders Chinese text in Traditional/Simplified (OpenCC) |

---

## Server setup

Files are in [`server/`](server/). On the GPU server:

```bash
mkdir -p ~/speech-to-text-remote && cd ~/speech-to-text-remote/server   # copy server/ here first
docker compose up -d --build
docker logs -f speech-to-text-asr     # first start downloads the model (~5 GB) into the speech-to-text-models volume
```

Edit `docker-compose.yml` first so the `devices:` entry points at a GPU render node with free memory (`/dev/dri/renderD128`, `renderD129`, …; the model needs about 5 GB) and `group_add` matches your host's `render` group id (`getent group render`).

Docker publishes `0.0.0.0:17495` through its own iptables rules, which bypass ufw. Check it:

```bash
curl --noproxy '*' http://<SERVER_IP>:17495/health
```

Notes:
- The service has **no authentication** — anyone who can reach port 17495 can use it. Keep it on a trusted network.
- The model cache lives in the Docker volume `speech-to-text-models`, so restarts don't re-download.
- Environment knobs: `ASR_MAX_NEW_TOKENS` (default 4096, raise for very long audio), `ASR_MAX_UPLOAD_MB` (default 200).

---

## Extension setup (your PC)

```bash
git clone https://github.com/paulchi-intel/speech-to-text-remote.git
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** → select this folder
4. Click the **Speech-to-Text Remote** icon to open the side panel
5. On first run the **Server** field opens automatically — enter `http://<SERVER_IP>:17495` and press Enter. Chrome asks permission for that one address; the address is stored only in your browser (`chrome.storage`), not in this repository
6. Wait for "ready", then follow the numbered steps: choose an audio file → choose language → **Transcribe**

---

## Update

The side panel checks the latest GitHub Release when it opens. When a newer version exists, a banner appears with a **Download** button that fetches the release ZIP; **×** dismisses that version.

Chrome does not let unpacked extensions update themselves, so to apply the update: unzip the download over your existing folder, then click **Reload** on the extension in `chrome://extensions`. The queue and settings stay in `chrome.storage.local`.

## Release

1. Update `version` in `manifest.json` and commit it.
2. Create and push a matching tag, e.g. `git tag v1.0.0 && git push origin v1.0.0`.
3. GitHub Actions ([`release.yml`](.github/workflows/release.yml)) checks the tag matches `manifest.json` and that the JavaScript parses, then publishes `speech-to-text-remote-vX.Y.Z.zip` and its SHA-256 checksum.

---

## Task Queue Controls

| Control | Behaviour |
|---|---|
| ⏹ | Abort an in-flight transcription |
| ↺ | Re-queue a stopped or failed task |
| ✕ | Remove task (aborts if transcribing) |
| ⠿ drag | Reorder waiting tasks (grab the handle) |
| hover text | Shows copy and expand buttons |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Set the server address first" | Open the ⚙ next to the status and enter the server address |
| "Server unreachable" | Check `docker ps` on the server shows `speech-to-text-asr` running, and `curl --noproxy '*' http://<SERVER_IP>:17495/health` answers |
| Works with curl on the server but not from Chrome | Your PC's proxy may be intercepting the server address; add it to the proxy bypass list, or use an SSH tunnel (`ssh -L 17495:localhost:17495 <user>@<SERVER_IP>`) and set Server to `http://localhost:17495` |
| Stuck on "loading the model" | First run downloads ~5 GB — watch `docker logs -f speech-to-text-asr` |
| Model fails to load (out of memory) | The chosen GPU is full; point `devices:` in `docker-compose.yml` at another render node |
| Wrong language detected | Pick the language in step 2 instead of Auto detect |

---

## License

MIT — see [LICENSE](LICENSE)

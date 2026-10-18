# Converza load test

Opens N fake participants (headless Chrome with a fake camera), joins them all
to one meeting through the guest flow, and reads each participant's WebRTC
stats: video streams sent, upload/download speed, frame rate, resolution,
freezes, and why WebRTC lowered quality.

## Run it

1. Start the backend: `cd backend && npm run dev` (needs `MONGODB_URI` in `backend/.env`).
2. Serve the production build of the frontend: `cd frontend && npm run build && npx serve -s build -l 3000`.
   Don't use `npm start` for measurements: React StrictMode runs effects twice
   in development and the dev build is slower, so numbers won't be comparable.
3. In another terminal:

```bash
cd loadtest
npm install
node run.mjs --url http://localhost:3000 --sizes 2,4,6,8 --label mesh
```

Results are printed and saved to `results/<label>-<date>.json`.

## Options

| Option | Default | Meaning |
|---|---|---|
| `--url` | `http://localhost:3000` | Where the frontend is running |
| `--sizes` | `2,4,6,8` | Participant counts to test, one run each |
| `--settle` | `20` | Seconds to wait after everyone joins, so video quality stabilises |
| `--window` | `15` | Seconds over which stats are measured |
| `--label` | `run` | Name used for the results file |
| `--repeat` | `1` | Run every size this many times (sizes are interleaved) |
| `--api` | same as `--url` | Backend address for `/api/v1/sfu/stats`, to record SFU server CPU. Locally: `http://localhost:8000`. Behind Nginx the default is right. |
| `--show` | off | Open visible Chrome windows so you can watch the bots (uses more CPU, so don't use it for real measurements) |

Set `CHROME_PATH` if Chrome is not at `C:/Program Files/Google/Chrome/Application/chrome.exe`.

## Comparison report

```bash
node report.mjs results/phase6-mesh-<date>.json results/phase6-sfu-<date>.json --out results/REPORT.md
```

Each file becomes a column; with `--repeat`, values are the median across
repeats with the range in brackets.

## Full-app test

`full-app.mjs` starts the real backend (`backend/src/app.js`) on a temporary
in-memory MongoDB, serves the frontend build, and has fake users register,
log in, join from home, let a guest join the same meeting, leave, check
history and log out. It needs `npm run build` in `frontend/` and free ports
3000 and 8000.

```bash
npm run e2e
```

This runs it twice: SFU off (as on Render) and SFU on (as on EC2).

## Feature checklist

`features.mjs` runs the meeting checklist with fake participants: names,
live video, chat, camera and mic toggles (SFU only), screen share, late
joiner, refresh, leave, and separate meetings staying separate.

```bash
node features.mjs --mode sfu
node features.mjs --mode mesh
```

`--mode` is what you expect the page to use: `sfu` when the backend's SFU
is running, `mesh` when it isn't (the page then falls back to peer-to-peer).

## Reading the results

All participants run on one computer, so its CPU is shared by everyone, and
traffic goes over localhost, so there is no real internet limit. Compare runs
made on the same machine (for example mesh vs SFU); don't treat the numbers as
what each real user would see on their own laptop.

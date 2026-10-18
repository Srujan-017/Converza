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
| `--show` | off | Open visible Chrome windows so you can watch the bots (uses more CPU, so don't use it for real measurements) |

Set `CHROME_PATH` if Chrome is not at `C:/Program Files/Google/Chrome/Application/chrome.exe`.

## Reading the results

All participants run on one computer, so its CPU is shared by everyone, and
traffic goes over localhost, so there is no real internet limit. Compare runs
made on the same machine (for example mesh vs SFU); don't treat the numbers as
what each real user would see on their own laptop.

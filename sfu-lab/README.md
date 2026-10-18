# Converza SFU lab

A minimal video call built on a mediasoup SFU, kept separate from the Converza
app. It exists to learn the SFU pieces and to prove that each participant
uploads one video no matter how many people join.

| File | What it shows |
|---|---|
| `server.mjs` | Worker, one Router per room, two Transports per person, Producers and Consumers, cleanup on leave |
| `client.js` | mediasoup-client Device, send/receive transports, producing camera + mic, consuming others |
| `verify.mjs` | Joins N fake participants and records uploads, downloads, fps, resolution, freezes and SFU server CPU |

## Try it

```bash
cd sfu-lab
npm install
npm start
```

Open `http://localhost:4000/?room=test` in two or more tabs (use headphones to
avoid echo). The line under the title shows "Videos I upload", which stays at
1 however many tabs join.

## Measure it

With `npm start` running, in another terminal:

```bash
node verify.mjs --sizes 2,4,6,8 --label sfu-lab
```

Results are saved in `results/`. All fake participants run on one computer,
so compare against the mesh baseline in `../loadtest/results` from the same
machine rather than treating these as real-world numbers.

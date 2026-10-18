// Converza load test: N fake participants join one meeting, then we read
// each participant's WebRTC stats over a fixed window.
//
// Usage: node run.mjs --url http://localhost:3000 --sizes 2,4,6,8 --label mesh
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { ensureFakeCameraFile } from "./fakeCamera.mjs";

const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, arg, i, all) => {
        if (arg.startsWith("--")) pairs.push([arg.slice(2), all[i + 1]]);
        return pairs;
    }, [])
);

const BASE_URL = (args.url || "http://localhost:3000").replace(/\/+$/, "");
const SIZES = (args.sizes || "2,4,6,8").split(",").map(Number);
const SETTLE_SECONDS = Number(args.settle || 20);
const WINDOW_SECONDS = Number(args.window || 15);
const LABEL = args.label || "run";
const CHROME_PATH = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in every page before the app loads: remember every RTCPeerConnection
// the app creates so we can read its stats later.
const trackPeerConnections = () => {
    const Original = window.RTCPeerConnection;
    window.__pcs = [];
    function Tracked(...ctorArgs) {
        const pc = new Original(...ctorArgs);
        window.__pcs.push(pc);
        return pc;
    }
    Tracked.prototype = Original.prototype;
    Object.setPrototypeOf(Tracked, Original);
    window.RTCPeerConnection = Tracked;
};

// Runs in the page: one snapshot of every RTP stream across all connections.
const snapshot = async () => {
    const streams = [];
    const states = {};
    for (let i = 0; i < window.__pcs.length; i++) {
        const pc = window.__pcs[i];
        states[pc.connectionState] = (states[pc.connectionState] || 0) + 1;
        if (pc.connectionState === "closed") continue;
        const report = await pc.getStats();
        report.forEach((r) => {
            if (r.type !== "outbound-rtp" && r.type !== "inbound-rtp") return;
            streams.push({
                id: `${i}:${r.id}`,
                dir: r.type === "outbound-rtp" ? "out" : "in",
                kind: r.kind,
                bytes: r.type === "outbound-rtp" ? r.bytesSent || 0 : r.bytesReceived || 0,
                frames: r.type === "outbound-rtp" ? r.framesEncoded || 0 : r.framesDecoded || 0,
                frameHeight: r.frameHeight || 0,
                limitation: r.qualityLimitationReason || null,
                freezeCount: r.freezeCount || 0,
                freezeSeconds: r.totalFreezesDuration || 0,
            });
        });
    }
    const label = document.querySelector('[class*="topBarRight"]');
    return {
        t: performance.now(),
        peerConnectionsCreated: window.__pcs.length,
        connectionStates: states,
        remoteTiles: document.querySelectorAll("video[data-socket]").length,
        participantLabel: label ? label.textContent.trim() : null,
        streams,
    };
};

const cpuTimes = () => os.cpus().reduce(
    (acc, c) => {
        const total = Object.values(c.times).reduce((a, b) => a + b, 0);
        return { idle: acc.idle + c.times.idle, total: acc.total + total };
    },
    { idle: 0, total: 0 }
);

const diffParticipant = (a, b) => {
    const seconds = (b.t - a.t) / 1000;
    const before = Object.fromEntries(a.streams.map((s) => [s.id, s]));
    const result = {
        peerConnectionsCreated: b.peerConnectionsCreated,
        connectionStates: b.connectionStates,
        remoteTiles: b.remoteTiles,
        participantLabel: b.participantLabel,
        activeVideoUploads: 0,
        activeVideoDownloads: 0,
        uploadKbps: 0,
        downloadKbps: 0,
        sentFps: [],
        receivedFps: [],
        sentHeights: [],
        limitations: {},
        newFreezes: 0,
        freezeSeconds: 0,
    };
    for (const s of b.streams) {
        const p = before[s.id];
        if (!p) continue;
        const kbps = ((s.bytes - p.bytes) * 8) / 1000 / seconds;
        const fps = (s.frames - p.frames) / seconds;
        if (s.dir === "out") result.uploadKbps += kbps;
        else result.downloadKbps += kbps;
        if (s.kind !== "video" || s.bytes === p.bytes) continue;
        if (s.dir === "out") {
            result.activeVideoUploads++;
            result.sentFps.push(fps);
            result.sentHeights.push(s.frameHeight);
            result.limitations[s.limitation || "none"] = (result.limitations[s.limitation || "none"] || 0) + 1;
        } else {
            result.activeVideoDownloads++;
            result.receivedFps.push(fps);
            result.newFreezes += s.freezeCount - p.freezeCount;
            result.freezeSeconds += s.freezeSeconds - p.freezeSeconds;
        }
    }
    return result;
};

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

const summarise = (n, participants, cpuPercent, memUsedGb) => {
    const all = (key) => participants.flatMap((p) => p[key]);
    const limitations = {};
    participants.forEach((p) => Object.entries(p.limitations).forEach(([k, v]) => {
        limitations[k] = (limitations[k] || 0) + v;
    }));
    return {
        participants: n,
        expectedRemoteTilesEach: n - 1,
        remoteTilesSeen: participants.map((p) => p.remoteTiles),
        peerConnectionsCreatedEach: participants.map((p) => p.peerConnectionsCreated),
        connectedPeerConnectionsEach: participants.map((p) => p.connectionStates.connected || 0),
        avgVideoUploadsEach: round(avg(participants.map((p) => p.activeVideoUploads))),
        avgUploadMbpsEach: round(avg(participants.map((p) => p.uploadKbps)) / 1000, 2),
        avgDownloadMbpsEach: round(avg(participants.map((p) => p.downloadKbps)) / 1000, 2),
        avgSentFps: round(avg(all("sentFps"))),
        avgReceivedFps: round(avg(all("receivedFps"))),
        avgSentHeightPx: round(avg(all("sentHeights")), 0),
        uploadLimitedBy: limitations,
        freezesInWindow: participants.reduce((a, p) => a + p.newFreezes, 0),
        frozenSecondsInWindow: round(participants.reduce((a, p) => a + p.freezeSeconds, 0)),
        machineCpuPercent: round(cpuPercent),
        machineMemoryUsedGb: round(memUsedGb, 2),
    };
};

await mkdir(new URL("./.cache/", import.meta.url), { recursive: true });
const FAKE_CAMERA = await ensureFakeCameraFile(fileURLToPath(new URL("./.cache/fake-camera.y4m", import.meta.url)));

const runSize = async (n) => {
    const room = `loadtest-${LABEL}-${n}-${Date.now()}`;

    const idle0 = cpuTimes();
    await sleep(3000);
    const idle1 = cpuTimes();
    const idleCpuPercent = 100 * (1 - (idle1.idle - idle0.idle) / (idle1.total - idle0.total));
    const idleMemUsedGb = (os.totalmem() - os.freemem()) / 1024 ** 3;

    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-video-capture=${FAKE_CAMERA}`,
            "--autoplay-policy=no-user-gesture-required",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-backgrounding-occluded-windows",
            "--mute-audio",
        ],
    });
    try {
        const pages = [];
        for (let i = 1; i <= n; i++) {
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720 });
            await page.evaluateOnNewDocument(trackPeerConnections);
            await page.evaluateOnNewDocument((name) => sessionStorage.setItem("guestName", name), `Bot ${i}`);
            await page.goto(`${BASE_URL}/${room}`, { waitUntil: "networkidle2" });
            await page.waitForFunction(
                () => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Join now") && !b.disabled),
                { timeout: 30000 }
            );
            await sleep(1500); // let the camera preview start, like a real person would
            await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Join now")).click());
            pages.push(page);
            console.log(`  [${n}] Bot ${i} joined`);
            await sleep(1500);
        }

        console.log(`  [${n}] all joined, settling ${SETTLE_SECONDS}s...`);
        await sleep(SETTLE_SECONDS * 1000);

        const cpu0 = cpuTimes();
        const first = await Promise.all(pages.map((p) => p.evaluate(snapshot)));
        await sleep(WINDOW_SECONDS * 1000);
        const second = await Promise.all(pages.map((p) => p.evaluate(snapshot)));
        const cpu1 = cpuTimes();

        const cpuPercent = 100 * (1 - (cpu1.idle - cpu0.idle) / (cpu1.total - cpu0.total));
        const memUsedGb = (os.totalmem() - os.freemem()) / 1024 ** 3;
        const participants = first.map((a, i) => diffParticipant(a, second[i]));
        const summary = {
            ...summarise(n, participants, cpuPercent, memUsedGb),
            machineCpuPercentBeforeTest: round(idleCpuPercent),
            machineMemoryUsedGbBeforeTest: round(idleMemUsedGb, 2),
        };
        return { summary, participants };
    } finally {
        await browser.close();
    }
};

const results = {
    label: LABEL,
    date: new Date().toISOString(),
    url: BASE_URL,
    machine: {
        cpu: os.cpus()[0].model.trim(),
        logicalCores: os.cpus().length,
        memoryGb: round(os.totalmem() / 1024 ** 3, 1),
        platform: `${os.type()} ${os.release()}`,
    },
    settleSeconds: SETTLE_SECONDS,
    windowSeconds: WINDOW_SECONDS,
    runs: [],
};

for (const n of SIZES) {
    console.log(`Running with ${n} participants...`);
    try {
        const run = await runSize(n);
        results.runs.push(run);
        console.log(JSON.stringify(run.summary, null, 2));
    } catch (e) {
        console.log(`  [${n}] FAILED: ${e.message}`);
        results.runs.push({ summary: { participants: n, error: e.message } });
    }
    await sleep(5000);
}

await mkdir(new URL("./results/", import.meta.url), { recursive: true });
const file = new URL(`./results/${LABEL}-${results.date.slice(0, 10)}.json`, import.meta.url);
await writeFile(file, JSON.stringify(results, null, 2));
console.log(`Saved ${file.pathname}`);

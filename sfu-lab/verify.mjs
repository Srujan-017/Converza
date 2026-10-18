// Joins N fake participants to the lab and checks the SFU promise:
// everyone sees everyone, and each person uploads only one video.
//
// Usage (with `npm start` running): node verify.mjs --sizes 2,4,6,8
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { ensureFakeCameraFile } from "../loadtest/fakeCamera.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => {
    if (a.startsWith("--")) pairs.push([a.slice(2), all[i + 1]]);
    return pairs;
}, []));
const BASE_URL = (args.url || "http://localhost:4000").replace(/\/+$/, "");
const SIZES = (args.sizes || "2,4").split(",").map(Number);
const SETTLE_SECONDS = Number(args.settle || 20);
const WINDOW_SECONDS = Number(args.window || 10);
const CHROME_PATH = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
const cpuTimes = () => os.cpus().reduce((acc, c) => {
    const total = Object.values(c.times).reduce((a, b) => a + b, 0);
    return { idle: acc.idle + c.times.idle, total: acc.total + total };
}, { idle: 0, total: 0 });

await mkdir(new URL("../loadtest/.cache/", import.meta.url), { recursive: true });
const FAKE_CAMERA = await ensureFakeCameraFile(fileURLToPath(new URL("../loadtest/.cache/fake-camera.y4m", import.meta.url)));

const runSize = async (n) => {
    const room = `verify-${n}-${Date.now()}`;
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
        for (let i = 0; i < n; i++) {
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720 });
            await page.goto(`${BASE_URL}/?room=${room}`, { waitUntil: "networkidle2" });
            pages.push(page);
            await sleep(1500);
        }
        await sleep(SETTLE_SECONDS * 1000);

        const samples = pages.map(() => []);
        const workerBefore = (await (await fetch(`${BASE_URL}/stats`)).json()).workerCpuMs;
        const windowStart = Date.now();
        const cpu0 = cpuTimes();
        for (let s = 0; s < WINDOW_SECONDS / 2; s++) {
            await sleep(2000);
            const snap = await Promise.all(pages.map((p) => p.evaluate(() => ({
                status: document.getElementById("status").textContent,
                remoteTiles: document.querySelectorAll("video[data-peer]").length,
                stats: window.__labStats || null,
            }))));
            snap.forEach((x, i) => samples[i].push(x));
        }
        const cpu1 = cpuTimes();
        const server = await (await fetch(`${BASE_URL}/stats`)).json();
        // 100% = one full CPU core busy forwarding media.
        const sfuWorkerCpuPercentOfOneCore = (100 * (server.workerCpuMs - workerBefore)) / (Date.now() - windowStart);

        const per = samples.map((list) => {
            const st = list.map((x) => x.stats).filter(Boolean);
            const last = list[list.length - 1];
            return {
                status: last.status,
                remoteTiles: last.remoteTiles,
                videoUploads: Math.max(0, ...st.map((x) => x.videoUploads)),
                uploadMbps: avg(st.map((x) => x.uploadMbps)),
                videoDownloads: last.stats ? last.stats.videoDownloads : 0,
                downloadMbps: avg(st.map((x) => x.downloadMbps)),
                sentFps: avg(st.map((x) => x.sentFps)),
                receivedFps: avg(st.flatMap((x) => x.receivedFps)),
                sentHeight: avg(st.map((x) => x.sentHeight)),
                limitation: last.stats ? last.stats.limitation : null,
                freezesInWindow: st.length > 1 ? st[st.length - 1].freezes - st[0].freezes : 0,
            };
        });
        return {
            participants: n,
            allConnected: per.every((p) => p.status === "Connected"),
            remoteTilesSeen: per.map((p) => p.remoteTiles),
            videoUploadsEach: per.map((p) => p.videoUploads),
            videoDownloadsEach: per.map((p) => p.videoDownloads),
            avgUploadMbpsEach: round(avg(per.map((p) => p.uploadMbps)), 2),
            avgDownloadMbpsEach: round(avg(per.map((p) => p.downloadMbps)), 2),
            avgSentFps: round(avg(per.map((p) => p.sentFps))),
            avgReceivedFps: round(avg(per.map((p) => p.receivedFps))),
            avgSentHeightPx: round(avg(per.map((p) => p.sentHeight)), 0),
            uploadLimitedBy: per.map((p) => p.limitation),
            freezesInWindow: per.reduce((a, p) => a + p.freezesInWindow, 0),
            machineCpuPercent: round(100 * (1 - (cpu1.idle - cpu0.idle) / (cpu1.total - cpu0.total))),
            sfuWorkerCpuPercentOfOneCore: round(sfuWorkerCpuPercentOfOneCore),
            serverRoom: server[room] || null,
        };
    } finally {
        await browser.close();
    }
};

const results = {
    label: args.label || "sfu-lab",
    date: new Date().toISOString(),
    machine: { cpu: os.cpus()[0].model.trim(), logicalCores: os.cpus().length, memoryGb: round(os.totalmem() / 1024 ** 3, 1) },
    settleSeconds: SETTLE_SECONDS,
    windowSeconds: WINDOW_SECONDS,
    runs: [],
};

for (const n of SIZES) {
    console.log(`Checking ${n} participants...`);
    try {
        const run = await runSize(n);
        results.runs.push(run);
        console.log(JSON.stringify(run, null, 2));
    } catch (e) {
        console.log(`  FAILED: ${e.message}`);
        results.runs.push({ participants: n, error: e.message });
    }
    await sleep(5000);
}

await mkdir(new URL("./results/", import.meta.url), { recursive: true });
const out = new URL(`./results/${results.label}-${results.date.slice(0, 10)}.json`, import.meta.url);
await writeFile(out, JSON.stringify(results, null, 2));
console.log(`Saved ${fileURLToPath(out)}`);

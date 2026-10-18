// Checks Converza's real backend SFU (backend/src/sfu) end to end with
// fake browser participants. No MongoDB needed: only the meeting server runs.
//
// Usage, from sfu-lab/:  npm run check-backend
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { io as ioClient } from "socket.io-client";
import { connectToSocket } from "../../backend/src/controllers/socketManager.js";
import { startWorkers } from "../../backend/src/sfu/workers.js";
import { roomStats } from "../../backend/src/sfu/rooms.js";
import { ensureFakeCameraFile } from "../../loadtest/fakeCamera.mjs";

const PORT = 4100;
const URL_BASE = `http://localhost:${PORT}`;
const CHROME_PATH = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
    if (ok) passed++; else failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail ? `  (${detail})` : ""}`);
};
const waitFor = async (fn, timeoutMs = 15000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        if (await fn()) return true;
        await sleep(250);
    }
    return false;
};

const publicDir = fileURLToPath(new URL("./public/", import.meta.url));
const server = createServer(async (req, res) => {
    const file = req.url.startsWith("/bundle.js") ? "bundle.js" : "index.html";
    res.writeHead(200, { "Content-Type": file.endsWith(".js") ? "text/javascript" : "text/html" });
    res.end(await readFile(publicDir + file));
});
connectToSocket(server);
await new Promise((r) => server.listen(PORT, r));

// --- 1. Requests in the wrong order are refused (before any workers exist) ---
const raw = ioClient(URL_BASE, { transports: ["websocket"], forceNew: true });
await new Promise((r) => raw.on("connect", r));
const ask = (event, data = {}) => new Promise((r) => raw.emit(event, data, r));
check("SFU events reply 'SFU unavailable' when mediasoup isn't running", (await ask("sfu:join")).error === "SFU unavailable");

const started = await startWorkers();
check("mediasoup workers start inside the Converza backend", started);
check("sfu:join before join-call is refused", (await ask("sfu:join")).error === "join-call first");
check("sfu:create-transport before sfu:join is refused", (await ask("sfu:create-transport")).error === "call sfu:join first");
raw.emit("join-call", "check-room-raw", "Raw");
await sleep(200);
const rawJoin = await ask("sfu:join");
check("sfu:join after join-call returns router capabilities", !!(rawJoin.routerRtpCapabilities && rawJoin.routerRtpCapabilities.codecs));
raw.disconnect();
await sleep(300);

// --- 2. Fake participants in the browser ---
await mkdir(new URL("../../loadtest/.cache/", import.meta.url), { recursive: true });
const camera = await ensureFakeCameraFile(fileURLToPath(new URL("../../loadtest/.cache/fake-camera.y4m", import.meta.url)));
const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-video-capture=${camera}`,
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--mute-audio",
    ],
});

const join = async (room, name) => {
    const page = await browser.newPage();
    await page.goto(`${URL_BASE}/?room=${room}&name=${encodeURIComponent(name)}`);
    await page.waitForFunction(() => window.__check && (window.__check.ready || window.__check.errors.length), { timeout: 20000 });
    return page;
};
const stateOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__check)));
const liveConsumers = (s, filter = () => true) => Object.values(s.consumers).filter((c) => !c.closed && filter(c));

try {
    const a1 = await join("check-room-a", "Asha");
    const a2 = await join("check-room-a", "Bala");
    const a3 = await join("check-room-a", "Chitra");
    const b1 = await join("check-room-b", "Deepak");
    const roomA = [a1, a2, a3];

    const states = await Promise.all([...roomA, b1].map(stateOf));
    check("all participants joined with no errors", states.every((s) => s.ready && s.errors.length === 0),
        JSON.stringify(states.map((s) => s.errors)));

    await waitFor(async () => (await Promise.all(roomA.map(stateOf))).every((s) => liveConsumers(s).length === 4));
    const aStates = await Promise.all(roomA.map(stateOf));
    check("each person in room A receives camera + mic from the other 2 (4 consumers)",
        aStates.every((s) => liveConsumers(s).length === 4), aStates.map((s) => liveConsumers(s).length).join(","));
    check("person alone in room B receives nothing from room A", liveConsumers(await stateOf(b1)).length === 0);
    check("existing names feature still works alongside the SFU",
        Object.values(aStates[0].names).includes("Chitra") && Object.values(aStates[2].names).includes("Asha"));

    const sendStats = await Promise.all(roomA.map((p) => p.evaluate(() => window.__sendStats())));
    check("each person uploads exactly 1 video stream to the SFU", sendStats.every((s) => s.videoStreams === 1),
        sendStats.map((s) => s.videoStreams).join(","));

    const before = await Promise.all(roomA.map((p) => p.evaluate(() => window.__recvVideoBytes())));
    await sleep(3000);
    const after = await Promise.all(roomA.map((p) => p.evaluate(() => window.__recvVideoBytes())));
    check("video is actually flowing to everyone in room A", after.every((b, i) => b > before[i] + 50_000),
        after.map((b, i) => `${Math.round((b - before[i]) / 1024)}KB`).join(","));

    const stats = await roomStats();
    check("server: room A has 3 peers, 6 producers, 12 consumers",
        stats["check-room-a"] && stats["check-room-a"].peers === 3 && stats["check-room-a"].producers === 6 && stats["check-room-a"].consumers === 12,
        JSON.stringify(stats["check-room-a"]));
    check("server: room B has 1 peer, 2 producers, 0 consumers",
        stats["check-room-b"] && stats["check-room-b"].peers === 1 && stats["check-room-b"].producers === 2 && stats["check-room-b"].consumers === 0,
        JSON.stringify(stats["check-room-b"]));

    // Camera off / on
    const a1Camera = (await stateOf(a1)).producers.camera;
    await a1.evaluate(() => window.__pauseCamera());
    const pausedSeen = await waitFor(async () => (await Promise.all([a2, a3].map(stateOf)))
        .every((s) => liveConsumers(s, (c) => c.source === "camera" && c.paused).length === 1));
    check("camera off: others are told Asha's camera is paused", pausedSeen);
    await a1.evaluate(() => window.__resumeCamera());
    const resumedSeen = await waitFor(async () => (await Promise.all([a2, a3].map(stateOf)))
        .every((s) => liveConsumers(s, (c) => c.paused).length === 0));
    check("camera on: others are told it resumed", resumedSeen);

    // Screen share start / stop
    await a1.evaluate(() => window.__startScreen());
    const screenSeen = await waitFor(async () => (await Promise.all([a2, a3].map(stateOf)))
        .every((s) => liveConsumers(s, (c) => c.source === "screen").length === 1));
    check("screen share: others receive a 'screen' stream from Asha", screenSeen);
    await a1.evaluate(() => window.__stopScreen());
    const screenGone = await waitFor(async () => (await Promise.all([a2, a3].map(stateOf)))
        .every((s) => liveConsumers(s, (c) => c.source === "screen").length === 0));
    check("stop sharing: the screen stream is removed for others", screenGone);
    check("camera stream is unaffected by screen share", liveConsumers(await stateOf(a2), (c) => c.source === "camera").length === 2);

    // Security: someone in room B can't take a stream from room A
    const crossRoom = await b1.evaluate(async (producerId) => {
        try {
            await window.__request("sfu:consume", { transportId: "x", producerId, rtpCapabilities: {} });
            return "allowed";
        } catch (e) { return e.message; }
    }, a1Camera);
    check("room B cannot consume a stream from room A", crossRoom !== "allowed", crossRoom);

    // Someone leaves
    const chitraId = Object.entries(aStates[0].names).find(([, n]) => n === "Chitra")[0];
    await a3.close();
    const leftSeen = await waitFor(async () => (await Promise.all([a1, a2].map(stateOf)))
        .every((s) => liveConsumers(s, (c) => c.peerId === chitraId).length === 0 && s.userLeft.includes(chitraId)));
    check("leaving: Chitra's streams close for others and user-left still fires", leftSeen);
    await sleep(500);
    const afterLeave = (await roomStats())["check-room-a"];
    check("server: room A now has 2 peers, 4 producers, 4 consumers",
        afterLeave && afterLeave.peers === 2 && afterLeave.producers === 4 && afterLeave.consumers === 4, JSON.stringify(afterLeave));

    // Everyone leaves -> rooms are cleaned up
    await Promise.all([a1.close(), a2.close(), b1.close()]);
    await waitFor(async () => Object.keys(await roomStats()).length === 0, 5000);
    check("when everyone leaves, all SFU rooms are closed", Object.keys(await roomStats()).length === 0, JSON.stringify(await roomStats()));
} finally {
    await browser.close();
    server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// Automated meeting-feature checklist: fake participants use the real
// Converza meeting page (guest flow) and we check what each one sees.
//
// Usage (backend + production frontend running):
//   node features.mjs --url http://localhost:3000 --mode sfu
//   node features.mjs --url http://localhost:3000 --mode mesh --quick
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { ensureFakeCameraFile } from "./fakeCamera.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => {
    if (a.startsWith("--")) pairs.push([a.slice(2), all[i + 1]]);
    return pairs;
}, []));
const BASE_URL = (args.url || "http://localhost:3000").replace(/\/+$/, "");
const EXPECTED_MODE = args.mode || "sfu";
const QUICK = process.argv.includes("--quick");
const CHROME_PATH = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
    if (ok) passed++; else failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail ? `  (${detail})` : ""}`);
};
const waitFor = async (fn, timeoutMs = 20000) => {
    const end = Date.now() + timeoutMs;
    let last;
    while (Date.now() < end) {
        last = await fn();
        if (last) return last;
        await sleep(300);
    }
    return last;
};

await mkdir(new URL("./.cache/", import.meta.url), { recursive: true });
const camera = await ensureFakeCameraFile(fileURLToPath(new URL("./.cache/fake-camera.y4m", import.meta.url)));
const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    protocolTimeout: 30000,
    args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-video-capture=${camera}`,
        "--auto-select-desktop-capture-source=Entire screen",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--mute-audio",
        // Only for rehearsals with a self-signed certificate.
        ...(process.env.IGNORE_CERT_ERRORS ? ["--ignore-certificate-errors"] : []),
    ],
});

const modes = new Map();
const join = async (room, name) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on("console", (m) => {
        const match = m.text().match(/Converza media mode: (\w+)/);
        if (match) modes.set(name, match[1]);
        if (m.type() === "error" || process.env.VERBOSE) console.log(`  [${name} ${m.type()}] ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => console.log(`  [${name} page error] ${e.message}`));
    await page.evaluateOnNewDocument((n) => sessionStorage.setItem("guestName", n), name);
    await page.goto(`${BASE_URL}/${room}`, { waitUntil: "networkidle2" });
    await clickButton(page, "Join now");
    return page;
};

const clickButton = async (page, text) => {
    // Puppeteer's real click waits for the element to be visible, which only
    // happens in the front tab (as with a real person clicking).
    await page.bringToFront();
    await page.waitForFunction(
        (t) => [...document.querySelectorAll("button")].some((b) => b.textContent.trim().endsWith(t) && !b.disabled),
        { timeout: 20000 }, text
    );
    const buttons = await page.$$("button");
    for (const b of buttons) {
        if (await b.evaluate((el, t) => el.textContent.trim().endsWith(t), text)) {
            await b.click(); // a real click, so the browser allows screen capture
            return;
        }
    }
};

// What this person sees: one entry per remote tile.
const tilesOf = (page) => page.evaluate(() => [...document.querySelectorAll("video[data-socket]")].map((v) => {
    const tile = v.parentElement;
    return {
        name: (tile.querySelector('[class*="tileLabel"]') || {}).textContent || "",
        cameraOffShown: !!tile.querySelector('[class*="avatarOverlay"]'),
        mutedShown: !!tile.querySelector('[class*="tileMicOffIcon"]'),
        frames: v.getVideoPlaybackQuality().totalVideoFrames,
    };
}));
const tile = async (page, name) => (await tilesOf(page)).find((t) => t.name === name);
const pageText = (page) => page.evaluate(() => document.body.innerText);

const framesGrow = async (page, name) => {
    const a = await tile(page, name);
    await sleep(1500);
    const b = await tile(page, name);
    return !!(a && b && b.frames > a.frames);
};

const room = `features-${Date.now()}`;
try {
    const asha = await join(room, "Asha");
    const bala = await join(room, "Bala");
    const chitra = QUICK ? null : await join(room, "Chitra");
    const people = QUICK ? [asha, bala] : [asha, bala, chitra];
    const names = QUICK ? ["Asha", "Bala"] : ["Asha", "Bala", "Chitra"];

    await waitFor(async () => (await Promise.all(people.map(tilesOf))).every((t) => t.length === people.length - 1));
    check(`media mode is "${EXPECTED_MODE}" for everyone`,
        names.every((n) => modes.get(n) === EXPECTED_MODE), JSON.stringify(Object.fromEntries(modes)));

    const seen = await Promise.all(people.map(tilesOf));
    check("everyone sees everyone else's tile, with names",
        seen.every((t, i) => t.length === people.length - 1 && names.filter((_, j) => j !== i).every((n) => t.some((x) => x.name === n))),
        JSON.stringify(seen.map((t) => t.map((x) => x.name))));

    const flowing = await waitFor(async () => (await Promise.all(names.map((n, i) => framesGrow(people[(i + 1) % people.length], n)))).every(Boolean));
    check("live video is playing in every remote tile", flowing);

    // Chat
    await asha.bringToFront();
    const inputs = await asha.$$("input");
    for (const input of inputs) {
        const label = await input.evaluate((el) => (el.labels && el.labels[0] ? el.labels[0].textContent : ""));
        if (label.includes("Enter Your chat")) {
            await input.type("Hello from Asha");
            await input.press("Enter");
            break;
        }
    }
    const chatOk = await waitFor(async () => (await pageText(bala)).includes("Hello from Asha"));
    check("chat: others receive the message with the sender's name", chatOk && (await pageText(bala)).includes("Asha"));

    if (EXPECTED_MODE === "sfu") {
        await clickButton(asha, "Stop Video");
        const offShown = await waitFor(async () => {
            const t = await tile(bala, "Asha");
            return t && t.cameraOffShown;
        });
        check("camera off: others see Asha's avatar instead of video", !!offShown);
        await clickButton(asha, "Start Video");
        const onAgain = await waitFor(async () => {
            const t = await tile(bala, "Asha");
            return t && !t.cameraOffShown;
        });
        check("camera on: avatar disappears for others", !!onAgain);
        check("camera on: Asha's video plays again", await waitFor(() => framesGrow(bala, "Asha")));

        await clickButton(asha, "Mute");
        const mutedShown = await waitFor(async () => {
            const t = await tile(bala, "Asha");
            return t && t.mutedShown;
        });
        check("mic off: others see Asha's muted icon", !!mutedShown);
        await clickButton(asha, "Unmute");
        const unmuted = await waitFor(async () => {
            const t = await tile(bala, "Asha");
            return t && !t.mutedShown;
        });
        check("mic on: muted icon disappears", !!unmuted);
        check("mic toggle doesn't stop Asha's video", await waitFor(() => framesGrow(bala, "Asha")));
    }

    if (!QUICK) {
        const micBefore = await asha.evaluate(() => {
            const mic = window.localStream.getAudioTracks().find((t) => t.readyState === "live");
            return mic ? mic.id : null;
        });
        await clickButton(asha, "Share");
        const spotlight = await waitFor(async () => (await pageText(bala)).includes("Asha is presenting their screen"));
        check("screen share: others switch to the presenter spotlight", !!spotlight);
        const screenPlaying = await waitFor(() => bala.evaluate(() => {
            const v = document.querySelector('[class*="spotlightVideo"]');
            return !!(v && v.srcObject && v.videoWidth > 0);
        }));
        check("screen share: the shared screen is playing for others", !!screenPlaying);
        // The same microphone track as before sharing, not screen or tab audio.
        check("screen share: the presenter's own mic stays on",
            !!micBefore && await asha.evaluate((id) => window.localStream.getAudioTracks()
                .some((t) => t.id === id && t.readyState === "live"), micBefore));
        const voiceHeard = await waitFor(() => bala.evaluate(() => {
            const v = document.querySelector('[class*="spotlightVideo"]');
            const audio = v && v.srcObject ? v.srcObject.getAudioTracks() : [];
            return audio.some((t) => t.readyState === "live" && !t.muted);
        }), 10000);
        check("screen share: others can still hear the presenter", !!voiceHeard);
        await clickButton(asha, "Stop Share");
        const backToGrid = await waitFor(async () => !(await pageText(bala)).includes("is presenting their screen"));
        check("stop sharing: everyone returns to the normal grid", !!backToGrid);
        check("stop sharing: Asha's camera plays again", await waitFor(() => framesGrow(bala, "Asha")));

        const deepak = await join(room, "Deepak");
        const lateOk = await waitFor(async () => (await tilesOf(deepak)).length === 3);
        check("late joiner sees all 3 people already in the meeting", !!lateOk);
        check("late joiner receives live video", await waitFor(() => framesGrow(deepak, "Bala")));
        const othersSeeDeepak = await waitFor(async () => (await Promise.all([asha, bala, chitra].map((p) => tile(p, "Deepak")))).every(Boolean));
        check("everyone already there sees the late joiner", !!othersSeeDeepak);

        await bala.reload({ waitUntil: "networkidle2" });
        await clickButton(bala, "Join now");
        const rejoined = await waitFor(async () => (await tilesOf(bala)).length === 3 &&
            (await Promise.all([asha, chitra, deepak].map(tilesOf))).every((t) => t.filter((x) => x.name === "Bala").length === 1));
        check("refresh: Bala rejoins the same meeting, shown once for everyone", !!rejoined);

        await clickButton(chitra, "Leave");
        const goneForAll = await waitFor(async () => (await Promise.all([asha, bala, deepak].map(tilesOf))).every((t) => !t.some((x) => x.name === "Chitra")));
        check("leave: Chitra's tile disappears for everyone", !!goneForAll);

        const esha = await join(`${room}-other`, "Esha");
        await sleep(5000);
        check("someone in a different meeting sees nobody", (await tilesOf(esha)).length === 0);
        check("nobody in this meeting sees Esha", (await Promise.all([asha, bala, deepak].map((p) => tile(p, "Esha")))).every((t) => !t));
    }
} finally {
    await browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

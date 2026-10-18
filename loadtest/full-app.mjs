// End-to-end test of the whole app: the real backend (backend/src/app.js)
// on a temporary in-memory MongoDB, the production frontend build, and fake
// browser users going through register, login, meeting, guest, history, logout.
//
// Needs: `npm run build` in frontend/ (default server URL), ports 3000 and
// 8000 free. Usage: node full-app.mjs          (SFU off, like Render)
//                   node full-app.mjs --sfu    (SFU on, like EC2)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";
import puppeteer from "puppeteer-core";
import { ensureFakeCameraFile } from "./fakeCamera.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHROME_PATH = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SFU = process.argv.includes("--sfu");
const PASSWORD = "S3cret-pass-123";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
    if (ok) passed++; else failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && detail ? `  (${detail})` : ""}`);
};
const waitFor = async (fn, ms = 20000) => {
    const end = Date.now() + ms;
    let value;
    while (Date.now() < end) {
        value = await fn();
        if (value) return value;
        await sleep(300);
    }
    return value;
};

// Database and the real backend
const mongo = await MongoMemoryServer.create();
const backendLog = [];
const backend = spawn(process.execPath, ["src/app.js"], {
    cwd: join(ROOT, "backend"),
    env: { ...process.env, MONGODB_URI: mongo.getUri("converza"), PORT: "8000", SFU_ENABLED: SFU ? "true" : "" },
});
backend.stdout.on("data", (d) => backendLog.push(String(d)));
backend.stderr.on("data", (d) => backendLog.push(String(d)));
const listening = await waitFor(async () => backendLog.join("").includes("LISTENING ON PORT 8000"), 30000);
check("real backend (app.js) starts with MongoDB", !!listening, backendLog.join("").slice(-300));

// The production frontend build, with every unknown path going to index.html
const BUILD = join(ROOT, "frontend", "build");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const web = createServer(async (req, res) => {
    const file = normalize(join(BUILD, decodeURIComponent(req.url.split("?")[0])));
    try {
        if (!file.startsWith(normalize(BUILD)) || !extname(file)) throw new Error("spa route");
        res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
        res.end(await readFile(file));
    } catch {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(await readFile(join(BUILD, "index.html")));
    }
});
await new Promise((r) => web.listen(3000, r));

const health = await (await fetch("http://localhost:8000/api/v1/health")).json();
check("health: database connected", health.database === "connected", JSON.stringify(health));
check(`health: SFU ${SFU ? "running" : "unavailable"} (SFU_ENABLED ${SFU ? "true" : "unset"})`,
    health.sfu === (SFU ? "running" : "unavailable"), JSON.stringify(health));

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
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--mute-audio",
    ],
});

const consoleLines = [];
const modes = new Map();
const newPage = async (who) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.on("console", (m) => {
        consoleLines.push(m.text());
        const match = m.text().match(/Converza media mode: (\w+)/);
        if (match) modes.set(who, match[1]);
    });
    return page;
};
// Real clicks need the tab in front, as they would for a person.
const clickText = async (page, label, selector = "button") => {
    await page.bringToFront();
    await page.waitForFunction(
        (s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.trim() === t && !e.disabled),
        { timeout: 20000 }, selector, label
    );
    for (const el of await page.$$(selector)) {
        if (await el.evaluate((e, t) => e.textContent.trim() === t, label)) {
            await el.click();
            return;
        }
    }
};
const typeInto = async (page, selector, value) => {
    await page.bringToFront();
    await page.waitForSelector(selector);
    await page.click(selector, { clickCount: 3 });
    await page.type(selector, value);
};
const text = (page) => page.evaluate(() => document.body.innerText);
const tiles = (page) => page.evaluate(() => [...document.querySelectorAll("video[data-socket]")]
    .map((v) => (v.parentElement.querySelector('[class*="tileLabel"]') || {}).textContent || ""));

try {
    const user = await newPage("Srujan");
    await user.goto("http://localhost:3000/auth", { waitUntil: "networkidle2" });
    await clickText(user, "Sign Up");
    await typeInto(user, "#name", "Srujan V");
    await typeInto(user, "#username", "srujan");
    await typeInto(user, "#password", PASSWORD);
    await clickText(user, "Create account");
    check("register: 'User Registered' message shown", !!(await waitFor(async () => (await text(user)).includes("User Registered"))));

    await clickText(user, "Sign Up");
    await typeInto(user, "#name", "Srujan V");
    await typeInto(user, "#username", "srujan");
    await typeInto(user, "#password", PASSWORD);
    await clickText(user, "Create account");
    check("register again: 'User already exists' shown", !!(await waitFor(async () => (await text(user)).includes("User already exists"))));

    await clickText(user, "Sign In");
    await typeInto(user, "#username", "srujan");
    await typeInto(user, "#password", "wrong-password");
    await clickText(user, "Log in");
    check("login with wrong password: error shown, stays on /auth",
        !!(await waitFor(async () => (await text(user)).includes("Invalid Username or password"))) && user.url().endsWith("/auth"));

    await typeInto(user, "#password", PASSWORD);
    await clickText(user, "Log in");
    check("login: goes to /home", !!(await waitFor(async () => user.url().endsWith("/home"))));
    check("login: token saved", !!(await user.evaluate(() => localStorage.getItem("token"))));
    check("login: password never printed to the console", !consoleLines.some((l) => l.includes(PASSWORD)));

    await typeInto(user, "#outlined-basic", "e2e-room");
    await clickText(user, "Join");
    check("home: joining with a code opens /e2e-room", !!(await waitFor(async () => user.url().endsWith("/e2e-room"))));
    await typeInto(user, "#outlined-basic", "Srujan");
    await clickText(user, "Join now");

    const guest = await newPage("Rahul");
    await guest.goto("http://localhost:3000/", { waitUntil: "networkidle2" });
    await clickText(guest, "Join as Guest", "p");
    check("landing: 'Join as Guest' opens /guest", !!(await waitFor(async () => guest.url().endsWith("/guest"))));
    const [nameBox, codeBox] = await guest.$$("input");
    await nameBox.type("Rahul");
    await codeBox.type("e2e-room");
    await clickText(guest, "Join Meeting");
    await clickText(guest, "Join now");

    const together = await waitFor(async () => (await tiles(user)).includes("Rahul") && (await tiles(guest)).includes("Srujan"));
    check("logged-in user and guest see each other by name", !!together,
        `user sees ${JSON.stringify(await tiles(user))}, guest sees ${JSON.stringify(await tiles(guest))}`);
    const expectedMode = SFU ? "sfu" : "mesh";
    check(`both use ${SFU ? "SFU" : "peer-to-peer"} mode`,
        modes.get("Srujan") === expectedMode && modes.get("Rahul") === expectedMode, JSON.stringify(Object.fromEntries(modes)));

    await clickText(user, "Leave");
    check("leave: guest no longer sees the user", !!(await waitFor(async () => !(await tiles(guest)).includes("Srujan"))));
    await user.goto("http://localhost:3000/history", { waitUntil: "networkidle2" });
    check("history: the meeting code is listed", !!(await waitFor(async () => (await text(user)).includes("Code: e2e-room"))));

    await user.goto("http://localhost:3000/home", { waitUntil: "networkidle2" });
    await clickText(user, "Logout");
    check("logout: back to /auth, token removed",
        !!(await waitFor(async () => user.url().endsWith("/auth"))) && !(await user.evaluate(() => localStorage.getItem("token"))));
    await user.goto("http://localhost:3000/home", { waitUntil: "networkidle2" });
    check("after logout, /home redirects to login", !!(await waitFor(async () => user.url().endsWith("/auth"))));
} finally {
    await browser.close();
    web.close();
    backend.kill();
    await mongo.stop();
}
check("backend logs contain no passwords", !backendLog.join("").includes(PASSWORD));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

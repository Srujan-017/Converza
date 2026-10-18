// Turns run.mjs result files into a Markdown comparison report.
//
// Usage: node report.mjs results/phase6-mesh-*.json results/phase6-sfu-*.json --out results/REPORT.md
// Each file's "label" becomes a column. With --repeat, every value is shown
// as "median (min-max)" across the repeats.
import { readFile, writeFile } from "node:fs/promises";

const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const outFile = outIndex >= 0 ? argv[outIndex + 1] : null;
const files = argv.filter((_, i) => outIndex < 0 || (i !== outIndex && i !== outIndex + 1));
if (files.length === 0) {
    console.error("Usage: node report.mjs <results.json>... [--out REPORT.md]");
    process.exit(1);
}

const datasets = [];
for (const file of files) datasets.push(JSON.parse(await readFile(file, "utf8")));

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (x, digits) => (Number.isInteger(x) && digits === 0 ? String(x) : x.toFixed(digits));
const cell = (values, digits = 1, suffix = "") => {
    const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v));
    if (xs.length === 0) return "-";
    const mid = `${fmt(median(xs), digits)}${suffix}`;
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return xs.length > 1 && lo !== hi ? `${mid} (${fmt(lo, digits)}-${fmt(hi, digits)})` : mid;
};

// Share of participants receiving live video from every other person.
const fullyConnected = (run) => {
    const n = run.summary.participants;
    const ok = run.participants.filter((p) => p.activeVideoDownloads >= n - 1).length;
    return (100 * ok) / run.participants.length;
};
// Average share of time a remote video was frozen during the window.
const frozenPercent = (run, windowSeconds) => {
    const n = run.summary.participants;
    return (100 * run.summary.frozenSecondsInWindow) / (n * (n - 1) * windowSeconds);
};

const metrics = [
    ["Videos each person uploads", (r) => r.summary.avgVideoUploadsEach, 1, ""],
    ["Upload per person", (r) => r.summary.avgUploadMbpsEach, 2, " Mbps"],
    ["Download per person", (r) => r.summary.avgDownloadMbpsEach, 2, " Mbps"],
    ["Received video smoothness", (r) => r.summary.avgReceivedFps, 1, " fps"],
    ["Picture height sent", (r) => r.summary.avgSentHeightPx, 0, "p"],
    ["Remote video frozen", (r, d) => frozenPercent(r, d.windowSeconds), 1, "% of time"],
    ["People receiving video from everyone", (r) => fullyConnected(r), 0, "%"],
    // With the SFU, 2 of these are short-lived capability checks that close at once.
    ["Peer connections one person opened (most)", (r) => Math.max(...r.summary.peerConnectionsCreatedEach), 0, ""],
    ["Laptop CPU (all participants)", (r) => r.summary.machineCpuPercent, 0, "%"],
    ["SFU server CPU", (r) => r.summary.sfuWorkerCpuPercentOfOneCore, 0, "% of 1 core"],
];

const sizes = [...new Set(datasets.flatMap((d) => d.runs.map((r) => r.summary.participants)))].sort((a, b) => a - b);
const runsFor = (d, n) => d.runs.filter((r) => r.summary.participants === n && !r.summary.error && r.participants);

const lines = [];
const first = datasets[0];
lines.push("# Converza load test report", "");
lines.push(`Machine: ${first.machine.cpu}, ${first.machine.logicalCores} logical cores, ${first.machine.memoryGb} GB RAM (${first.machine.platform})`);
lines.push(`Each run: participants join, settle ${first.settleSeconds}s, then stats are measured over ${first.windowSeconds}s.`);
lines.push(...datasets.map((d) => `- **${d.label}**: ${d.date.slice(0, 10)}, ${d.runs.length} runs, url ${d.url}`));
lines.push("", "Values are the median across repeats, with the range in brackets.", "");
lines.push("All participants run on this one machine, so its CPU is shared by everyone and");
lines.push("there is no real internet in between. Compare columns with each other rather than");
lines.push("reading the numbers as what each real user would get on their own device.", "");

for (const [title, get, digits, suffix] of metrics) {
    const anyValue = datasets.some((d) => sizes.some((n) => runsFor(d, n).some((r) => Number.isFinite(get(r, d)))));
    if (!anyValue) continue;
    lines.push(`## ${title}`, "");
    lines.push(`| People | ${datasets.map((d) => d.label).join(" | ")} |`);
    lines.push(`|---|${datasets.map(() => "---").join("|")}|`);
    for (const n of sizes) {
        lines.push(`| ${n} | ${datasets.map((d) => cell(runsFor(d, n).map((r) => get(r, d)), digits, suffix)).join(" | ")} |`);
    }
    lines.push("");
}

const failures = datasets.flatMap((d) => d.runs.filter((r) => r.summary.error).map((r) => `${d.label} ${r.summary.participants} people: ${r.summary.error}`));
if (failures.length) lines.push("## Failed runs", "", ...failures.map((f) => `- ${f}`), "");

const report = lines.join("\n");
if (outFile) {
    await writeFile(outFile, report);
    console.log(`Saved ${outFile}`);
} else {
    console.log(report);
}

import * as mediasoup from "mediasoup";
import { sfuConfig } from "./config.js";

const workers = [];
let nextWorkerIndex = 0;
const workerDeathListeners = [];

const createWorker = async (index) => {
    const worker = await mediasoup.createWorker({ logLevel: "warn" });
    worker.on("died", (error) => {
        console.error(`mediasoup worker ${worker.pid} died:`, error && error.message);
        workerDeathListeners.forEach((listener) => listener(worker));
        createWorker(index).catch((e) => console.error("could not replace mediasoup worker:", e.message));
    });
    workers[index] = worker;
    return worker;
};

// Returns false instead of throwing, so the rest of Converza (login,
// history, the current peer-to-peer calls) still runs if mediasoup can't start.
export const startWorkers = async () => {
    try {
        for (let i = 0; i < sfuConfig.numWorkers; i++) await createWorker(i);
        console.log(`mediasoup ${mediasoup.version}: ${workers.length} worker(s) ready`);
        return true;
    } catch (e) {
        console.error("mediasoup failed to start, SFU disabled:", e.message);
        workers.length = 0;
        return false;
    }
};

export const sfuAvailable = () => workers.length > 0;

// cpuMs is the total CPU time (milliseconds) all media workers have used
// since they started; sample it twice to get CPU use over a period.
export const workerStats = async () => {
    let cpuMs = 0;
    for (const worker of workers) {
        const usage = await worker.getResourceUsage();
        cpuMs += usage.ru_utime + usage.ru_stime;
    }
    return { workers: workers.length, cpuMs };
};

// Spread rooms across workers (one per CPU core) in turn.
export const nextWorker = () => {
    const worker = workers[nextWorkerIndex % workers.length];
    nextWorkerIndex++;
    return worker;
};

export const onWorkerDied = (listener) => workerDeathListeners.push(listener);

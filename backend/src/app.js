import dotenv from "dotenv";
dotenv.config();
import express from "express";

import { createServer } from "node:http";

import mongoose from "mongoose";
import { connectToSocket } from "./controllers/socketManager.js";
import { startWorkers, sfuAvailable } from "./sfu/workers.js";
import { sfuStats } from "./sfu/stats.js";

import cors from "cors";
import userRoutes from "./routes/users.routes.js";

const app = express();
const server = createServer(app);
connectToSocket(server);


app.set("port", (process.env.PORT || 8000))
app.use(cors());
app.use(express.json({ limit: "40kb" }));
app.use(express.urlencoded({ limit: "40kb", extended: true }));

app.use("/api/v1/users", userRoutes);

// Quick check after a deploy: is the API up, is MongoDB connected, is the SFU running?
app.get("/api/v1/health", (_req, res) => {
    res.json({
        status: "ok",
        database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        sfu: sfuAvailable() ? "running" : "unavailable",
    });
});

// Used by loadtest/run.mjs to measure how hard the SFU server works.
app.get("/api/v1/sfu/stats", async (_req, res) => {
    res.json(await sfuStats());
});

const start = async () => {
    if (!process.env.MONGODB_URI) {
        console.error("MONGODB_URI is not set. Please add it to your .env file (see .env.example).");
        process.exit(1);
    }

    const connectionDb = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`MONGO Connected DB Host: ${connectionDb.connection.host}`)

    // The SFU is opt-in: hosts that can't receive media on the SFU ports (e.g.
    // Render) leave it off and meetings use peer-to-peer. If mediasoup fails
    // to start, the app still runs and meetings fall back the same way.
    if (process.env.SFU_ENABLED === "true") {
        await startWorkers();
    } else {
        console.log("SFU disabled (set SFU_ENABLED=true to enable); meetings use peer-to-peer");
    }

    server.listen(app.get("port"), () => {
        console.log(`LISTENING ON PORT ${app.get("port")}`)
    });
}

start();
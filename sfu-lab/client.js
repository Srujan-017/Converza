import { Device } from "mediasoup-client";
import { io } from "socket.io-client";

const roomId = new URLSearchParams(location.search).get("room") || "lab";
const socket = io();

const request = (event, data = {}) => new Promise((resolve, reject) => {
    socket.emit(event, data, (res) => (res && res.error ? reject(new Error(res.error)) : resolve(res)));
});

const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");
const grid = document.getElementById("videos");
document.getElementById("room").textContent = roomId;

const tiles = new Map(); // peerId -> { tile, stream }
const consumers = new Map(); // consumerId -> { consumer, peerId }

const tileFor = (peerId) => {
    if (!tiles.has(peerId)) {
        const tile = document.createElement("div");
        tile.className = "tile";
        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.dataset.peer = peerId;
        const stream = new MediaStream();
        video.srcObject = stream;
        const label = document.createElement("span");
        label.textContent = `Peer ${peerId.slice(0, 5)}`;
        tile.append(video, label);
        grid.append(tile);
        tiles.set(peerId, { tile, stream });
    }
    return tiles.get(peerId);
};

const removeTile = (peerId) => {
    const entry = tiles.get(peerId);
    if (!entry) return;
    entry.tile.remove();
    tiles.delete(peerId);
};

let device;
let sendTransport;
let recvTransport;
let recvReady = false;
const waitingProducers = [];

const createTransport = async (direction) => {
    const params = await request("createTransport");
    const transport = direction === "send" ? device.createSendTransport(params) : device.createRecvTransport(params);

    // Fired once, the first time the transport is used: finish the
    // secure-connection handshake with the server.
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
        request("connectTransport", { transportId: transport.id, dtlsParameters }).then(callback, errback);
    });

    if (direction === "send") {
        // Fired for each track we produce: tell the server, which creates the
        // matching producer and returns its id.
        transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
            request("produce", { transportId: transport.id, kind, rtpParameters })
                .then(({ id }) => callback({ id }), errback);
        });
    }
    return transport;
};

const consume = async ({ producerId, peerId }) => {
    const params = await request("consume", {
        transportId: recvTransport.id,
        producerId,
        rtpCapabilities: device.rtpCapabilities,
    });
    const consumer = await recvTransport.consume(params);
    consumers.set(consumer.id, { consumer, peerId });
    tileFor(peerId).stream.addTrack(consumer.track);
    await request("resumeConsumer", { consumerId: consumer.id });
};

socket.on("newProducer", (p) => (recvReady ? consume(p) : waitingProducers.push(p)));

socket.on("consumerClosed", ({ consumerId }) => {
    const entry = consumers.get(consumerId);
    if (!entry) return;
    entry.consumer.close();
    consumers.delete(consumerId);
    const tile = tiles.get(entry.peerId);
    if (tile) tile.stream.removeTrack(entry.consumer.track);
});

socket.on("peerLeft", ({ peerId }) => removeTile(peerId));

const start = async () => {
    try {
        statusEl.textContent = "Getting camera...";
        const local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById("local").srcObject = local;

        statusEl.textContent = "Joining room...";
        const { rtpCapabilities, existingProducers } = await request("join", { roomId });

        // DEVICE: learns which codecs the room's router supports.
        device = new Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });

        sendTransport = await createTransport("send");
        recvTransport = await createTransport("recv");

        for (const track of local.getTracks()) {
            await sendTransport.produce(track.kind === "video"
                ? { track, codecOptions: { videoGoogleStartBitrate: 1000 } }
                : { track });
        }

        recvReady = true;
        for (const p of [...existingProducers, ...waitingProducers.splice(0)]) await consume(p);

        statusEl.textContent = "Connected";
    } catch (e) {
        console.error(e);
        statusEl.textContent = `Could not start: ${e.message}`;
    }
};

// Live numbers that prove the SFU idea: uploads stay at 1 video, however many people join.
let previous = null;
const sampleStats = async () => {
    if (!sendTransport || !recvTransport) return;
    const now = performance.now();
    const current = { t: now, out: {}, in: {} };
    (await sendTransport.getStats()).forEach((r) => {
        if (r.type === "outbound-rtp") current.out[r.id] = { kind: r.kind, bytes: r.bytesSent, frames: r.framesEncoded || 0, height: r.frameHeight || 0, limitation: r.qualityLimitationReason };
    });
    (await recvTransport.getStats()).forEach((r) => {
        // mediasoup sends a hidden "probator" stream to test the network; it isn't anyone's video.
        if (r.type === "inbound-rtp" && r.trackIdentifier !== "probator") {
            current.in[r.id] = { kind: r.kind, bytes: r.bytesReceived, frames: r.framesDecoded || 0, freezes: r.freezeCount || 0 };
        }
    });

    if (previous) {
        const seconds = (now - previous.t) / 1000;
        const sum = (side, kind, field) => Object.entries(current[side])
            .filter(([id, s]) => (!kind || s.kind === kind) && previous[side][id])
            .map(([id, s]) => (s[field] - previous[side][id][field]) / seconds);
        const activeVideo = (side) => Object.entries(current[side])
            .filter(([id, s]) => s.kind === "video" && previous[side][id] && s.bytes > previous[side][id].bytes).length;
        const outVideo = Object.values(current.out).find((s) => s.kind === "video") || {};

        const stats = {
            videoUploads: activeVideo("out"),
            uploadMbps: sum("out", null, "bytes").reduce((a, b) => a + b, 0) * 8 / 1e6,
            videoDownloads: activeVideo("in"),
            downloadMbps: sum("in", null, "bytes").reduce((a, b) => a + b, 0) * 8 / 1e6,
            sentFps: (sum("out", "video", "frames")[0]) || 0,
            receivedFps: sum("in", "video", "frames"),
            sentHeight: outVideo.height || 0,
            limitation: outVideo.limitation || "none",
            freezes: Object.values(current.in).reduce((a, s) => a + s.freezes, 0),
        };
        window.__labStats = stats;
        const avgIn = stats.receivedFps.length ? stats.receivedFps.reduce((a, b) => a + b, 0) / stats.receivedFps.length : 0;
        statsEl.textContent =
            `Videos I upload: ${stats.videoUploads}  |  Upload: ${stats.uploadMbps.toFixed(2)} Mbps  |  ` +
            `Videos I receive: ${stats.videoDownloads}  |  Download: ${stats.downloadMbps.toFixed(2)} Mbps  |  ` +
            `Sent ${stats.sentFps.toFixed(0)} fps @ ${stats.sentHeight}p  |  Received avg ${avgIn.toFixed(0)} fps`;
    }
    previous = current;
};
setInterval(sampleStats, 2000);

start();

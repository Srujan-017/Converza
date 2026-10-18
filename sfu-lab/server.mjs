import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import * as mediasoup from "mediasoup";

const PORT = Number(process.env.PORT || 4000);
const LISTEN_IP = process.env.LISTEN_IP || "127.0.0.1";
// On a cloud server, set this to the machine's public IP so browsers know where to send media.
const ANNOUNCED_IP = process.env.ANNOUNCED_IP;

const mediaCodecs = [
    { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 1000 } },
];

// Start bandwidth estimates at ~1 Mbps instead of a few hundred kbps. Starting
// low makes Chrome shrink the picture first and grow it back only slowly.
const INITIAL_BITRATE = 1_000_000;

// WORKER: the separate C++ process that actually moves media packets.
const worker = await mediasoup.createWorker({ rtcMinPort: 40000, rtcMaxPort: 40100 });
worker.on("died", () => {
    console.error("mediasoup worker died, exiting");
    process.exit(1);
});

// roomId -> Promise<{ router, peers }>. Stored as a promise so two people
// joining at the same moment can't create two routers for one room.
const rooms = new Map();

// ROUTER: one per meeting room; forwards every producer to the consumers in that room.
const getRoom = (roomId) => {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, worker.createRouter({ mediaCodecs }).then((router) => ({ router, peers: new Map() })));
    }
    return rooms.get(roomId);
};

const listenInfo = (protocol) => ({
    protocol,
    ip: LISTEN_IP,
    ...(ANNOUNCED_IP ? { announcedAddress: ANNOUNCED_IP } : {}),
});

const app = express();
app.use(express.static("public"));

app.get("/stats", async (_req, res) => {
    const usage = await worker.getResourceUsage();
    // Total CPU time (ms) the media worker has used since it started.
    const out = { workerCpuMs: usage.ru_utime + usage.ru_stime };
    for (const [roomId, roomPromise] of rooms) {
        const room = await roomPromise;
        out[roomId] = [...room.peers.values()].reduce(
            (acc, p) => ({
                peers: acc.peers + 1,
                producers: acc.producers + p.producers.size,
                consumers: acc.consumers + p.consumers.size,
            }),
            { peers: 0, producers: 0, consumers: 0 }
        );
    }
    res.json(out);
});

const httpServer = createServer(app);
const io = new Server(httpServer);

io.on("connection", (socket) => {
    let roomId = null;
    let room = null;
    let peer = null;

    // Every request gets exactly one reply: the result, or { error }.
    const handle = (event, fn) => socket.on(event, async (data, reply) => {
        try {
            reply(await fn(data || {}));
        } catch (e) {
            console.error(`${event} failed:`, e.message);
            reply({ error: e.message });
        }
    });

    const transportFor = (transportId) => {
        const transport = peer && peer.transports.get(transportId);
        if (!transport) throw new Error("unknown transport");
        return transport;
    };

    handle("join", async ({ roomId: requested }) => {
        if (typeof requested !== "string" || !requested) throw new Error("roomId required");
        roomId = requested;
        room = await getRoom(roomId);
        peer = { transports: new Map(), producers: new Map(), consumers: new Map() };
        room.peers.set(socket.id, peer);
        socket.join(roomId);

        const existingProducers = [];
        for (const [peerId, other] of room.peers) {
            if (peerId === socket.id) continue;
            for (const producer of other.producers.values()) existingProducers.push({ producerId: producer.id, peerId });
        }
        return { rtpCapabilities: room.router.rtpCapabilities, existingProducers };
    });

    // TRANSPORT: one WebRTC connection between this browser and the server.
    // Each browser makes two: one to send, one to receive.
    handle("createTransport", async () => {
        if (!room) throw new Error("join first");
        const transport = await room.router.createWebRtcTransport({
            listenInfos: [listenInfo("udp"), listenInfo("tcp")],
            preferUdp: true,
            initialAvailableOutgoingBitrate: INITIAL_BITRATE,
        });
        peer.transports.set(transport.id, transport);
        return {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        };
    });

    handle("connectTransport", async ({ transportId, dtlsParameters }) => {
        await transportFor(transportId).connect({ dtlsParameters });
        return {};
    });

    // PRODUCER: a track this browser sends (camera or mic). Sent once,
    // no matter how many people are in the room.
    handle("produce", async ({ transportId, kind, rtpParameters }) => {
        const producer = await transportFor(transportId).produce({ kind, rtpParameters });
        peer.producers.set(producer.id, producer);
        producer.on("transportclose", () => peer.producers.delete(producer.id));
        socket.to(roomId).emit("newProducer", { producerId: producer.id, peerId: socket.id });
        return { id: producer.id };
    });

    // CONSUMER: a copy of someone else's producer, delivered to this browser.
    // Created paused so no video is lost before the browser is ready for it.
    handle("consume", async ({ transportId, producerId, rtpCapabilities }) => {
        if (!room.router.canConsume({ producerId, rtpCapabilities })) throw new Error("cannot consume");
        const consumer = await transportFor(transportId).consume({ producerId, rtpCapabilities, paused: true });
        peer.consumers.set(consumer.id, consumer);
        consumer.on("transportclose", () => peer.consumers.delete(consumer.id));
        consumer.on("producerclose", () => {
            peer.consumers.delete(consumer.id);
            socket.emit("consumerClosed", { consumerId: consumer.id });
        });
        return { id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters };
    });

    handle("resumeConsumer", async ({ consumerId }) => {
        const consumer = peer.consumers.get(consumerId);
        if (!consumer) throw new Error("unknown consumer");
        await consumer.resume();
        return {};
    });

    socket.on("disconnect", () => {
        if (!room) return;
        // Closing a transport also closes its producers and consumers, which
        // fires "producerclose" for everyone who was watching this person.
        for (const transport of peer.transports.values()) transport.close();
        room.peers.delete(socket.id);
        socket.to(roomId).emit("peerLeft", { peerId: socket.id });
        if (room.peers.size === 0) {
            room.router.close();
            rooms.delete(roomId);
        }
    });
});

httpServer.listen(PORT, () => console.log(`SFU lab on http://localhost:${PORT}  (mediasoup ${mediasoup.version})`));

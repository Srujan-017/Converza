import { Device } from "mediasoup-client";

const request = (socket, event, data = {}) => new Promise((resolve, reject) => {
    socket.emit(event, data, (res) => (res && res.error ? reject(new Error(res.error)) : resolve(res)));
});

// Asked before join-call. Resolves false if the server has no SFU (or an
// older server doesn't answer), so the meeting falls back to peer-to-peer.
export const isSfuAvailable = (socket, timeoutMs = 3000) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.emit("sfu:status", (res) => {
        clearTimeout(timer);
        resolve(!!(res && res.available));
    });
});

const isLive = (track) => track && track.readyState === "live";

// One person's SFU connection: sends their camera and mic once to the
// server and receives everyone else's. The meeting page only calls
// start(), setLocalStream() and close().
//
// onRemoteChange(peerId, remote) is called whenever a remote person's media
// changes. remote is { stream, videoOff, audioOff }, or null when nothing
// is left from that person.
export class SfuSession {
    constructor(socket, { onRemoteChange, onError }) {
        this.socket = socket;
        this.onRemoteChange = onRemoteChange;
        this.onError = onError || ((e) => console.error(e));
        this.device = null;
        this.sendTransport = null;
        this.recvTransport = null;
        this.producers = {}; // "camera" | "mic" -> Producer
        this.remotes = new Map(); // peerId -> Map<consumerId, { consumer, source, paused }>
        this.queue = Promise.resolve();
        this.latestStream = null;
        this.closed = false;
        // Queued like everything else, so "closed"/"paused" for a stream can
        // never be handled before that stream has finished being set up.
        this.listeners = {
            "sfu:new-producer": (p) => this.enqueue(() => this.consume(p.producerId)),
            "sfu:consumer-closed": ({ consumerId }) => this.enqueue(() => this.removeConsumer(consumerId)),
            "sfu:consumer-paused": ({ consumerId }) => this.enqueue(() => this.setConsumerPaused(consumerId, true)),
            "sfu:consumer-resumed": ({ consumerId }) => this.enqueue(() => this.setConsumerPaused(consumerId, false)),
        };
    }

    // Runs SFU work one step at a time, so a camera switch can never
    // overlap with joining or with another switch.
    enqueue(task) {
        this.queue = this.queue
            .then(() => (this.closed ? undefined : task()))
            .catch((e) => this.onError(e));
        return this.queue;
    }

    async start() {
        Object.entries(this.listeners).forEach(([event, fn]) => this.socket.on(event, fn));
        return this.enqueue(async () => {
            const { routerRtpCapabilities, existingProducers } = await request(this.socket, "sfu:join");
            this.device = new Device();
            await this.device.load({ routerRtpCapabilities });
            this.sendTransport = await this.createTransport("send");
            this.recvTransport = await this.createTransport("recv");
            await this.applyLocalStream();
            for (const p of existingProducers) await this.consume(p.producerId);
        });
    }

    async createTransport(direction) {
        const params = await request(this.socket, "sfu:create-transport");
        const transport = direction === "send"
            ? this.device.createSendTransport(params)
            : this.device.createRecvTransport(params);

        transport.on("connect", ({ dtlsParameters }, callback, errback) => {
            request(this.socket, "sfu:connect-transport", { transportId: transport.id, dtlsParameters })
                .then(callback, errback);
        });
        if (direction === "send") {
            transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
                request(this.socket, "sfu:produce", { transportId: transport.id, kind, rtpParameters, appData })
                    .then(({ id }) => callback({ id }), errback);
            });
        }
        transport.on("connectionstatechange", (state) => {
            if (state === "failed") this.onError(new Error(`SFU ${direction} connection failed`));
        });
        return transport;
    }

    // Call whenever the local camera/mic stream changes (join, camera or
    // mic toggle, screen share start/stop). Sends whatever live tracks the
    // stream has, and pauses camera or mic when there is no live track.
    setLocalStream(stream) {
        this.latestStream = stream;
        return this.enqueue(() => this.applyLocalStream());
    }

    async applyLocalStream() {
        if (!this.sendTransport) return;
        const stream = this.latestStream;
        for (const [source, kind] of [["camera", "video"], ["mic", "audio"]]) {
            const track = stream ? stream.getTracks().find((t) => t.kind === kind && isLive(t)) : null;
            const producer = this.producers[source];

            if (!producer) {
                if (!track) continue;
                this.producers[source] = await this.sendTransport.produce({
                    track,
                    appData: { source },
                    ...(kind === "video" ? { codecOptions: { videoGoogleStartBitrate: 1000 } } : {}),
                });
                continue;
            }

            if (track) {
                if (producer.track !== track) await producer.replaceTrack({ track });
                if (producer.paused) {
                    producer.resume();
                    await request(this.socket, "sfu:resume-producer", { producerId: producer.id });
                }
            } else if (!producer.paused) {
                producer.pause();
                await request(this.socket, "sfu:pause-producer", { producerId: producer.id });
            }
        }
    }

    async consume(producerId) {
        if (!this.recvTransport) return;
        const params = await request(this.socket, "sfu:consume", {
            transportId: this.recvTransport.id,
            producerId,
            rtpCapabilities: this.device.rtpCapabilities,
        });
        const consumer = await this.recvTransport.consume(params);
        if (!this.remotes.has(params.peerId)) this.remotes.set(params.peerId, new Map());
        this.remotes.get(params.peerId).set(consumer.id, {
            consumer,
            source: params.source,
            paused: params.producerPaused,
        });
        try {
            await request(this.socket, "sfu:resume-consumer", { consumerId: consumer.id });
        } catch (e) {
            // The person left or stopped that stream while we were setting it up.
            if (e.message === "unknown consumer") {
                this.removeConsumer(consumer.id);
                return;
            }
            throw e;
        }
        this.emitRemote(params.peerId);
    }

    findConsumer(consumerId) {
        for (const [peerId, consumers] of this.remotes) {
            if (consumers.has(consumerId)) return { peerId, consumers, entry: consumers.get(consumerId) };
        }
        return null;
    }

    removeConsumer(consumerId) {
        const found = this.findConsumer(consumerId);
        if (!found) return;
        found.entry.consumer.close();
        found.consumers.delete(consumerId);
        if (found.consumers.size === 0) this.remotes.delete(found.peerId);
        this.emitRemote(found.peerId);
    }

    setConsumerPaused(consumerId, paused) {
        const found = this.findConsumer(consumerId);
        if (!found) return;
        found.entry.paused = paused;
        this.emitRemote(found.peerId);
    }

    emitRemote(peerId) {
        const consumers = this.remotes.get(peerId);
        if (!consumers) {
            this.onRemoteChange(peerId, null);
            return;
        }
        const entries = [...consumers.values()];
        const active = (kind) => entries.find((e) => e.consumer.kind === kind && !e.paused);
        const tracks = entries.filter((e) => !e.paused).map((e) => e.consumer.track);
        this.onRemoteChange(peerId, {
            // A new MediaStream each time, so React re-attaches it to the <video>.
            stream: new MediaStream(tracks),
            videoOff: !active("video"),
            audioOff: !active("audio"),
        });
    }

    close() {
        this.closed = true;
        Object.entries(this.listeners).forEach(([event, fn]) => this.socket.off(event, fn));
        for (const consumers of this.remotes.values()) {
            for (const { consumer } of consumers.values()) consumer.close();
        }
        this.remotes.clear();
        if (this.sendTransport) this.sendTransport.close();
        if (this.recvTransport) this.recvTransport.close();
    }
}

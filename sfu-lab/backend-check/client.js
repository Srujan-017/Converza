// Test page for Converza's backend SFU events. It uses the same join-call as
// the real app, then only the new "sfu:" events.
import { Device } from "mediasoup-client";
import { io } from "socket.io-client";

const params = new URLSearchParams(location.search);
const meetingId = params.get("room");
const name = params.get("name") || "Bot";

const state = {
    joined: false,
    ready: false,
    names: {},
    producers: {},
    consumers: {}, // consumerId -> { peerId, kind, source, paused, closed }
    userLeft: [],
    errors: [],
};
window.__check = state;

const socket = io({ transports: ["websocket"] });
const request = (event, data = {}) => new Promise((resolve, reject) => {
    socket.emit(event, data, (res) => (res && res.error ? reject(new Error(res.error)) : resolve(res)));
});
window.__request = request;

let device;
let sendTransport;
let recvTransport;
let recvReady = false;
const waiting = [];
const mediaConsumers = new Map();

const createTransport = async (direction) => {
    const p = await request("sfu:create-transport");
    const transport = direction === "send" ? device.createSendTransport(p) : device.createRecvTransport(p);
    transport.on("connect", ({ dtlsParameters }, cb, eb) => {
        request("sfu:connect-transport", { transportId: transport.id, dtlsParameters }).then(cb, eb);
    });
    if (direction === "send") {
        transport.on("produce", ({ kind, rtpParameters, appData }, cb, eb) => {
            request("sfu:produce", { transportId: transport.id, kind, rtpParameters, appData })
                .then(({ id }) => cb({ id }), eb);
        });
    }
    return transport;
};

const consume = async ({ producerId }) => {
    try {
        const p = await request("sfu:consume", { transportId: recvTransport.id, producerId, rtpCapabilities: device.rtpCapabilities });
        const consumer = await recvTransport.consume(p);
        mediaConsumers.set(consumer.id, consumer);
        state.consumers[consumer.id] = { peerId: p.peerId, kind: p.kind, source: p.source, paused: p.producerPaused, closed: false };
        if (p.kind === "video") {
            const video = document.createElement("video");
            video.autoplay = true;
            video.muted = true;
            video.srcObject = new MediaStream([consumer.track]);
            video.dataset.consumer = consumer.id;
            document.body.append(video);
        }
        await request("sfu:resume-consumer", { consumerId: consumer.id });
    } catch (e) {
        state.errors.push(`consume: ${e.message}`);
    }
};

socket.on("sfu:new-producer", (p) => (recvReady ? consume(p) : waiting.push(p)));
socket.on("sfu:consumer-closed", ({ consumerId }) => {
    if (state.consumers[consumerId]) state.consumers[consumerId].closed = true;
    const c = mediaConsumers.get(consumerId);
    if (c) c.close();
});
socket.on("sfu:consumer-paused", ({ consumerId }) => { if (state.consumers[consumerId]) state.consumers[consumerId].paused = true; });
socket.on("sfu:consumer-resumed", ({ consumerId }) => { if (state.consumers[consumerId]) state.consumers[consumerId].paused = false; });
socket.on("user-joined", (_id, _clients, names) => { if (names) Object.assign(state.names, names); });
socket.on("user-left", (id) => state.userLeft.push(id));

let cameraProducer;
let screenProducer;

window.__pauseCamera = () => request("sfu:pause-producer", { producerId: cameraProducer.id });
window.__resumeCamera = () => request("sfu:resume-producer", { producerId: cameraProducer.id });
window.__startScreen = async () => {
    // A canvas stands in for a real screen capture, which needs a user click.
    const canvas = Object.assign(document.createElement("canvas"), { width: 640, height: 360 });
    const ctx = canvas.getContext("2d");
    setInterval(() => { ctx.fillStyle = `hsl(${Date.now() / 10 % 360} 60% 50%)`; ctx.fillRect(0, 0, 640, 360); }, 50);
    screenProducer = await sendTransport.produce({ track: canvas.captureStream(20).getVideoTracks()[0], appData: { source: "screen" } });
    state.producers.screen = screenProducer.id;
};
window.__stopScreen = async () => {
    await request("sfu:close-producer", { producerId: screenProducer.id });
    screenProducer.close();
};
window.__sendStats = async () => {
    let videoStreams = 0;
    let bytes = 0;
    (await sendTransport.getStats()).forEach((r) => {
        if (r.type === "outbound-rtp" && r.kind === "video") { videoStreams++; bytes += r.bytesSent; }
    });
    return { videoStreams, bytes };
};
window.__recvVideoBytes = async () => {
    let bytes = 0;
    (await recvTransport.getStats()).forEach((r) => {
        if (r.type === "inbound-rtp" && r.kind === "video" && r.trackIdentifier !== "probator") bytes += r.bytesReceived;
    });
    return bytes;
};

socket.on("connect", async () => {
    try {
        const local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        socket.emit("join-call", meetingId, name);
        await new Promise((r) => socket.once("user-joined", r));
        state.joined = true;

        const { routerRtpCapabilities, existingProducers } = await request("sfu:join");
        device = new Device();
        await device.load({ routerRtpCapabilities });
        sendTransport = await createTransport("send");
        recvTransport = await createTransport("recv");

        cameraProducer = await sendTransport.produce({ track: local.getVideoTracks()[0], appData: { source: "camera" } });
        const micProducer = await sendTransport.produce({ track: local.getAudioTracks()[0] });
        state.producers = { camera: cameraProducer.id, mic: micProducer.id };

        recvReady = true;
        for (const p of [...existingProducers, ...waiting.splice(0)]) await consume(p);
        state.ready = true;
    } catch (e) {
        state.errors.push(`start: ${e.message}`);
    }
});

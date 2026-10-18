import { sfuAvailable } from "./workers.js";
import {
    createWebRtcTransport,
    describeProducer,
    findPeer,
    joinPeer,
    otherProducers,
    ownerOfProducer,
} from "./rooms.js";

// A browser needs one send and one receive transport; a little headroom
// allows reconnecting, while stopping a client from opening hundreds.
const MAX_TRANSPORTS_PER_PEER = 4;

// SFU events. All start with "sfu:" so they never clash with the existing
// peer-to-peer events. Every request takes a reply callback that receives
// the result or { error }.
//
// getMeetingId(socketId) returns the meeting this socket joined through the
// existing "join-call", so the SFU room is always the same meeting room.
export const registerSfuHandlers = (io, socket, getMeetingId) => {
    // Asked before join-call, so the browser can pick SFU or peer-to-peer.
    socket.on("sfu:status", (reply) => {
        if (typeof reply === "function") reply({ available: sfuAvailable() });
    });

    const handle = (event, fn) => socket.on(event, async (data, reply) => {
        if (typeof reply !== "function") return;
        try {
            if (!sfuAvailable()) throw new Error("SFU unavailable");
            reply(await fn(data && typeof data === "object" ? data : {}));
        } catch (e) {
            console.error(`${event} failed for ${socket.id}:`, e.message);
            reply({ error: e.message });
        }
    });

    const current = async () => {
        const found = await findPeer(socket.id);
        if (!found) throw new Error("call sfu:join first");
        return found;
    };

    const transportOf = (peer, transportId) => {
        const transport = peer.transports.get(transportId);
        if (!transport) throw new Error("unknown transport");
        return transport;
    };

    const ownProducer = (peer, producerId) => {
        const producer = peer.producers.get(producerId);
        if (!producer) throw new Error("unknown producer");
        return producer;
    };

    const toOthersInRoom = (room, event, payload) => {
        for (const peerId of room.peers.keys()) {
            if (peerId !== socket.id) io.to(peerId).emit(event, payload);
        }
    };

    handle("sfu:join", async () => {
        const meetingId = getMeetingId(socket.id);
        if (!meetingId) throw new Error("join-call first");
        const { room } = await joinPeer(meetingId, socket.id);
        return {
            routerRtpCapabilities: room.router.rtpCapabilities,
            existingProducers: otherProducers(room, socket.id),
        };
    });

    handle("sfu:create-transport", async () => {
        const { room, peer } = await current();
        if (peer.transports.size >= MAX_TRANSPORTS_PER_PEER) throw new Error("too many transports");
        const transport = await createWebRtcTransport(room.router);
        peer.transports.set(transport.id, transport);
        transport.on("routerclose", () => peer.transports.delete(transport.id));
        return {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        };
    });

    handle("sfu:connect-transport", async ({ transportId, dtlsParameters }) => {
        const { peer } = await current();
        await transportOf(peer, transportId).connect({ dtlsParameters });
        return {};
    });

    handle("sfu:produce", async ({ transportId, kind, rtpParameters, appData }) => {
        const { room, peer } = await current();
        const source = kind === "audio" ? "mic" : appData && appData.source === "screen" ? "screen" : "camera";
        const producer = await transportOf(peer, transportId).produce({ kind, rtpParameters, appData: { source } });
        peer.producers.set(producer.id, producer);
        producer.on("transportclose", () => peer.producers.delete(producer.id));
        toOthersInRoom(room, "sfu:new-producer", describeProducer(producer, socket.id));
        return { id: producer.id };
    });

    // Camera/mic off and on. Pausing on the server also stops forwarding and
    // tells everyone watching, so they can show a "camera off"/"muted" state.
    handle("sfu:pause-producer", async ({ producerId }) => {
        const { peer } = await current();
        await ownProducer(peer, producerId).pause();
        return {};
    });

    handle("sfu:resume-producer", async ({ producerId }) => {
        const { peer } = await current();
        await ownProducer(peer, producerId).resume();
        return {};
    });

    // e.g. stopping a screen share.
    handle("sfu:close-producer", async ({ producerId }) => {
        const { peer } = await current();
        ownProducer(peer, producerId).close();
        peer.producers.delete(producerId);
        return {};
    });

    // Consumers start paused so no video is sent before the browser is ready.
    handle("sfu:consume", async ({ transportId, producerId, rtpCapabilities }) => {
        const { room, peer } = await current();
        if (!room.router.canConsume({ producerId, rtpCapabilities })) throw new Error("cannot consume this producer");
        const peerId = ownerOfProducer(room, producerId);
        if (!peerId || peerId === socket.id) throw new Error("cannot consume this producer");

        const consumer = await transportOf(peer, transportId).consume({ producerId, rtpCapabilities, paused: true });
        peer.consumers.set(consumer.id, consumer);

        const tell = (event) => () => socket.emit(event, { consumerId: consumer.id, producerId });
        consumer.on("transportclose", () => peer.consumers.delete(consumer.id));
        consumer.on("producerclose", () => {
            peer.consumers.delete(consumer.id);
            tell("sfu:consumer-closed")();
        });
        consumer.on("producerpause", tell("sfu:consumer-paused"));
        consumer.on("producerresume", tell("sfu:consumer-resumed"));

        const producer = room.peers.get(peerId).producers.get(producerId);
        return {
            id: consumer.id,
            producerId,
            peerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            source: producer.appData.source,
            producerPaused: consumer.producerPaused,
        };
    });

    handle("sfu:resume-consumer", async ({ consumerId }) => {
        const { peer } = await current();
        const consumer = peer.consumers.get(consumerId);
        if (!consumer) throw new Error("unknown consumer");
        await consumer.resume();
        return {};
    });
};

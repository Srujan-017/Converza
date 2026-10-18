import { sfuConfig } from "./config.js";
import { nextWorker, onWorkerDied } from "./workers.js";

// meetingId -> Promise<room>. A promise, so two people joining at the same
// moment share one router instead of each creating their own.
// room = { id, worker, router, peers: Map<socketId, peer> }
// peer = { transports, producers, consumers }  (each a Map by id)
const rooms = new Map();
const meetingOfSocket = new Map();

const getOrCreateRoom = (meetingId) => {
    if (!rooms.has(meetingId)) {
        const worker = nextWorker();
        const created = worker
            .createRouter({ mediaCodecs: sfuConfig.mediaCodecs })
            .then((router) => ({ id: meetingId, worker, router, peers: new Map() }));
        created.catch(() => rooms.delete(meetingId));
        rooms.set(meetingId, created);
    }
    return rooms.get(meetingId);
};

export const joinPeer = async (meetingId, socketId) => {
    const room = await getOrCreateRoom(meetingId);
    // The last person may have left (closing the router) while we waited.
    if (room.router.closed) return joinPeer(meetingId, socketId);

    if (!room.peers.has(socketId)) {
        room.peers.set(socketId, { transports: new Map(), producers: new Map(), consumers: new Map() });
    }
    meetingOfSocket.set(socketId, meetingId);
    return { room, peer: room.peers.get(socketId) };
};

export const findPeer = async (socketId) => {
    const meetingId = meetingOfSocket.get(socketId);
    if (!meetingId || !rooms.has(meetingId)) return null;
    const room = await rooms.get(meetingId);
    const peer = room.peers.get(socketId);
    return peer ? { room, peer } : null;
};

export const createWebRtcTransport = (router) => router.createWebRtcTransport({
    listenInfos: ["udp", "tcp"].map((protocol) => ({
        protocol,
        ip: sfuConfig.listenIp,
        ...(sfuConfig.announcedAddress ? { announcedAddress: sfuConfig.announcedAddress } : {}),
        portRange: sfuConfig.portRange,
    })),
    preferUdp: true,
    initialAvailableOutgoingBitrate: sfuConfig.initialAvailableOutgoingBitrate,
});

export const describeProducer = (producer, peerId) => ({
    producerId: producer.id,
    peerId,
    kind: producer.kind,
    source: producer.appData.source,
    paused: producer.paused,
});

export const otherProducers = (room, socketId) => {
    const list = [];
    for (const [peerId, peer] of room.peers) {
        if (peerId === socketId) continue;
        for (const producer of peer.producers.values()) list.push(describeProducer(producer, peerId));
    }
    return list;
};

export const ownerOfProducer = (room, producerId) => {
    for (const [peerId, peer] of room.peers) {
        if (peer.producers.has(producerId)) return peerId;
    }
    return null;
};

export const removePeer = async (socketId) => {
    const meetingId = meetingOfSocket.get(socketId);
    meetingOfSocket.delete(socketId);
    if (!meetingId || !rooms.has(meetingId)) return;

    const roomPromise = rooms.get(meetingId);
    const room = await roomPromise;
    const peer = room.peers.get(socketId);
    if (peer) {
        // Closing a transport closes its producers and consumers too, which
        // notifies everyone who was receiving this person's media.
        for (const transport of peer.transports.values()) transport.close();
        room.peers.delete(socketId);
    }
    if (room.peers.size === 0 && rooms.get(meetingId) === roomPromise) {
        room.router.close();
        rooms.delete(meetingId);
    }
};

// A dead worker takes its routers with it; forget those rooms so the next
// person to join gets a fresh router on a healthy worker.
onWorkerDied(async (deadWorker) => {
    for (const [meetingId, roomPromise] of rooms) {
        const room = await roomPromise.catch(() => null);
        if (!room || room.worker !== deadWorker) continue;
        for (const socketId of room.peers.keys()) meetingOfSocket.delete(socketId);
        rooms.delete(meetingId);
    }
});

export const roomStats = async () => {
    const out = {};
    for (const [meetingId, roomPromise] of rooms) {
        const room = await roomPromise.catch(() => null);
        if (!room) continue;
        let producers = 0;
        let consumers = 0;
        for (const peer of room.peers.values()) {
            producers += peer.producers.size;
            consumers += peer.consumers.size;
        }
        out[meetingId] = { peers: room.peers.size, producers, consumers };
    }
    return out;
};

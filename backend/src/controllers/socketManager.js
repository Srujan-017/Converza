import { Server } from "socket.io"
import { registerSfuHandlers } from "../sfu/signaling.js"
import { removePeer as removeSfuPeer } from "../sfu/rooms.js"


let connections = {}
let messages = {}
// Tracks who (if anyone) is currently screen-sharing in each room, so that
// a participant who joins mid-share (or refreshes) can be told immediately
// instead of only finding out on the next toggle.
let screenShares = {}
// Display name for each connected socket, so every tile can show who it is.
let participantNames = {}

const MAX_NAME_LENGTH = 50

const cleanDisplayName = (name) => {
    if (typeof name !== "string") return "Participant"
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH)
    return trimmed || "Participant"
}

const namesForRoom = (room) => {
    const names = {}
    connections[room].forEach((id) => {
        names[id] = participantNames[id] || "Participant"
    })
    return names
}

// Shared by chat-message and screen-share-toggle: finds which room a given
// socket currently belongs to.
const findRoomForSocket = (socketId) => {
    return Object.entries(connections)
        .reduce(([room, isFound], [roomKey, roomValue]) => {
            if (!isFound && roomValue.includes(socketId)) {
                return [roomKey, true];
            }
            return [room, isFound];
        }, ['', false]);
}

export const connectToSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            allowedHeaders: ["*"],
            credentials: true
        }
    });


    io.on("connection", (socket) => {

        // SFU events use the same meeting room this socket joined via join-call.
        registerSfuHandlers(io, socket, (socketId) => {
            const [room, found] = findRoomForSocket(socketId)
            return found ? room : null
        })

        socket.on("join-call", (path, displayName) => {

            if (typeof path !== "string" || path.length === 0) return

            if (connections[path] === undefined) {
                connections[path] = []
            }
            connections[path].push(socket.id)

            participantNames[socket.id] = cleanDisplayName(displayName)

            const names = namesForRoom(path)
            for (let a = 0; a < connections[path].length; a++) {
                io.to(connections[path][a]).emit("user-joined", socket.id, connections[path], names)
            }

            if (messages[path] !== undefined) {
                for (let a = 0; a < messages[path].length; ++a) {
                    io.to(socket.id).emit("chat-message", messages[path][a]['data'],
                        messages[path][a]['sender'], messages[path][a]['socket-id-sender'])
                }
            }

            // If someone is already presenting their screen when this
            // participant joins, tell them right away so their UI opens
            // straight into the full-screen spotlight view instead of a
            // regular tile.
            if (screenShares[path] && screenShares[path].sharing) {
                io.to(socket.id).emit("screen-share-status", screenShares[path].socketId, true)
            }

        })

        socket.on("signal", (toId, message) => {
            // Only relay WebRTC setup messages between two people in the same
            // room, so nobody can push signals to a socket in another meeting.
            const [room, found] = findRoomForSocket(socket.id);
            if (!found || !connections[room].includes(toId)) return

            io.to(toId).emit("signal", socket.id, message);
        })

        socket.on("chat-message", (data, sender) => {

            const [matchingRoom, found] = findRoomForSocket(socket.id);

            if (found === true) {
                if (messages[matchingRoom] === undefined) {
                    messages[matchingRoom] = []
                }

                messages[matchingRoom].push({ 'sender': sender, "data": data, "socket-id-sender": socket.id })

                connections[matchingRoom].forEach((elem) => {
                    io.to(elem).emit("chat-message", data, sender, socket.id)
                })
            }

        })

        // A participant started or stopped sharing their screen. Broadcast
        // it to everyone else in the same room so every client can switch
        // that presenter's tile into (or out of) a full-screen spotlight —
        // the same way Zoom/Meet promote an active screen share.
        socket.on("screen-share-toggle", (sharing) => {

            const [matchingRoom, found] = findRoomForSocket(socket.id);

            if (found === true) {
                if (sharing) {
                    screenShares[matchingRoom] = { socketId: socket.id, sharing: true }
                } else if (screenShares[matchingRoom] && screenShares[matchingRoom].socketId === socket.id) {
                    delete screenShares[matchingRoom]
                }

                connections[matchingRoom].forEach((elem) => {
                    io.to(elem).emit("screen-share-status", socket.id, sharing)
                })
            }

        })

        socket.on("disconnect", () => {

            var key

            for (const [k, v] of JSON.parse(JSON.stringify(Object.entries(connections)))) {

                for (let a = 0; a < v.length; ++a) {
                    if (v[a] === socket.id) {
                        key = k

                        for (let a = 0; a < connections[key].length; ++a) {
                            io.to(connections[key][a]).emit('user-left', socket.id)
                        }

                        var index = connections[key].indexOf(socket.id)

                        connections[key].splice(index, 1)

                        // If the participant who left was the active
                        // presenter, clear the room's screen-share record so
                        // stale state doesn't leak into the next joiner.
                        if (screenShares[key] && screenShares[key].socketId === socket.id) {
                            delete screenShares[key]
                        }

                        // Last person left: forget the whole room, including
                        // its chat, so a later meeting reusing this code
                        // starts clean and server memory doesn't keep growing.
                        if (connections[key].length === 0) {
                            delete connections[key]
                            delete messages[key]
                            delete screenShares[key]
                        }
                    }
                }

            }

            delete participantNames[socket.id]

            removeSfuPeer(socket.id).catch((e) => console.error("SFU cleanup failed:", e.message))


        })


    })


    return io;
}


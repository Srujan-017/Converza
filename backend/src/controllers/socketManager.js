import { Server } from "socket.io"


let connections = {}
let messages = {}
let timeOnline = {}
// Tracks who (if anyone) is currently screen-sharing in each room, so that
// a participant who joins mid-share (or refreshes) can be told immediately
// instead of only finding out on the next toggle.
let screenShares = {}

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

        console.log("SOMETHING CONNECTED")

        socket.on("join-call", (path) => {

            if (connections[path] === undefined) {
                connections[path] = []
            }
            connections[path].push(socket.id)

            timeOnline[socket.id] = new Date();

            // connections[path].forEach(elem => {
            //     io.to(elem)
            // })

            for (let a = 0; a < connections[path].length; a++) {
                io.to(connections[path][a]).emit("user-joined", socket.id, connections[path])
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
            io.to(toId).emit("signal", socket.id, message);
        })

        socket.on("chat-message", (data, sender) => {

            const [matchingRoom, found] = findRoomForSocket(socket.id);

            if (found === true) {
                if (messages[matchingRoom] === undefined) {
                    messages[matchingRoom] = []
                }

                messages[matchingRoom].push({ 'sender': sender, "data": data, "socket-id-sender": socket.id })
                console.log("message", matchingRoom, ":", sender, data)

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

            var diffTime = Math.abs(timeOnline[socket.id] - new Date())

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

                        if (connections[key].length === 0) {
                            delete connections[key]
                        }
                    }
                }

            }


        })


    })


    return io;
}


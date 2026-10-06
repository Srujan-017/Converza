import React, { useEffect, useRef, useState } from 'react'
import io from "socket.io-client";
import { Badge, IconButton, TextField } from '@mui/material';
import { Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import styles from "../styles/videoComponent.module.css";
import CallEndIcon from '@mui/icons-material/CallEnd'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import ChatIcon from '@mui/icons-material/Chat'
import CloseIcon from '@mui/icons-material/Close'
import SendIcon from '@mui/icons-material/Send'
import server from '../environment';

const server_url = server;

var connections = {};

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" }
    ]
}

// RTCPeerConnection.addStream() / the onaddstream event are legacy WebRTC APIs
// that modern browsers no longer reliably support. This helper adds each
// track individually via addTrack(), which is the current standard API and
// what pairs correctly with the ontrack event used below.
let addStreamToConnection = (peerConnection, stream) => {
    if (!peerConnection || !stream) return
    stream.getTracks().forEach((track) => {
        try {
            peerConnection.addTrack(track, stream)
        } catch (e) {
            console.log(e)
        }
    })
}

export default function VideoMeetComponent() {

    var socketRef = useRef();
    let socketIdRef = useRef();

    let localVideoref = useRef();

    let [videoAvailable, setVideoAvailable] = useState(true);

    let [audioAvailable, setAudioAvailable] = useState(true);

    let [video, setVideo] = useState(true);

    let [audio, setAudio] = useState();

    let [screen, setScreen] = useState();

    let [showModal, setModal] = useState(true);

    let [screenAvailable, setScreenAvailable] = useState();

    let [messages, setMessages] = useState([])

    let [message, setMessage] = useState("");

    let [newMessages, setNewMessages] = useState(0);

    let [askForUsername, setAskForUsername] = useState(true);

    // Pre-populate from sessionStorage when the user arrives via the guest join flow
    let [username, setUsername] = useState(() => sessionStorage.getItem('guestName') || "");

    const videoRef = useRef([])

    let [videos, setVideos] = useState([])

    // socketId of whoever is currently sharing their screen (or null if no
    // one is). When set, the meeting switches to a Zoom-style full-screen
    // spotlight for that person's video instead of the regular grid.
    let [screenSharingId, setScreenSharingId] = useState(null)

    // TODO
    // if(isChrome() === false) {


    // }

    useEffect(() => {
        getPermissions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Clean up media tracks, socket, and peer connections on unmount
    useEffect(() => {
        return () => {
            try {
                if (window.localStream) {
                    window.localStream.getTracks().forEach(track => track.stop());
                }
            } catch (e) { }
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
            for (let id in connections) {
                try { connections[id].close(); } catch (e) { }
            }
            Object.keys(connections).forEach(key => delete connections[key]);
            sessionStorage.removeItem('guestName');
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    let getDislayMedia = () => {
        if (screen) {
            if (navigator.mediaDevices.getDisplayMedia) {
                navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
                    .then(getDislayMediaSuccess)
                    .then((stream) => { })
                    .catch((e) => console.log(e))
            }
        }
    }

    const getPermissions = async () => {
        // Use local variables to avoid reading stale React state after async awaits
        let videoPermissionGranted = false;
        let audioPermissionGranted = false;

        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            videoStream.getTracks().forEach(t => t.stop());
            videoPermissionGranted = true;
            setVideoAvailable(true);
            console.log('Video permission granted');
        } catch (e) {
            setVideoAvailable(false);
            console.log('Video permission denied');
        }

        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioStream.getTracks().forEach(t => t.stop());
            audioPermissionGranted = true;
            setAudioAvailable(true);
            console.log('Audio permission granted');
        } catch (e) {
            setAudioAvailable(false);
            console.log('Audio permission denied');
        }

        if (navigator.mediaDevices.getDisplayMedia) {
            setScreenAvailable(true);
        } else {
            setScreenAvailable(false);
        }

        if (videoPermissionGranted || audioPermissionGranted) {
            try {
                const userMediaStream = await navigator.mediaDevices.getUserMedia({
                    video: videoPermissionGranted,
                    audio: audioPermissionGranted
                });
                if (userMediaStream) {
                    window.localStream = userMediaStream;
                    if (localVideoref.current) {
                        localVideoref.current.srcObject = userMediaStream;
                    }
                }
            } catch (error) {
                console.log(error);
            }
        }
    };

    useEffect(() => {
        if (video !== undefined && audio !== undefined) {
            getUserMedia();
            console.log("SET STATE HAS ", video, audio);

        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [video, audio])
    let getMedia = () => {
        setVideo(videoAvailable);
        setAudio(audioAvailable);
        connectToSocketServer();

    }




    let getUserMediaSuccess = (stream) => {
        try {
            window.localStream.getTracks().forEach(track => track.stop())
        } catch (e) { console.log(e) }

        window.localStream = stream
        localVideoref.current.srcObject = stream

        for (let id in connections) {
            if (id === socketIdRef.current) continue

            addStreamToConnection(connections[id], window.localStream)

            connections[id].createOffer().then((description) => {
                console.log(description)
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                    })
                    .catch(e => console.log(e))
            })
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setVideo(false);
            setAudio(false);

            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { console.log(e) }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()])
            window.localStream = blackSilence()
            localVideoref.current.srcObject = window.localStream

            for (let id in connections) {
                addStreamToConnection(connections[id], window.localStream)

                connections[id].createOffer().then((description) => {
                    connections[id].setLocalDescription(description)
                        .then(() => {
                            socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                        })
                        .catch(e => console.log(e))
                })
            }
        })
    }

    let getUserMedia = () => {
        if ((video && videoAvailable) || (audio && audioAvailable)) {
            navigator.mediaDevices.getUserMedia({ video: video, audio: audio })
                .then(getUserMediaSuccess)
                .then((stream) => { })
                .catch((e) => console.log(e))
        } else {
            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { }
        }
    }





    let getDislayMediaSuccess = (stream) => {
        console.log("HERE")
        try {
            window.localStream.getTracks().forEach(track => track.stop())
        } catch (e) { console.log(e) }

        window.localStream = stream
        localVideoref.current.srcObject = stream

        // Screen sharing has started successfully: tell everyone else in
        // the call so their UI can promote this tile to the full-screen
        // spotlight, and mark it locally too.
        setScreenSharingId(socketIdRef.current)
        if (socketRef.current) {
            socketRef.current.emit('screen-share-toggle', true)
        }

        for (let id in connections) {
            if (id === socketIdRef.current) continue

            addStreamToConnection(connections[id], window.localStream)

            connections[id].createOffer().then((description) => {
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                    })
                    .catch(e => console.log(e))
            })
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setScreen(false)

            // The browser's own "Stop sharing" control (or the OS/tab
            // picker being closed) ends the track directly, bypassing our
            // button handler — so we announce the stop here too.
            setScreenSharingId(null)
            if (socketRef.current) {
                socketRef.current.emit('screen-share-toggle', false)
            }

            try {
                let tracks = localVideoref.current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { console.log(e) }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()])
            window.localStream = blackSilence()
            localVideoref.current.srcObject = window.localStream

            getUserMedia()

        })
    }

    let gotMessageFromServer = (fromId, message) => {
        var signal = JSON.parse(message)

        if (fromId !== socketIdRef.current) {
            if (signal.sdp) {
                connections[fromId].setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
                    if (signal.sdp.type === 'offer') {
                        connections[fromId].createAnswer().then((description) => {
                            connections[fromId].setLocalDescription(description).then(() => {
                                socketRef.current.emit('signal', fromId, JSON.stringify({ 'sdp': connections[fromId].localDescription }))
                            }).catch(e => console.log(e))
                        }).catch(e => console.log(e))
                    }
                }).catch(e => console.log(e))
            }

            if (signal.ice) {
                connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.log(e))
            }
        }
    }




    let connectToSocketServer = () => {
        socketRef.current = io.connect(server_url)

        socketRef.current.on('signal', gotMessageFromServer)

        socketRef.current.on('connect', () => {
            // Derive the room ID from the pathname only (strip leading slash).
            // Using the full href would make "abc123" and "abc123?guest=true"
            // land in different rooms, breaking multi-user synchronization.
            const meetingId = window.location.pathname.replace(/^\/+/, '');
            socketRef.current.emit('join-call', meetingId)
            socketIdRef.current = socketRef.current.id

            socketRef.current.on('chat-message', addMessage)

            socketRef.current.on('user-left', (id) => {
                setVideos((videos) => videos.filter((video) => video.socketId !== id))
                // If the participant who left was the one being spotlighted,
                // fall back to the regular grid instead of showing a dead tile.
                setScreenSharingId((current) => (current === id ? null : current))
            })

            // Another participant (or the server, for someone who joined
            // mid-share) announced a screen-share start/stop. Keep our own
            // spotlight state in sync so this client's layout matches.
            socketRef.current.on('screen-share-status', (fromId, sharing) => {
                setScreenSharingId((current) => {
                    if (sharing) return fromId
                    return current === fromId ? null : current
                })
            })

            socketRef.current.on('user-joined', (id, clients) => {
                clients.forEach((socketListId) => {

                    connections[socketListId] = new RTCPeerConnection(peerConfigConnections)
                    // Wait for their ice candidate       
                    connections[socketListId].onicecandidate = function (event) {
                        if (event.candidate != null) {
                            socketRef.current.emit('signal', socketListId, JSON.stringify({ 'ice': event.candidate }))
                        }
                    }

                    // Wait for their video stream
                    connections[socketListId].ontrack = (event) => {
                        console.log("BEFORE:", videoRef.current);
                        console.log("FINDING ID: ", socketListId);

                        // event.streams[0] holds the remote MediaStream this track belongs to.
                        // ontrack fires once per track (audio/video), but both share the same
                        // stream object, so this stays in sync with the old single-stream logic.
                        const remoteStream = event.streams && event.streams[0]
                            ? event.streams[0]
                            : new MediaStream([event.track]);

                        let videoExists = videoRef.current.find(video => video.socketId === socketListId);

                        if (videoExists) {
                            console.log("FOUND EXISTING");

                            // Update the stream of the existing video
                            setVideos(videos => {
                                const updatedVideos = videos.map(video =>
                                    video.socketId === socketListId ? { ...video, stream: remoteStream } : video
                                );
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        } else {
                            // Create a new video
                            console.log("CREATING NEW");
                            let newVideo = {
                                socketId: socketListId,
                                stream: remoteStream,
                                autoplay: true,
                                playsinline: true
                            };

                            setVideos(videos => {
                                const updatedVideos = [...videos, newVideo];
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        }
                    };


                    // Add the local video stream
                    if (window.localStream !== undefined && window.localStream !== null) {
                        addStreamToConnection(connections[socketListId], window.localStream)
                    } else {
                        let blackSilence = (...args) => new MediaStream([black(...args), silence()])
                        window.localStream = blackSilence()
                        addStreamToConnection(connections[socketListId], window.localStream)
                    }
                })

                if (id === socketIdRef.current) {
                    for (let id2 in connections) {
                        if (id2 === socketIdRef.current) continue

                        try {
                            addStreamToConnection(connections[id2], window.localStream)
                        } catch (e) { }

                        connections[id2].createOffer().then((description) => {
                            connections[id2].setLocalDescription(description)
                                .then(() => {
                                    socketRef.current.emit('signal', id2, JSON.stringify({ 'sdp': connections[id2].localDescription }))
                                })
                                .catch(e => console.log(e))
                        })
                    }
                }
            })
        })
    }

    let silence = () => {
        let ctx = new AudioContext()
        let oscillator = ctx.createOscillator()
        let dst = oscillator.connect(ctx.createMediaStreamDestination())
        oscillator.start()
        ctx.resume()
        return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false })
    }
    let black = ({ width = 640, height = 480 } = {}) => {
        let canvas = Object.assign(document.createElement("canvas"), { width, height })
        canvas.getContext('2d').fillRect(0, 0, width, height)
        let stream = canvas.captureStream()
        return Object.assign(stream.getVideoTracks()[0], { enabled: false })
    }

    let handleVideo = () => {
        setVideo(!video);
        // getUserMedia();
    }
    let handleAudio = () => {
        setAudio(!audio)
        // getUserMedia();
    }

    useEffect(() => {
        if (screen !== undefined) {
            getDislayMedia();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screen])
    // Stops an in-progress screen share started from our own "Share"
    // button (as opposed to the browser's native "Stop sharing" bar, which
    // is already handled by the track.onended listener above) and falls
    // back to the camera, the same way clicking "Stop Share" in Zoom does.
    let stopScreenShare = () => {
        try {
            window.localStream.getTracks().forEach(track => track.stop())
        } catch (e) { console.log(e) }

        setScreen(false)
        setScreenSharingId(null)
        if (socketRef.current) {
            socketRef.current.emit('screen-share-toggle', false)
        }

        getUserMedia()
    }

    let handleScreen = () => {
        if (screen) {
            stopScreenShare()
        } else {
            setScreen(true)
        }
    }

    let handleEndCall = () => {
        try {
            let tracks = localVideoref.current.srcObject.getTracks()
            tracks.forEach(track => track.stop())
        } catch (e) { }
        try {
            if (window.localStream) {
                window.localStream.getTracks().forEach(track => track.stop());
            }
        } catch (e) { }
        if (socketRef.current) {
            socketRef.current.disconnect();
        }
        for (let id in connections) {
            try { connections[id].close(); } catch (e) { }
        }
        Object.keys(connections).forEach(key => delete connections[key]);
        sessionStorage.removeItem('guestName');
        window.location.href = "/"
    }

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((prevNewMessages) => prevNewMessages + 1);
        }
    };



    let sendMessage = () => {
        console.log(socketRef.current);
        socketRef.current.emit('chat-message', message, username)
        setMessage("");

        // this.setState({ message: "", sender: username })
    }

    
    let connect = () => {
        setAskForUsername(false);
        getMedia();
    }

    // Whoever is currently screen-sharing (local or remote) gets promoted
    // to a full-screen spotlight, Zoom/Meet-style; everyone else moves into
    // a thumbnail strip alongside it. Falls back to the regular gallery
    // grid when no one is presenting.
    const isLocalSharing = screenSharingId !== null && screenSharingId === socketIdRef.current;
    const remoteSharer = screenSharingId !== null && !isLocalSharing
        ? videos.find((v) => v.socketId === screenSharingId)
        : null;
    const isSpotlightActive = isLocalSharing || !!remoteSharer;

    return (
        <div>

            {askForUsername === true ?

                <div className={styles.lobbyContainer}>
                    <div className={styles.lobbyCard}>

                        <div className={styles.lobbyPreviewWrap}>
                            <video className={styles.lobbyPreviewVideo} ref={localVideoref} autoPlay muted></video>
                            <div className={styles.lobbyPreviewBadge}>Camera preview</div>
                        </div>

                        <div className={styles.lobbyForm}>
                            <div className={styles.lobbyEyebrow}>Converza meeting</div>
                            <h2 className={styles.lobbyTitle}>Ready to join?</h2>
                            <p className={styles.lobbySubtitle}>Enter your name so others can recognize you in the call.</p>

                            <TextField
                                className={styles.lobbyFormField}
                                id="outlined-basic"
                                label="Username"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                variant="outlined"
                                onKeyDown={(e) => { if (e.key === 'Enter' && username.trim()) connect(); }}
                            />
                            <Button className={styles.lobbyJoinButton} variant="contained" onClick={connect} disabled={!username.trim()}>
                                Join now
                            </Button>
                        </div>

                    </div>
                </div> :


                <div className={styles.meetVideoContainer}>

                    <div className={styles.topBar}>
                        <div className={styles.topBarLeft}>
                            <span className={styles.liveDot}></span>
                            <span className={styles.topBarTitle}>Converza Meeting</span>
                        </div>
                        <div className={styles.topBarRight}>
                            {videos.length + 1} participant{videos.length + 1 !== 1 ? 's' : ''}
                        </div>
                    </div>

                    <div className={styles.meetingBody}>

                        <div className={styles.galleryWrap}>
                            {isSpotlightActive ? (
                                <div className={styles.spotlightLayout}>

                                    <div className={styles.spotlightMain}>
                                        <video
                                            className={styles.spotlightVideo}
                                            ref={isLocalSharing ? localVideoref : (ref) => {
                                                if (ref && remoteSharer && remoteSharer.stream) {
                                                    ref.srcObject = remoteSharer.stream;
                                                }
                                            }}
                                            autoPlay
                                            muted={isLocalSharing}
                                        ></video>
                                        <div className={styles.spotlightBadge}>
                                            <ScreenShareIcon fontSize="small" />
                                            <span>{isLocalSharing ? "You are presenting your screen" : "Participant is presenting their screen"}</span>
                                        </div>
                                    </div>

                                    <div className={styles.spotlightSidebar}>

                                        {!isLocalSharing && (
                                            <div className={styles.spotlightThumb}>
                                                <video className={`${styles.spotlightThumbVideo} ${styles.localTileVideo}`} ref={localVideoref} autoPlay muted></video>
                                                {video === false && (
                                                    <div className={styles.avatarOverlay}>
                                                        <div className={styles.avatarCircle}>
                                                            {username ? username.charAt(0).toUpperCase() : "Y"}
                                                        </div>
                                                    </div>
                                                )}
                                                {audio === false && (
                                                    <div className={styles.tileMicOffIcon}>
                                                        <MicOffIcon fontSize="small" />
                                                    </div>
                                                )}
                                                <div className={styles.tileLabel}>
                                                    <span>{username || "You"} (You)</span>
                                                </div>
                                            </div>
                                        )}

                                        {videos.filter((v) => v.socketId !== screenSharingId).map((video) => (
                                            <div className={styles.spotlightThumb} key={video.socketId}>
                                                <video
                                                    className={styles.spotlightThumbVideo}
                                                    data-socket={video.socketId}
                                                    ref={ref => {
                                                        if (ref && video.stream) {
                                                            ref.srcObject = video.stream;
                                                        }
                                                    }}
                                                    autoPlay
                                                >
                                                </video>
                                                <div className={styles.tileLabel}>
                                                    <span>Participant</span>
                                                </div>
                                            </div>
                                        ))}

                                    </div>

                                </div>
                            ) : (
                                <div className={styles.videoGrid}>

                                    <div className={styles.videoTile}>
                                        <video className={`${styles.tileVideo} ${styles.localTileVideo}`} ref={localVideoref} autoPlay muted></video>
                                        {video === false && (
                                            <div className={styles.avatarOverlay}>
                                                <div className={styles.avatarCircle}>
                                                    {username ? username.charAt(0).toUpperCase() : "Y"}
                                                </div>
                                            </div>
                                        )}
                                        {audio === false && (
                                            <div className={styles.tileMicOffIcon}>
                                                <MicOffIcon fontSize="small" />
                                            </div>
                                        )}
                                        <div className={styles.tileLabel}>
                                            <span>{username || "You"} (You)</span>
                                        </div>
                                    </div>

                                    {videos.map((video) => (
                                        <div className={styles.videoTile} key={video.socketId}>
                                            <video
                                                className={styles.tileVideo}
                                                data-socket={video.socketId}
                                                ref={ref => {
                                                    if (ref && video.stream) {
                                                        ref.srcObject = video.stream;
                                                    }
                                                }}
                                                autoPlay
                                            >
                                            </video>
                                            <div className={styles.tileLabel}>
                                                <span>Participant</span>
                                            </div>
                                        </div>
                                    ))}

                                </div>
                            )}
                        </div>

                        {showModal ? <div className={styles.chatRoom}>

                            <div className={styles.chatContainer}>

                                <div className={styles.chatHeader}>
                                    <h1>Chat</h1>
                                    <IconButton className={styles.chatCloseBtn} size="small" onClick={() => setModal(false)}>
                                        <CloseIcon fontSize="small" />
                                    </IconButton>
                                </div>

                                <div className={styles.chattingDisplay}>

                                    {messages.length !== 0 ? messages.map((item, index) => {
                                        return (
                                            <div className={styles.chatBubble} key={index}>
                                                <p className={styles.chatBubbleSender}>{item.sender}</p>
                                                <p className={styles.chatBubbleText}>{item.data}</p>
                                            </div>
                                        )
                                    }) : <p>No messages yet</p>}


                                </div>

                                <div className={styles.chattingArea}>
                                    <TextField
                                        className={styles.chatInput}
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && message.trim()) sendMessage(); }}
                                        id="outlined-basic"
                                        label="Enter Your chat"
                                        variant="outlined"
                                        size="small"
                                    />
                                    <Button className={styles.chatSendBtn} variant='contained' onClick={sendMessage}>
                                        <SendIcon fontSize="small" />
                                    </Button>
                                </div>

                            </div>
                        </div> : <></>}

                    </div>

                    <div className={styles.buttonContainers}>
                        <div className={styles.controlPill}>

                            <button className={`${styles.controlBtn} ${video === false ? styles.controlBtnOff : ''}`} onClick={handleVideo}>
                                {(video === true) ? <VideocamIcon /> : <VideocamOffIcon />}
                                <span className={styles.controlBtnLabel}>{video === true ? 'Stop Video' : 'Start Video'}</span>
                            </button>

                            <button className={`${styles.controlBtn} ${audio === false ? styles.controlBtnOff : ''}`} onClick={handleAudio}>
                                {audio === true ? <MicIcon /> : <MicOffIcon />}
                                <span className={styles.controlBtnLabel}>{audio === true ? 'Mute' : 'Unmute'}</span>
                            </button>

                            {screenAvailable === true &&
                                <button className={`${styles.controlBtn} ${screen === true ? styles.controlBtnActive : ''}`} onClick={handleScreen}>
                                    {screen === true ? <StopScreenShareIcon /> : <ScreenShareIcon />}
                                    <span className={styles.controlBtnLabel}>{screen === true ? 'Stop Share' : 'Share'}</span>
                                </button>
                            }

                            <button className={styles.controlBtn} onClick={() => setModal(!showModal)}>
                                <Badge className={styles.chatBadge} badgeContent={newMessages} max={999} color='orange'>
                                    <ChatIcon />
                                </Badge>
                                <span className={styles.controlBtnLabel}>Chat</span>
                            </button>

                            <button className={styles.endCallBtn} onClick={handleEndCall}>
                                <CallEndIcon />
                                <span className={styles.controlBtnLabel}>Leave</span>
                            </button>

                        </div>
                    </div>

                </div>

            }

        </div>
    )
}

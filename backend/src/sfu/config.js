import os from "node:os";

const numberFromEnv = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const sfuConfig = {
    // One mediasoup worker per CPU core is the usual setup.
    numWorkers: numberFromEnv("MEDIASOUP_NUM_WORKERS", os.cpus().length),

    // 127.0.0.1 works for local development. On a cloud server, listen on
    // 0.0.0.0 and set MEDIASOUP_ANNOUNCED_ADDRESS to the public IP, so
    // browsers are told the address they can actually reach.
    listenIp: process.env.MEDIASOUP_LISTEN_IP || "127.0.0.1",
    announcedAddress: process.env.MEDIASOUP_ANNOUNCED_ADDRESS || undefined,

    // UDP/TCP ports used for media. Must be open in the server firewall.
    portRange: {
        min: numberFromEnv("MEDIASOUP_MIN_PORT", 40000),
        max: numberFromEnv("MEDIASOUP_MAX_PORT", 49999),
    },

    mediaCodecs: [
        { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
        {
            kind: "video",
            mimeType: "video/VP8",
            clockRate: 90000,
            parameters: { "x-google-start-bitrate": 1000 },
        },
    ],

    // Start bandwidth estimates near 1 Mbps; starting lower makes Chrome
    // downscale the camera first and recover only slowly.
    initialAvailableOutgoingBitrate: 1_000_000,
};

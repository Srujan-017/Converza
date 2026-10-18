// Builds a short looping .y4m video for Chrome's --use-file-for-fake-video-capture.
// Chrome's built-in fake camera only serves one tab and ends after being
// reopened, so every bot would end up with no video. A file-backed fake camera
// gives each tab its own working video, closer to a real webcam.
import { open, stat } from "node:fs/promises";

const WIDTH = 640;
const HEIGHT = 480;
const FPS = 30;
const SECONDS = 2;

export const ensureFakeCameraFile = async (path) => {
    try {
        if ((await stat(path)).size > 0) return path;
    } catch { /* not created yet */ }

    const file = await open(path, "w");
    await file.write(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F${FPS}:1 Ip A1:1 C420jpeg\n`);

    const ySize = WIDTH * HEIGHT;
    const cSize = ySize / 4;
    let seed = 12345;
    const noise = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return (seed >> 16) % 24;
    };

    for (let f = 0; f < FPS * SECONDS; f++) {
        const frame = Buffer.alloc(ySize + 2 * cSize);
        const boxX = Math.round((WIDTH - 160) * (0.5 + 0.5 * Math.sin((2 * Math.PI * f) / (FPS * SECONDS))));
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const inBox = x >= boxX && x < boxX + 160 && y >= 160 && y < 320;
                const base = inBox ? 210 : 60 + ((x + y + f * 4) % 120);
                frame[y * WIDTH + x] = Math.min(255, base + noise());
            }
        }
        frame.fill(128 + (f % 30), ySize, ySize + cSize);
        frame.fill(128 - (f % 30), ySize + cSize);
        await file.write("FRAME\n");
        await file.write(frame);
    }
    await file.close();
    return path;
};

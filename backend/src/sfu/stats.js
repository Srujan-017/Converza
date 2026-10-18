import { workerStats } from "./workers.js";
import { roomStats } from "./rooms.js";

// Totals only, never meeting codes, since this is served publicly.
export const sfuStats = async () => {
    const rooms = Object.values(await roomStats());
    const sum = (key) => rooms.reduce((total, room) => total + room[key], 0);
    return {
        ...(await workerStats()),
        rooms: rooms.length,
        peers: sum("peers"),
        producers: sum("producers"),
        consumers: sum("consumers"),
    };
};

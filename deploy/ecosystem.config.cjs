// pm2 keeps the backend running, restarts it if it crashes, and (after
// `pm2 startup`) starts it again when the server reboots.
const path = require("path");

module.exports = {
    apps: [
        {
            name: "converza-backend",
            // backend/.env is read from here
            cwd: path.join(__dirname, "..", "backend"),
            script: "src/app.js",
            env: { NODE_ENV: "production" },
            max_memory_restart: "700M",
            time: true,
        },
    ],
};

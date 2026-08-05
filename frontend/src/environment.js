// Backend server URL.
// - In production builds, set REACT_APP_SERVER_URL in your hosting
//   provider's environment variables (e.g. Render) to your deployed
//   backend URL, such as https://your-backend.onrender.com
// - In local development, it falls back to your local backend.
const server = process.env.REACT_APP_SERVER_URL || "http://localhost:8000";

export default server;
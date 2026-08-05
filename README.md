# Converza

Converza is a full-stack, real-time video conferencing web application. It lets users register/login, start or join meetings with a shareable code, talk over video/audio, share their screen, chat in real time, and view their past meeting history.

<p align="left">
  <img alt="React" src="https://img.shields.io/badge/Frontend-React-61DAFB?logo=react&logoColor=black">
  <img alt="Node" src="https://img.shields.io/badge/Backend-Node.js%20%2B%20Express-339933?logo=node.js&logoColor=white">
  <img alt="MongoDB" src="https://img.shields.io/badge/Database-MongoDB-47A248?logo=mongodb&logoColor=white">
  <img alt="Socket.IO" src="https://img.shields.io/badge/Realtime-Socket.IO-010101?logo=socket.io&logoColor=white">
  <img alt="WebRTC" src="https://img.shields.io/badge/Video-WebRTC-333333?logo=webrtc&logoColor=white">
</p>

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [Getting Started (Local Development)](#getting-started-local-development)
  - [Prerequisites](#prerequisites)
  - [1. Clone the repository](#1-clone-the-repository)
  - [2. Backend setup](#2-backend-setup)
  - [3. Frontend setup](#3-frontend-setup)
  - [4. Run the app](#4-run-the-app)
- [Environment Variables](#environment-variables)
- [Deploying to Render (Step by Step)](#deploying-to-render-step-by-step)
  - [Part A — Deploy the Backend (Web Service)](#part-a--deploy-the-backend-web-service)
  - [Part B — Deploy the Frontend (Static Site)](#part-b--deploy-the-frontend-static-site)
  - [Part C — Connect Frontend to Backend](#part-c--connect-frontend-to-backend)
  - [Common Render Gotchas](#common-render-gotchas)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

- 🔐 **Authentication** — register and log in with a username and password (passwords hashed with bcrypt).
- 📹 **Peer-to-peer video calls** — powered by WebRTC, with a Socket.IO signaling server.
- 🖥️ **Screen sharing** — share your screen with everyone in the call.
- 💬 **Real-time in-call chat** — text messages sync instantly across all participants.
- 🎙️ **Mic/camera controls** — mute audio or turn off video mid-call.
- 🧑‍🤝‍🧑 **Multi-user meetings** — join any meeting using a shareable meeting code/URL.
- 🕓 **Meeting history** — logged-in users can see a list of meetings they've joined.
- 👤 **Guest access** — join a call instantly without creating an account.

## Tech Stack

**Frontend**
- React 18 (Create React App)
- React Router DOM
- Material UI (MUI) + Emotion
- Axios
- Socket.IO Client
- Native WebRTC APIs

**Backend**
- Node.js + Express
- Socket.IO (signaling server)
- MongoDB + Mongoose
- bcrypt (password hashing)
- dotenv

## Project Structure

```
Converza-main/
├── backend/
│   ├── src/
│   │   ├── app.js                     # Express app entry point
│   │   ├── controllers/
│   │   │   ├── socketManager.js       # WebRTC signaling / socket.io logic
│   │   │   └── user.controller.js     # Auth & meeting history logic
│   │   ├── models/
│   │   │   ├── user.model.js
│   │   │   └── meeting.model.js
│   │   └── routes/
│   │       └── users.routes.js
│   ├── .env.example
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── landing.jsx
    │   │   ├── authentication.jsx
    │   │   ├── home.jsx
    │   │   ├── history.jsx
    │   │   └── VideoMeet.jsx          # Core video call component
    │   ├── contexts/AuthContext.jsx   # Auth state + API calls
    │   ├── utils/withAuth.jsx         # Route protection HOC
    │   ├── environment.js             # Backend URL config
    │   └── App.js                     # Routes
    ├── .env.example
    └── package.json
```

## How It Works

1. A user registers/logs in (or joins as a guest).
2. Starting or joining a meeting connects the browser to the backend via **Socket.IO**.
3. The backend's signaling server relays **WebRTC offer/answer/ICE candidate** messages between participants in the same meeting room — the actual audio/video stream travels **peer-to-peer**, not through the server.
4. Chat messages are broadcast to everyone in the room over the same socket connection.
5. Meeting codes joined by logged-in users are saved to MongoDB and shown on the History page.

## Getting Started (Local Development)

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later and npm
- A MongoDB database — either:
  - a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register) cluster (recommended), or
  - a local MongoDB instance

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/Converza.git
cd Converza-main
```

### 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Open `.env` and fill in your MongoDB connection string:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/converza?retryWrites=true&w=majority
PORT=8000
```

### 3. Frontend setup

```bash
cd ../frontend
npm install
```

No `.env` file is required for local development — the frontend automatically talks to `http://localhost:8000`. (See [Environment Variables](#environment-variables) if you want to override it.)

### 4. Run the app

In one terminal:

```bash
cd backend
npm run dev        # starts the backend on http://localhost:8000
```

In a second terminal:

```bash
cd frontend
npm start           # starts the frontend on http://localhost:3000
```

Open **http://localhost:3000** in your browser. Open it in a second tab (or another browser/device on the same network) to test a call with more than one participant.

## Environment Variables

| Location | Variable | Required | Description |
|---|---|---|---|
| `backend/.env` | `MONGODB_URI` | ✅ Yes | Your MongoDB connection string |
| `backend/.env` | `PORT` | No (defaults to `8000`) | Port the backend listens on |
| `frontend/.env` | `REACT_APP_SERVER_URL` | No (defaults to `http://localhost:8000`) | URL of the backend API/socket server. **Must be set in production.** |

> **Note on CRA environment variables:** in Create React App, any variable used in the frontend must start with `REACT_APP_`, and the app must be **rebuilt** after changing it (env vars are baked in at build time, not read at runtime).

---

## Deploying to Render (Step by Step)

You haven't deployed this yet, so here's the full path from a local project to a live URL. Converza needs **two separate Render services**:

1. A **Web Service** for the Node/Express + Socket.IO backend.
2. A **Static Site** for the React frontend.

Push your project to a GitHub (or GitLab) repository first — Render deploys from a Git repo.

### Part A — Deploy the Backend (Web Service)

1. Set up a MongoDB database if you haven't already — the quickest option is a free cluster on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register). Once created:
   - Add a database user (username + password).
   - Under **Network Access**, allow access from anywhere (`0.0.0.0/0`) so Render can connect.
   - Copy your **connection string** (it looks like `mongodb+srv://user:password@cluster.mongodb.net/converza`).

2. Go to [render.com](https://render.com) → **New** → **Web Service**.

3. Connect your GitHub repo and select it.

4. Configure the service:

   | Setting | Value |
   |---|---|
   | **Name** | `converza-backend` (or any name you like) |
   | **Root Directory** | `backend` |
   | **Runtime** | Node |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Instance Type** | Free (or paid, your choice) |

5. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `MONGODB_URI` | your MongoDB connection string from step 1 |

   (You don't need to set `PORT` — Render sets it automatically, and the backend already reads `process.env.PORT`.)

6. Click **Create Web Service**. Render will build and deploy it. Once live, you'll get a URL like:

   ```
   https://converza-backend.onrender.com
   ```

   Save this URL — you'll need it in Part C.

### Part B — Deploy the Frontend (Static Site)

1. Go to Render → **New** → **Static Site**.

2. Connect the same repo.

3. Configure the site:

   | Setting | Value |
   |---|---|
   | **Name** | `converza` (or any name you like) |
   | **Root Directory** | `frontend` |
   | **Build Command** | `npm install && npm run build` |
   | **Publish Directory** | `build` |

4. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `REACT_APP_SERVER_URL` | the backend URL from Part A, e.g. `https://converza-backend.onrender.com` |

5. Click **Create Static Site**. Once deployed, Render gives you a live frontend URL like:

   ```
   https://converza.onrender.com
   ```

### Part C — Connect Frontend to Backend

The frontend is already wired to read `REACT_APP_SERVER_URL` (see `frontend/src/environment.js`), so as long as you set that variable in Part B to your Part A backend URL, the two services are connected — no code change needed.

If you ever change the backend URL, update `REACT_APP_SERVER_URL` in the static site's environment variables and **trigger a manual redeploy** (env vars are baked in at build time for CRA apps, so just changing the variable isn't enough — you need a fresh build).

### Common Render Gotchas

- **CORS/socket errors after deploy:** double check `REACT_APP_SERVER_URL` has no trailing slash and starts with `https://`.
- **"Application failed to respond":** make sure the backend's Start Command is `npm start` and that `MONGODB_URI` is set — the backend now fails fast with a clear log message if it's missing, instead of hanging silently.
- **Free tier spin-down:** Render's free web services sleep after inactivity, so the first request/call after idle time may take 20–30 seconds to wake up.
- **MongoDB Atlas network access:** if the backend can't connect to MongoDB, confirm `0.0.0.0/0` is allowed under Atlas Network Access, or add Render's specific outbound IPs.

---

## API Reference

Base URL: `{SERVER_URL}/api/v1/users`

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `POST` | `/register` | `{ name, username, password }` | Create a new account |
| `POST` | `/login` | `{ username, password }` | Log in, returns an auth token |
| `POST` | `/add_to_activity` | `{ token, meeting_code }` | Save a meeting to the user's history |
| `GET` | `/get_all_activity?token=...` | — | Fetch a user's meeting history |

Socket.IO events (signaling): `join-call`, `signal`, `chat-message`, `user-joined`, `user-left`, `disconnect`.

## Troubleshooting

| Problem | Likely cause / fix |
|---|---|
| Backend crashes on start with a `MONGODB_URI` message | You haven't created `backend/.env` from `.env.example`, or `MONGODB_URI` is missing/wrong |
| Frontend can't reach the backend locally | Confirm the backend is running on port `8000`, or set `REACT_APP_SERVER_URL` in `frontend/.env` |
| Camera/mic don't work | Browsers only allow camera/mic access over `https://` or `localhost` — check browser permissions |
| Video call doesn't connect between two peers | Both participants must be using the exact same meeting code/URL; check the backend logs for socket connection errors |

## License

ISC

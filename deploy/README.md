# Deploying Converza (with the SFU) on AWS EC2

The SFU needs a server that accepts UDP/TCP media on a range of ports, which
Render can't do. One EC2 instance runs everything:

```
browser ──HTTPS──► Nginx :443 ──► React build (static files)
                              ├─► /api/*        ─► backend :8000
                              └─► /socket.io/*  ─► backend :8000
browser ──UDP/TCP 40000-40999──► mediasoup (inside the backend)
```

## 1. Launch the instance (AWS console)

1. **EC2 → Launch instance**
   - Name: `converza`
   - Image: **Ubuntu Server 24.04 LTS**
   - Type: **t3.small** (2 vCPU, 2 GB) is comfortable. A free-tier micro
     instance works for small tests (the script adds swap), but CPU is limited.
   - Key pair: create one and download the `.pem` file
   - Storage: 20 GB
2. **Security group, inbound rules:**

   | Type | Port | Source | Why |
   |---|---|---|---|
   | SSH | 22 | My IP | Logging in |
   | HTTP | 80 | Anywhere | Let's Encrypt + redirect to HTTPS |
   | HTTPS | 443 | Anywhere | The site, API and Socket.IO |
   | Custom UDP | 40000-40999 | Anywhere | Video/audio (main path) |
   | Custom TCP | 40000-40999 | Anywhere | Video/audio fallback when UDP is blocked |

3. **Elastic IP:** EC2 → Elastic IPs → Allocate → Associate with the instance.
   The SFU tells browsers this IP, so it must not change on restart.

AWS charges for running instances and public IPv4 addresses. Check the
pricing for your region and stop the instance when you're not using it.

## 2. Domain name (needed for HTTPS)

Browsers only allow the camera on HTTPS sites, and HTTPS needs a domain.

- Free option: [duckdns.org](https://www.duckdns.org) → create a subdomain
  (e.g. `converza.duckdns.org`) → set its IP to your Elastic IP.
- Or, with your own domain: add an **A record** pointing to the Elastic IP.

Wait until `nslookup converza.duckdns.org` shows the Elastic IP.

## 3. Allow the server in MongoDB Atlas

Atlas → **Network Access** → Add IP Address → your Elastic IP.

## 4. Run the setup script on the server

```bash
ssh -i converza.pem ubuntu@<ELASTIC_IP>
```

```bash
curl -fsSL https://raw.githubusercontent.com/Srujan-017/Converza/feature/sfu/deploy/setup-ec2.sh -o setup-ec2.sh
```

```bash
DOMAIN=converza.duckdns.org EMAIL=you@example.com bash setup-ec2.sh
```

It asks for your MongoDB connection string (saved only in
`~/converza/backend/.env`), then installs Node 20, Nginx, pm2 and certbot,
builds the frontend, gets a Let's Encrypt certificate (accepting its
Subscriber Agreement for you), starts the backend and prints the health check:

```json
{"status":"ok","database":"connected","sfu":"running"}
```

## 5. Check it works

- Open `https://<your-domain>` and join a meeting from two devices.
  The browser console shows `Converza media mode: sfu`.
- `https://<your-domain>/api/v1/health` shows the status above.
- From your laptop, run the automated checks against the real server:

```bash
cd loadtest
node features.mjs --url https://converza.duckdns.org --mode sfu
```

## Updating

Push to the branch, then on the server:

```bash
DOMAIN=converza.duckdns.org bash ~/converza/deploy/setup-ec2.sh
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Site loads, but video tiles stay black | UDP/TCP 40000-40999 not open in the security group, or `MEDIASOUP_ANNOUNCED_ADDRESS` in `backend/.env` isn't the Elastic IP |
| Health shows `"database":"disconnected"` | Elastic IP not added in Atlas Network Access, or wrong `MONGODB_URI` |
| Certificate step fails | The domain doesn't point to the Elastic IP yet, or port 80 is closed |
| Backend keeps restarting | `pm2 logs converza-backend` |

After editing `backend/.env`, apply it with `pm2 restart converza-backend --update-env`.

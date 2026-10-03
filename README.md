# MovieDate

Couples watch-party web app optimized for Android Chrome landscape.

## Architecture

- `frontend/` → static web app hosted on Vercel.
- `backend/` → Node.js + Socket.IO server hosted on Railway.
- WebRTC → camera/microphone peer-to-peer.
- The host selects a local video file. The browser plays it locally and syncs playback actions with the partner.

> Important: this starter does NOT upload movie files to Railway. Browser-to-browser video-file streaming requires an additional WebRTC media/data-channel implementation. The current version synchronizes playback and provides camera/mic WebRTC.

## 1. Deploy backend to Railway

Create a GitHub repository containing the `backend` folder contents.

Railway:
1. New Project.
2. Deploy from GitHub.
3. Select the backend repository.
4. Railway detects Node.js.
5. Start command: `npm start`.
6. Generate a public domain in Railway Networking.
7. Copy the URL, for example `https://moviedate-server-production.up.railway.app`.

Test:
`https://YOUR-RAILWAY-DOMAIN/health`

Expected:
`{"ok":true}`

## 2. Connect frontend to Railway

Open `frontend/app.js`.

Change:

`const BACKEND_URL = ... || "http://localhost:3000";`

to your Railway URL:

`const BACKEND_URL = "https://YOUR-RAILWAY-DOMAIN";`

Commit and push.

## 3. Deploy frontend to Vercel

Create a GitHub repository containing the frontend folder contents.

Vercel:
1. Add New Project.
2. Import the frontend GitHub repository.
3. Framework Preset: Other.
4. Build command: leave empty.
5. Output directory: `.`
6. Deploy.

## 4. Room flow

1. Open Vercel site.
2. Tap `Create room`.
3. Allow camera/mic.
4. Tap `Copy` or `Share`.
5. Send the URL to your partner.
6. Partner opens the same URL in Android Chrome.
7. Both cameras connect using WebRTC.
8. Chat/reactions use Socket.IO.
9. Play/pause/seek messages are synchronized.

## HTTPS requirement

Camera and microphone require HTTPS on real devices. Vercel and Railway provide HTTPS.

## Local development

Backend:
```bash
cd backend
npm install
npm start
```

Frontend can be served with any static server, e.g.:
```bash
cd frontend
npx serve .
```

For local testing, edit `frontend/app.js` to use:
`http://localhost:3000`

## Production limitation

This is a working foundation, not a Netflix-style streaming service. Local movie files are protected by browser permissions and cannot simply be uploaded to the server.

For true host-to-partner movie streaming, the next engineering step is:
- WebRTC data channel or media pipeline for the selected movie.
- Chunking/backpressure.
- Buffer management.
- Host-only media controls.
- Late-join synchronization.
- TURN server for difficult mobile networks.
- Better room authentication and cleanup.

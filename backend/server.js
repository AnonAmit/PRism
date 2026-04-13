import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { router } from './api/routes.js';
import { SessionStore } from './engine/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', router);

// Serve frontend as static files at /
const frontendDir = path.resolve(__dirname, '..', 'frontend');
const assetsDir   = path.resolve(__dirname, '..', 'assets');
app.use(express.static(frontendDir));
app.use('/assets', express.static(assetsDir));
app.get('/', (_, res) => res.sendFile(path.join(frontendDir, 'index.html')));


const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  // Extract sessionId from query string: /ws?session=<id>
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const sessionId = url.searchParams.get('session');

  if (!sessionId) {
    ws.close(1008, 'Missing session ID');
    return;
  }

  const session = SessionStore.get(sessionId);
  if (!session) {
    ws.close(1008, 'Session not found');
    return;
  }

  // Attach ws to session so pipeline can emit to it
  session.ws = ws;

  // Replay buffered events for late-connecting clients
  if (session.eventBuffer && session.eventBuffer.length > 0) {
    for (const evt of session.eventBuffer) {
      ws.send(JSON.stringify(evt));
    }
  }

  ws.on('close', () => {
    if (session.ws === ws) session.ws = null;
  });

  ws.on('error', (err) => {
    console.error(`[WS] Session ${sessionId} error:`, err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[PRism Backend] Running on http://localhost:${PORT}`);
  console.log(`[PRism Backend] WebSocket on ws://localhost:${PORT}/ws`);
});

// Background workspace cleanup (every 30 minutes, remove sessions older than 1hr)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of SessionStore.entries()) {
    if (now - session.createdAt > 60 * 60 * 1000) {
      SessionStore.cleanup(id);
    }
  }
}, 30 * 60 * 1000);

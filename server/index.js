const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const DiscoveryService = require('./discovery');
const SessionManager = require('./manager');
const db = require('../database');

const instanceId = crypto.randomUUID();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let localUiSocket = null;
let discoveryService = null;
let sessionManager = null;
let serverPort = null;

// Helper to broadcast updates to the React client
function broadcastToLocalClients(event, data) {
  if (localUiSocket) {
    localUiSocket.emit(event, data);
  }
}

// 1. Initialize Session Manager
sessionManager = new SessionManager({
  instanceId,
  getDiscoveryService: () => discoveryService,
  broadcastToLocalClients
});

// 2. Initialize Discovery Service
discoveryService = new DiscoveryService({
  instanceId,
  getPorts: () => ({
    chatPort: serverPort,
    filePort: 41236 // A standard port or dynamic. For simplicity, let's keep it dynamic or default.
  })
});

// Handle Socket.IO connections (could be the local UI client, or other LAN peers)
io.on('connection', (socket) => {
  const isLocal = socket.handshake.address === '127.0.0.1' || socket.handshake.address === '::1';
  const role = socket.handshake.query.role;

  if (isLocal && role === 'ui') {
    // This is the local frontend client
    localUiSocket = socket;
    
    // Register UI Command Event Listeners
    socket.on('get-status', (cb) => {
      cb({
        instanceId,
        username: db.getSettings().username,
        deviceNickname: db.getSettings().deviceNickname,
        ip: discoveryService.getLocalIP(),
        port: serverPort,
        peers: discoveryService.getPeers()
      });
    });

    socket.on('get-settings', (cb) => {
      if (typeof cb === 'function') cb(db.getSettings());
    });

    socket.on('update-settings', (settings, cb) => {
      db.updateSettings(settings);
      discoveryService.announce(); // announce updated nickname immediately
      if (typeof cb === 'function') cb({ success: true });
    });

    socket.on('get-chats', (peerId, cb) => {
      if (typeof cb === 'function') cb(db.getMessages(peerId));
    });

    socket.on('send-chat', ({ peerId, text }, cb) => {
      const res = sessionManager.sendChatMessage(peerId, text);
      if (typeof cb === 'function') cb(res);
    });

    socket.on('send-typing', ({ peerId, isTyping }) => {
      sessionManager.sendTyping(peerId, isTyping);
    });

    socket.on('connect-peer', (peerId, cb) => {
      sessionManager.sendConnectionRequest(peerId).then((res) => {
        if (typeof cb === 'function') cb(res);
      });
    });

    socket.on('respond-connection', ({ peerId, accepted }, cb) => {
      const res = sessionManager.respondConnectionRequest(peerId, accepted);
      if (typeof cb === 'function') cb(res);
    });

    socket.on('send-file', ({ peerId, fileName, fileBytes, mimeType }, cb) => {
      const res = sessionManager.sendFileTransferRequest(peerId, fileName, fileBytes, mimeType);
      if (typeof cb === 'function') cb(res);
    });

    socket.on('respond-file', ({ transferId, accepted }, cb) => {
      const res = sessionManager.respondFileTransferRequest(transferId, accepted);
      if (typeof cb === 'function') cb(res);
    });

    socket.on('control-transfer', ({ transferId, command }, cb) => {
      const res = sessionManager.controlTransfer(transferId, command);
      if (typeof cb === 'function') cb(res);
    });

    socket.on('get-transfers-history', (cb) => {
      if (typeof cb === 'function') cb(db.getTransfers());
    });

    socket.on('clear-chat', (peerId, cb) => {
      db.clearChat(peerId);
      if (typeof cb === 'function') cb({ success: true });
    });
  } else {
    // This is an incoming connection from a LAN peer node
    sessionManager.handleIncomingPeerSocket(socket);
  }
});

// Setup Discovery event mapping to UI
discoveryService.on('peer-online', (peer) => {
  broadcastToLocalClients('peer-online', peer);
});

discoveryService.on('peer-update', (peer) => {
  broadcastToLocalClients('peer-update', peer);
});

discoveryService.on('peer-offline', (peerId) => {
  broadcastToLocalClients('peer-offline', peerId);
});

discoveryService.on('status', (msg) => {
  broadcastToLocalClients('discovery-status', msg);
});

discoveryService.on('error', (err) => {
  broadcastToLocalClients('discovery-error', err);
});

function startServer() {
  return new Promise((resolve) => {
    // Listen on dynamic port
    server.listen(0, '0.0.0.0', () => {
      serverPort = server.address().port;
      
      // Now that we have the server port, start peer discovery
      discoveryService.start();

      console.log(`SwiftShare Peer Server running on http://0.0.0.0:${serverPort}`);
      resolve(serverPort);
    });
  });
}

function stopServer() {
  discoveryService.stop();
  server.close();
}

module.exports = {
  startServer,
  stopServer,
  instanceId
};

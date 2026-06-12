const { contextBridge } = require('electron');
const crypto = require('crypto');
const dgram = require('dgram');
const net = require('net');
const os = require('os');

const DISCOVERY_BROADCAST = '255.255.255.255';
const DISCOVERY_MESSAGE = 'P2P_DISCOVERY_HELLO';
const FILE_PACKET_PREFIX = 'P2P_FILE';
const FILE_CHUNK_SIZE = 1024;

const instanceId = crypto.randomUUID();
const hostName = os.hostname();

function getLocalIP() {
  const interfaces = os.networkInterfaces();

  for (const interfaceName of Object.keys(interfaces)) {
    const entries = interfaces[interfaceName] || [];

    for (const entry of entries) {
      if (entry && entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }

  return '127.0.0.1';
}

function startDiscovery({ port, getAdvertisement, onPeer, onStatus }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let heartbeat = null;

  const announce = () => {
    const payload = {
      type: DISCOVERY_MESSAGE,
      id: instanceId,
      name: hostName,
      ip: getLocalIP(),
      ts: Date.now(),
      ...getAdvertisement()
    };

    const serialized = Buffer.from(JSON.stringify(payload), 'utf8');
    socket.send(serialized, port, DISCOVERY_BROADCAST);
  };

  socket.on('error', (error) => {
    if (typeof onStatus === 'function') {
      onStatus(`Discovery socket error: ${error.message}`);
    }
  });

  socket.on('listening', () => {
    socket.setBroadcast(true);

    if (typeof onStatus === 'function') {
      onStatus(`Discovery active on UDP ${port}`);
    }

    announce();
    heartbeat = setInterval(announce, 3000);
  });

  socket.on('message', (message) => {
    try {
      const payload = JSON.parse(message.toString('utf8'));

      if (payload.type !== DISCOVERY_MESSAGE || payload.id === instanceId) {
        return;
      }

      if (typeof onPeer === 'function') {
        onPeer({
          id: payload.id,
          name: payload.name || 'Unknown peer',
          ip: payload.ip,
          chatPort: payload.chatPort,
          filePort: payload.filePort,
          lastSeen: Date.now()
        });
      }
    } catch (error) {
      if (typeof onStatus === 'function') {
        onStatus(`Discovery parse error: ${error.message}`);
      }
    }
  });

  socket.bind(port, '0.0.0.0');

  return {
    stop() {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }

      socket.close();
    }
  };
}

function startChatServer({ onMessage, onStatus, onReady }) {
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk;

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');

        if (!line) {
          continue;
        }

        try {
          const payload = JSON.parse(line);

          if (typeof onMessage === 'function') {
            onMessage({
              id: payload.id || crypto.randomUUID(),
              peerId: payload.peerId,
              peerName: payload.peerName,
              message: payload.message,
              receivedAt: Date.now(),
              remoteAddress: socket.remoteAddress,
              remotePort: socket.remotePort
            });
          }
        } catch (error) {
          if (typeof onStatus === 'function') {
            onStatus(`Chat parse error: ${error.message}`);
          }
        }
      }
    });
  });

  server.on('error', (error) => {
    if (typeof onStatus === 'function') {
      onStatus(`Chat server error: ${error.message}`);
    }
  });

  server.listen(0, '0.0.0.0', () => {
    const address = server.address();

    if (typeof onReady === 'function') {
      onReady(address.port);
    }

    if (typeof onStatus === 'function') {
      onStatus(`Chat server listening on TCP ${address.port}`);
    }
  });

  return {
    stop() {
      server.close();
    }
  };
}

function sendChatMessage({ host, port, peerId, peerName, message }) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host, port }, () => {
      const payload = JSON.stringify({
        id: crypto.randomUUID(),
        peerId,
        peerName,
        message,
        sentAt: Date.now(),
        senderId: instanceId,
        senderName: hostName
      });

      client.end(`${payload}\n`, 'utf8', resolve);
    });

    client.on('error', reject);
  });
}

function startFileReceiver({ onTransferComplete, onStatus, onReady }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const transfers = new Map();

  socket.on('error', (error) => {
    if (typeof onStatus === 'function') {
      onStatus(`File receiver error: ${error.message}`);
    }
  });

  socket.on('listening', () => {
    const address = socket.address();

    if (typeof onReady === 'function') {
      onReady(address.port);
    }

    if (typeof onStatus === 'function') {
      onStatus(`File receiver listening on UDP ${address.port}`);
    }
  });

  socket.on('message', (message, rinfo) => {
    const text = message.toString('utf8');

    if (!text.startsWith(`${FILE_PACKET_PREFIX}|`)) {
      return;
    }

    const parts = text.split('|');
    const packetType = parts[1];
    const transferId = parts[2];

    if (!transferId) {
      return;
    }

    if (packetType === 'START') {
      transfers.set(transferId, {
        id: transferId,
        fileName: parts[3] || 'incoming-file.bin',
        mimeType: parts[4] || 'application/octet-stream',
        totalChunks: Number(parts[5] || 0),
        chunks: new Map(),
        receivedFrom: `${rinfo.address}:${rinfo.port}`,
        startedAt: Date.now()
      });
      return;
    }

    if (packetType === 'CHUNK') {
      const transfer = transfers.get(transferId);
      if (!transfer) {
        return;
      }

      const chunkIndex = Number(parts[3]);
      const base64Data = parts.slice(4).join('|');

      if (Number.isNaN(chunkIndex) || !base64Data) {
        return;
      }

      transfer.chunks.set(chunkIndex, Buffer.from(base64Data, 'base64'));
      return;
    }

    if (packetType === 'END') {
      const transfer = transfers.get(transferId);
      if (!transfer) {
        return;
      }

      const orderedChunks = [];
      for (let index = 0; index < transfer.totalChunks; index += 1) {
        const chunk = transfer.chunks.get(index);
        if (!chunk) {
          return;
        }
        orderedChunks.push(chunk);
      }

      const buffer = Buffer.concat(orderedChunks);
      transfers.delete(transferId);

      if (typeof onTransferComplete === 'function') {
        onTransferComplete({
          id: transfer.id,
          fileName: transfer.fileName,
          mimeType: transfer.mimeType,
          size: buffer.length,
          bytes: new Uint8Array(buffer),
          receivedFrom: transfer.receivedFrom,
          completedAt: Date.now()
        });
      }
    }
  });

  socket.bind(0, '0.0.0.0');

  return {
    stop() {
      socket.close();
    }
  };
}

function sendFile({ host, port, fileName, mimeType, data, onProgress }) {
  const socket = dgram.createSocket('udp4');
  const transferId = crypto.randomUUID();
  const buffer = Buffer.from(data);
  const totalChunks = Math.max(1, Math.ceil(buffer.length / FILE_CHUNK_SIZE));

  const sendPacket = (packet) => new Promise((resolve, reject) => {
    socket.send(packet, port, host, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return (async () => {
    try {
      await sendPacket(Buffer.from([
        FILE_PACKET_PREFIX,
        'START',
        transferId,
        fileName,
        mimeType,
        String(totalChunks)
      ].join('|'), 'utf8'));

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const start = chunkIndex * FILE_CHUNK_SIZE;
        const end = Math.min(start + FILE_CHUNK_SIZE, buffer.length);
        const chunkPayload = buffer.subarray(start, end).toString('base64');

        await sendPacket(Buffer.from([
          FILE_PACKET_PREFIX,
          'CHUNK',
          transferId,
          String(chunkIndex),
          chunkPayload
        ].join('|'), 'utf8'));

        if (typeof onProgress === 'function') {
          onProgress({
            transferId,
            sentChunks: chunkIndex + 1,
            totalChunks
          });
        }
      }

      await sendPacket(Buffer.from([
        FILE_PACKET_PREFIX,
        'END',
        transferId
      ].join('|'), 'utf8'));
    } finally {
      socket.close();
    }

    return {
      transferId,
      totalChunks
    };
  })();
}

contextBridge.exposeInMainWorld('api', {
  hostName,
  instanceId,
  localIP: getLocalIP(),
  startDiscovery,
  startChatServer,
  sendChatMessage,
  startFileReceiver,
  sendFile
});

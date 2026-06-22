const ioClient = require('socket.io-client');
const crypto = require('crypto');
const db = require('../database');
const { generateECDH, deriveSessionKey, encrypt, decrypt, sha256 } = require('../encryption');
const { compress } = require('../compression');
const FileSender = require('../udp-engine/sender');
const FileReceiver = require('../udp-engine/receiver');

class SessionManager {
  constructor({ instanceId, getDiscoveryService, broadcastToLocalClients }) {
    this.instanceId = instanceId;
    this.getDiscoveryService = getDiscoveryService;
    this.broadcastToLocalClients = broadcastToLocalClients; // function to send logs/updates to local UI

    // Memory states
    this.activeSockets = new Map(); // peerId -> socket (either incoming server socket or outgoing client socket)
    this.sessions = new Map(); // peerId -> { isApproved: bool, aesKey: Buffer, ecdh: ECDH }
    this.activeTransfers = new Map(); // transferId -> { sender/receiver instance, metadata }
  }

  // Handle incoming connections from other peers
  handleIncomingPeerSocket(socket) {
    let authenticatedPeerId = null;

    socket.on('handshake', ({ peerId, username, deviceNickname }) => {
      authenticatedPeerId = peerId;
      this.activeSockets.set(peerId, socket);
      this.broadcastToLocalClients('peer-connection-status', { peerId, status: 'connected' });
    });

    socket.on('connection-request', ({ peerId, username, deviceNickname }) => {
      this.broadcastToLocalClients('incoming-connection-request', { peerId, username, deviceNickname });
    });

    socket.on('connection-response', ({ peerId, accepted }) => {
      if (accepted) {
        // Start DH Key exchange
        const { ecdh, publicKey } = generateECDH();
        this.sessions.set(peerId, { isApproved: true, ecdh });
        socket.emit('key-exchange', { peerId: this.instanceId, publicKey });
      } else {
        this.sessions.delete(peerId);
        this.broadcastToLocalClients('connection-rejected', { peerId });
      }
    });

    socket.on('key-exchange', ({ peerId, publicKey }) => {
      const session = this.sessions.get(peerId);
      if (session) {
        try {
          const aesKey = deriveSessionKey(session.ecdh, publicKey);
          session.aesKey = aesKey;
          this.sessions.set(peerId, session);
          
          this.broadcastToLocalClients('connection-established', { peerId });
          
          // If we are responding, we also need to send our public key back
          if (!session.sentKey) {
            const { ecdh: newEcdh, publicKey: ourPublicKey } = generateECDH();
            session.ecdh = newEcdh;
            session.aesKey = deriveSessionKey(newEcdh, publicKey);
            session.sentKey = true;
            this.sessions.set(peerId, session);
            socket.emit('key-exchange', { peerId: this.instanceId, publicKey: ourPublicKey });
          }
        } catch (e) {
          console.error('DH Key derivation failed', e);
        }
      } else {
        // We received their key first, prepare ours
        const { ecdh, publicKey: ourPublicKey } = generateECDH();
        const aesKey = deriveSessionKey(ecdh, publicKey);
        this.sessions.set(peerId, { isApproved: true, aesKey, ecdh, sentKey: true });
        socket.emit('key-exchange', { peerId: this.instanceId, publicKey: ourPublicKey });
        this.broadcastToLocalClients('connection-established', { peerId });
      }
    });

    // Encrypted Chat Events
    socket.on('chat-message', ({ peerId, encryptedData, iv, tag, msgId, timestamp }) => {
      const session = this.sessions.get(peerId);
      if (!session || !session.aesKey) return;

      try {
        const decryptedMsg = decrypt(
          Buffer.from(encryptedData, 'hex'),
          session.aesKey,
          Buffer.from(iv, 'hex'),
          Buffer.from(tag, 'hex')
        ).toString('utf8');

        const msgRecord = {
          id: msgId,
          senderId: peerId,
          text: decryptedMsg,
          timestamp,
          status: 'seen'
        };

        db.addMessage(peerId, msgRecord);
        this.broadcastToLocalClients('incoming-message', { peerId, message: msgRecord });
        socket.emit('message-seen', { peerId: this.instanceId, msgId });
      } catch (err) {
        console.error('Decryption of chat failed', err);
      }
    });

    socket.on('typing', ({ peerId, isTyping }) => {
      this.broadcastToLocalClients('peer-typing', { peerId, isTyping });
    });

    socket.on('message-seen', ({ peerId, msgId }) => {
      this.broadcastToLocalClients('message-seen-update', { peerId, msgId });
    });

    // File Transfer Handshake Events
    socket.on('file-transfer-request', ({ transferId, peerId, fileName, fileSize, mimeType, sha256Hash, compressionType }) => {
      this.broadcastToLocalClients('incoming-file-request', {
        transferId,
        peerId,
        fileName,
        fileSize,
        mimeType,
        sha256Hash,
        compressionType
      });
    });

    socket.on('file-transfer-response', async ({ transferId, peerId, accepted, filePort }) => {
      const transfer = this.activeTransfers.get(transferId);
      if (!transfer) return;

      if (accepted) {
        this.broadcastToLocalClients('transfer-accepted', { transferId });
        // Start UDP File Sender
        try {
          const peerInfo = this.getDiscoveryService().peers.get(peerId);
          if (!peerInfo) throw new Error('Peer offline');

          // Process file compression & encryption
          this.broadcastToLocalClients('transfer-status-update', { transferId, status: 'encrypting' });
          
          const session = this.sessions.get(peerId);
          if (!session || !session.aesKey) throw new Error('No secure session established');

          const compResult = await compress(transfer.rawBytes, transfer.compressionType);
          const encResult = encrypt(compResult.compressed, session.aesKey);

          const aesKeyInfo = {
            key: session.aesKey.toString('hex'),
            iv: encResult.iv.toString('hex'),
            tag: encResult.tag.toString('hex')
          };

          // Cache ciphertext
          transfer.ciphertext = encResult.ciphertext;
          transfer.aesKey = aesKeyInfo;
          transfer.originalSize = compResult.originalSize;
          transfer.compressedSize = compResult.compressedSize;
          transfer.savings = compResult.savings;

          // Send AES info & start UDP Sender
          socket.emit('file-transfer-crypto-info', { transferId, aesKey: aesKeyInfo });

          const sender = new FileSender({
            transferId,
            host: peerInfo.ip,
            port: filePort,
            data: encResult.ciphertext
          });

          transfer.instance = sender;
          this.activeTransfers.set(transferId, transfer);

          // Log database entry
          db.addTransfer({
            id: transferId,
            peerId,
            fileName: transfer.fileName,
            fileSize: transfer.fileSize,
            direction: 'upload',
            status: 'transferring',
            timestamp: Date.now()
          });

          sender.on('progress', (progressData) => {
            this.broadcastToLocalClients('transfer-progress', {
              transferId,
              direction: 'upload',
              ...progressData,
              originalSize: transfer.originalSize,
              compressedSize: transfer.compressedSize,
              savings: transfer.savings
            });
          });

          sender.on('packet-loss', (lossData) => {
            this.broadcastToLocalClients('transfer-packet-loss', { transferId, ...lossData });
          });

          sender.on('error', (err) => {
            this.broadcastToLocalClients('transfer-error', { transferId, message: err.message });
            db.updateTransfer(transferId, { status: 'failed', error: err.message });
          });

          sender.on('complete', () => {
            this.broadcastToLocalClients('transfer-complete', { transferId, direction: 'upload' });
            db.updateTransfer(transferId, { status: 'completed' });
            this.activeTransfers.delete(transferId);
          });

          sender.start();
        } catch (err) {
          this.broadcastToLocalClients('transfer-error', { transferId, message: err.message });
          this.activeTransfers.delete(transferId);
        }
      } else {
        this.broadcastToLocalClients('transfer-rejected', { transferId });
        this.activeTransfers.delete(transferId);
      }
    });

    socket.on('disconnect', () => {
      if (authenticatedPeerId) {
        this.activeSockets.delete(authenticatedPeerId);
        this.broadcastToLocalClients('peer-connection-status', { peerId: authenticatedPeerId, status: 'disconnected' });
      }
    });
  }

  // Outgoing connection setup
  async connectToPeer(peer) {
    if (this.activeSockets.has(peer.id)) {
      return this.activeSockets.get(peer.id);
    }

    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://${peer.ip}:${peer.chatPort}`, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 4000
      });

      socket.on('connect', () => {
        const settings = db.getSettings();
        socket.emit('handshake', {
          peerId: this.instanceId,
          username: settings.username,
          deviceNickname: settings.deviceNickname
        });
        
        this.activeSockets.set(peer.id, socket);
        // Bind incoming listeners on this client socket too
        this.handleIncomingPeerSocket(socket);
        resolve(socket);
      });

      socket.on('connect_error', (err) => {
        reject(err);
      });
    });
  }

  // Initiate a new secure connection request to a peer
  async sendConnectionRequest(peerId) {
    try {
      const ds = this.getDiscoveryService();
      const peer = ds.peers.get(peerId);
      if (!peer) throw new Error('Peer is offline');

      const socket = await this.connectToPeer(peer);
      const settings = db.getSettings();

      socket.emit('connection-request', {
        peerId: this.instanceId,
        username: settings.username,
        deviceNickname: settings.deviceNickname
      });
      
      this.sessions.set(peerId, { isApproved: false });
      return { success: true };
    } catch (err) {
      console.error('Failed to send connection request:', err);
      return { success: false, error: err.message };
    }
  }

  // Respond to connection request
  respondConnectionRequest(peerId, accepted) {
    const socket = this.activeSockets.get(peerId);
    if (!socket) return { success: false, error: 'Socket not found' };

    socket.emit('connection-response', { peerId: this.instanceId, accepted });
    
    if (accepted) {
      const { ecdh, publicKey } = generateECDH();
      this.sessions.set(peerId, { isApproved: true, ecdh });
      socket.emit('key-exchange', { peerId: this.instanceId, publicKey });
    } else {
      this.sessions.delete(peerId);
    }
    return { success: true };
  }

  // Send encrypted chat message
  sendChatMessage(peerId, text) {
    const socket = this.activeSockets.get(peerId);
    const session = this.sessions.get(peerId);

    if (!socket || !session || !session.aesKey) {
      return { success: false, error: 'Secure session not established' };
    }

    const msgId = crypto.randomUUID();
    const timestamp = Date.now();
    
    const encResult = encrypt(Buffer.from(text, 'utf8'), session.aesKey);
    
    socket.emit('chat-message', {
      peerId: this.instanceId,
      encryptedData: encResult.ciphertext.toString('hex'),
      iv: encResult.iv.toString('hex'),
      tag: encResult.tag.toString('hex'),
      msgId,
      timestamp
    });

    const msgRecord = {
      id: msgId,
      senderId: this.instanceId,
      text,
      timestamp,
      status: 'delivered'
    };

    db.addMessage(peerId, msgRecord);
    return { success: true, message: msgRecord };
  }

  // Send typing indicator
  sendTyping(peerId, isTyping) {
    const socket = this.activeSockets.get(peerId);
    if (socket) {
      socket.emit('typing', { peerId: this.instanceId, isTyping });
    }
  }

  // Initiate file transfer request
  sendFileTransferRequest(peerId, fileName, fileBytes, mimeType) {
    const socket = this.activeSockets.get(peerId);
    if (!socket) return { success: false, error: 'Not connected to peer' };

    const transferId = crypto.randomUUID();
    const sha256Hash = sha256(Buffer.from(fileBytes));

    // Brotli for highly compressed assets, Gzip as general default
    const compressionType = fileBytes.length > 5 * 1024 * 1024 ? 'gzip' : 'brotli';

    // Store in active transfer queue
    this.activeTransfers.set(transferId, {
      id: transferId,
      peerId,
      fileName,
      fileSize: fileBytes.length,
      rawBytes: Buffer.from(fileBytes),
      compressionType,
      sha256Hash,
      direction: 'upload'
    });

    socket.emit('file-transfer-request', {
      transferId,
      peerId: this.instanceId,
      fileName,
      fileSize: fileBytes.length,
      mimeType,
      sha256Hash,
      compressionType
    });

    return { success: true, transferId };
  }

  // Respond to incoming file request
  respondFileTransferRequest(transferId, accepted) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer) return { success: false, error: 'Transfer session not found' };

    const socket = this.activeSockets.get(transfer.peerId);
    if (!socket) return { success: false, error: 'Socket disconnected' };

    if (accepted) {
      // Create UDP File Receiver on a random port
      const receiver = new FileReceiver({
        transferId,
        port: 0, // Binds to random UDP port
        aesKey: null, // Set dynamically once keys are sent from sender
        compressionType: transfer.compressionType,
        fileName: transfer.fileName,
        fileSize: transfer.fileSize,
        sha256Hash: transfer.sha256Hash
      });

      receiver.on('status', (msg) => {
        this.broadcastToLocalClients('transfer-status-log', { transferId, message: msg });
      });

      receiver.on('progress', (progressData) => {
        this.broadcastToLocalClients('transfer-progress', {
          transferId,
          direction: 'download',
          ...progressData
        });
      });

      receiver.on('complete', (decryptedBytes) => {
        this.broadcastToLocalClients('transfer-complete', {
          transferId,
          direction: 'download',
          fileName: transfer.fileName,
          bytes: Array.from(decryptedBytes) // Convert to array to send via WS safely
        });

        db.addTransfer({
          id: transferId,
          peerId: transfer.peerId,
          fileName: transfer.fileName,
          fileSize: transfer.fileSize,
          direction: 'download',
          status: 'completed',
          timestamp: Date.now()
        });
        
        this.activeTransfers.delete(transferId);
      });

      receiver.on('error', (err) => {
        this.broadcastToLocalClients('transfer-error', { transferId, message: err.message });
        
        db.addTransfer({
          id: transferId,
          peerId: transfer.peerId,
          fileName: transfer.fileName,
          fileSize: transfer.fileSize,
          direction: 'download',
          status: 'failed',
          error: err.message,
          timestamp: Date.now()
        });

        this.activeTransfers.delete(transferId);
      });

      // Listen for UDP receiver binding
      receiver.on('status', (msg) => {
        if (msg.includes('Receiver listening')) {
          const filePort = receiver.socket.address().port;
          transfer.instance = receiver;
          this.activeTransfers.set(transferId, transfer);
          
          socket.emit('file-transfer-response', { transferId, peerId: this.instanceId, accepted: true, filePort });
          
          // Keep a backup listener to bind key once sender emits it
          socket.once('file-transfer-crypto-info', ({ transferId: tid, aesKey }) => {
            if (tid === transferId) {
              receiver.aesKey = aesKey;
            }
          });
        }
      });

      receiver.start();
    } else {
      socket.emit('file-transfer-response', { transferId, peerId: this.instanceId, accepted: false });
      this.activeTransfers.delete(transferId);
    }

    return { success: true };
  }

  // Save incoming request details to queue
  queueIncomingFileRequest(metadata) {
    this.activeTransfers.set(metadata.transferId, {
      ...metadata,
      direction: 'download'
    });
  }

  // Manage transfer state controls (Pause/Resume/Cancel)
  controlTransfer(transferId, command) {
    const transfer = this.activeTransfers.get(transferId);
    if (!transfer || !transfer.instance) return { success: false, error: 'Active transfer not found' };

    if (command === 'pause') {
      transfer.instance.pause ? transfer.instance.pause() : null;
      this.broadcastToLocalClients('transfer-status-log', { transferId, message: 'Paused' });
    } else if (command === 'resume') {
      transfer.instance.resume ? transfer.instance.resume() : null;
      this.broadcastToLocalClients('transfer-status-log', { transferId, message: 'Resumed' });
    } else if (command === 'cancel') {
      transfer.instance.stop();
      this.activeTransfers.delete(transferId);
      this.broadcastToLocalClients('transfer-status-log', { transferId, message: 'Cancelled' });
    }

    return { success: true };
  }
}

module.exports = SessionManager;

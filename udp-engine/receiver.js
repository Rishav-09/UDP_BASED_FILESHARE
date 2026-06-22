const dgram = require('dgram');
const EventEmitter = require('events');
const { PACKET_TYPES, serialize, deserialize } = require('./packet');
const { decrypt } = require('../encryption');
const { decompress } = require('../compression');

class FileReceiver extends EventEmitter {
  constructor({
    transferId,
    port,
    aesKey,
    compressionType,
    fileName,
    fileSize,
    sha256Hash
  }) {
    super();
    this.transferId = transferId;
    this.port = port;
    this.aesKey = aesKey;
    this.compressionType = compressionType;
    this.fileName = fileName;
    this.fileSize = fileSize;
    this.sha256Hash = sha256Hash;

    // Buffer states
    this.chunks = new Map(); // seqNum -> payload Buffer
    this.expectedSeqNum = 0;
    this.totalPackets = 0;
    this.isFinished = false;
    this.isStopped = false;

    // Sender feedback info
    this.senderAddress = null;
    this.senderPort = null;

    // Sockets
    this.socket = null;

    this.finReceived = false;
    this.finPacket = null;
  }

  setAesKey(aesKey) {
    this.aesKey = aesKey;
    if (this.finReceived && this.finPacket) {
      this.emit('status', 'Secure key received, resuming decryption...');
      this.processFinPacket(this.finPacket);
    }
  }

  start() {
    this.socket = dgram.createSocket('udp4');

    this.socket.on('error', (err) => {
      this.emit('error', err);
      this.stop();
    });

    this.socket.on('message', (msg, rinfo) => {
      this.handleIncomingPacket(msg, rinfo);
    });

    this.socket.bind(this.port, '0.0.0.0', () => {
      const addr = this.socket.address();
      this.emit('status', `Receiver listening on UDP port ${addr.port} for transfer ${this.transferId}`);
    });
  }

  stop() {
    this.isStopped = true;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
    this.emit('status', 'Receiver stopped');
  }

  handleIncomingPacket(msg, rinfo) {
    if (this.isStopped || this.isFinished) return;

    try {
      const packet = deserialize(msg);

      if (packet.transferId !== this.transferId) {
        return; // Ignore packets from other transfers
      }

      // Record sender address for ACKs
      this.senderAddress = rinfo.address;
      this.senderPort = rinfo.port;

      if (packet.type === PACKET_TYPES.DATA) {
        this.processDataPacket(packet);
      } else if (packet.type === PACKET_TYPES.FIN) {
        this.processFinPacket(packet);
      }
    } catch (err) {
      // Checksum error or parsing failure: ignore and drop the packet
      this.emit('packet-corrupt', err.message);
    }
  }

  processDataPacket(packet) {
    const seq = packet.seqNum;
    this.totalPackets = packet.totalPackets;

    // If duplicate packet, just send ACK immediately and ignore
    if (seq < this.expectedSeqNum || this.chunks.has(seq)) {
      this.sendAck();
      return;
    }

    // Save payload to chunks map
    this.chunks.set(seq, packet.payload);

    // If this is the expected packet, slide expected sequence number forward
    if (seq === this.expectedSeqNum) {
      while (this.chunks.has(this.expectedSeqNum)) {
        this.expectedSeqNum++;
      }
    }

    // Emit progress to dashboard
    const bytesReceivedSoFar = Array.from(this.chunks.values()).reduce((sum, chunk) => sum + chunk.length, 0);
    this.emit('progress', {
      bytesReceived: bytesReceivedSoFar,
      expectedProgress: Number((this.expectedSeqNum / this.totalPackets).toFixed(4)),
      totalPackets: this.totalPackets,
      receivedPacketsCount: this.chunks.size
    });

    // Send ACK (which will include SACK information if there are gaps)
    this.sendAck();
  }

  sendAck() {
    if (this.isStopped || !this.senderAddress || !this.senderPort) return;

    // Calculate Selective ACK (SACK) payload
    // SACK payload contains a list of out-of-order packet sequence numbers received so far
    const sackSeqs = [];
    for (const seq of this.chunks.keys()) {
      if (seq >= this.expectedSeqNum) {
        sackSeqs.push(seq);
      }
    }

    // Sort to optimize sender's processing
    sackSeqs.sort((a, b) => a - b);

    // Limit SACK list to fit within UDP packet easily (max ~100 SACK entries)
    const limitedSackSeqs = sackSeqs.slice(0, 100);
    
    // Create SACK payload buffer: list of uint32 sequence numbers
    const payload = Buffer.alloc(limitedSackSeqs.length * 4);
    for (let i = 0; i < limitedSackSeqs.length; i++) {
      payload.writeUInt32BE(limitedSackSeqs[i], i * 4);
    }

    // Cumulative ACK number is expectedSeqNum - 1
    const cumulativeAckNum = this.expectedSeqNum - 1;

    const packet = serialize({
      type: SACK_TYPES_DETERMINE(limitedSackSeqs.length),
      transferId: this.transferId,
      seqNum: cumulativeAckNum >= 0 ? cumulativeAckNum : 0,
      totalPackets: this.totalPackets,
      payload
    });

    this.socket.send(packet, this.senderPort, this.senderAddress);
  }

  async processFinPacket(packet) {
    if (this.isFinished) return;

    // Verify we have all chunks
    if (this.chunks.size < this.totalPackets || this.expectedSeqNum < this.totalPackets) {
      // We are missing packets, send ACK to trigger retransmissions
      this.sendAck();
      return;
    }

    // Defer processing if aesKey is not yet set (race condition prevention)
    if (!this.aesKey) {
      this.finReceived = true;
      this.finPacket = packet;
      this.emit('status', 'Waiting for secure key exchange...');
      return;
    }

    // Mark as finished to prevent duplicate FIN processing
    this.isFinished = true;

    try {
      this.emit('status', 'Reassembling and decrypting file...');

      // Reassemble file ciphertext
      const orderedChunks = [];
      for (let i = 0; i < this.totalPackets; i++) {
        orderedChunks.push(this.chunks.get(i));
      }
      const encryptedData = Buffer.concat(orderedChunks);

      // Decrypt AES-256-GCM
      // Extract IV and Auth Tag from header or metadata?
      // Wait, in our encryption module, we return { iv, ciphertext, tag }.
      // How do we packetize the IV and Tag?
      // Ah! Let's think:
      // When the sender sends, does it encrypt the whole file at once or block-by-block?
      // In our design:
      // "File -> Compress -> AES Encryption -> UDP Packets"
      // So the sender encrypts the *entire* compressed file at once, which produces a single ciphertext, a single IV (12 bytes), and a single Auth Tag (16 bytes).
      // Wait, where do the IV and Auth Tag come from on the receiver side?
      // Excellent! The sender sends them over the secure Socket.IO control channel during the file transfer handshake, or prepends them to the ciphertext!
      // Sending them in the Socket.IO handshake metadata is incredibly clean, simple, and secure!
      // Let's check:
      // In our handshake, the sender sends a request containing `{ iv, tag, aesKey, fileName, fileSize, sha256Hash, compressionType }`.
      // The receiver accepts, obtains the keys and iv/tag, and then starts the UDP receiver!
      // This is perfectly secure, because the Socket.IO channel is encrypted, and the receiver has the exact IV and Tag needed to decrypt the entire ciphertext!
      // Let's implement this decryption flow.
      
      const { iv, tag } = this.aesKey; // aesKey is { key: hex, iv: hex, tag: hex }
      const decryptedData = decrypt(
        encryptedData,
        Buffer.from(this.aesKey.key, 'hex'),
        Buffer.from(iv, 'hex'),
        Buffer.from(tag, 'hex')
      );

      // Decompress
      this.emit('status', 'Decompressing file...');
      const decompressedData = await decompress(decryptedData, this.compressionType);

      // Verify SHA-256 integrity hash
      const crypto = require('crypto');
      const actualHash = crypto.createHash('sha256').update(decompressedData).digest('hex');

      if (actualHash !== this.sha256Hash) {
        throw new Error(`File integrity hash mismatch! Expected ${this.sha256Hash}, got ${actualHash}`);
      }

      this.emit('complete', decompressedData);
      this.stop();
    } catch (err) {
      console.error('[SwiftShare Debug] Decryption failed! aesKey:', this.aesKey, 'Error:', err);
      this.isFinished = false; // Reset to allow retry/retransmission if needed
      this.emit('error', err);
    }
  }
}

// Helper to determine packet type based on SACK list length
function SACK_TYPES_DETERMINE(sackLen) {
  return sackLen > 0 ? PACKET_TYPES.SACK : PACKET_TYPES.ACK;
}

module.exports = FileReceiver;

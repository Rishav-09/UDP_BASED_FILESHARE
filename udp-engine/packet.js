const crypto = require('crypto');

// Packet Types
const PACKET_TYPES = {
  DATA: 0x01,
  ACK: 0x02,
  INIT: 0x03,
  FIN: 0x04,
  SACK: 0x05
};

const MAGIC_BYTES = Buffer.from([0x53, 0x53]); // 'SS'
const HEADER_SIZE = 61; // 2 (magic) + 1 (type) + 16 (transferId) + 4 (seqNum) + 4 (totalPackets) + 2 (payloadLen) + 32 (checksum)

/**
 * Convert UUID string to 16-byte Buffer
 */
function uuidToBuffer(uuidStr) {
  const hex = uuidStr.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error('Invalid UUID for packet serialization');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Convert 16-byte Buffer to UUID string
 */
function bufferToUuid(buf) {
  const hex = buf.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

/**
 * Compute SHA-256 hash of buffer
 */
function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

/**
 * Serialize fields into a binary packet buffer
 */
function serialize({ type, transferId, seqNum, totalPackets, payload = Buffer.alloc(0) }) {
  const idBuf = uuidToBuffer(transferId);
  const payloadLen = payload.length;
  const checksum = sha256(payload);

  const header = Buffer.alloc(HEADER_SIZE);
  
  // Write Magic Bytes
  MAGIC_BYTES.copy(header, 0);
  // Write Packet Type
  header[2] = type;
  // Write Transfer ID (16 bytes)
  idBuf.copy(header, 3);
  // Write Sequence Number (4 bytes)
  header.writeUInt32BE(seqNum, 19);
  // Write Total Packets (4 bytes)
  header.writeUInt32BE(totalPackets, 23);
  // Write Payload Length (2 bytes)
  header.writeUInt16BE(payloadLen, 27);
  // Write SHA-256 Checksum (32 bytes)
  checksum.copy(header, 29);

  return Buffer.concat([header, payload]);
}

/**
 * Deserialize a binary packet buffer into fields
 */
function deserialize(buffer) {
  if (buffer.length < HEADER_SIZE) {
    throw new Error('Buffer too small to contain header');
  }

  // Verify Magic Bytes
  if (buffer[0] !== MAGIC_BYTES[0] || buffer[1] !== MAGIC_BYTES[1]) {
    throw new Error('Invalid packet magic bytes');
  }

  const type = buffer[2];
  const transferId = bufferToUuid(buffer.subarray(3, 19));
  const seqNum = buffer.readUInt32BE(19);
  const totalPackets = buffer.readUInt32BE(23);
  const payloadLen = buffer.readUInt16BE(27);
  
  const expectedChecksum = buffer.subarray(29, 61);
  const payload = buffer.subarray(HEADER_SIZE, HEADER_SIZE + payloadLen);

  // Validate checksum
  const actualChecksum = sha256(payload);
  if (!expectedChecksum.equals(actualChecksum)) {
    throw new Error('Packet payload checksum mismatch');
  }

  return {
    type,
    transferId,
    seqNum,
    totalPackets,
    payload
  };
}

module.exports = {
  PACKET_TYPES,
  HEADER_SIZE,
  serialize,
  deserialize
};

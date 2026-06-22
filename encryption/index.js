const crypto = require('crypto');

/**
 * Generate an ephemeral Elliptic Curve Diffie-Hellman (ECDH) keypair.
 * We use the NIST prime256v1 curve.
 */
function generateECDH() {
  const ecdh = crypto.createECDH('prime256v1');
  const publicKey = ecdh.generateKeys('hex');
  return { ecdh, publicKey };
}

/**
 * Compute the shared secret and derive a 256-bit symmetric AES key.
 * Uses HKDF/SHA-256 to derive a cryptographically strong session key.
 * @param {ECDH} ecdh - Local ECDH object
 * @param {string} peerPublicKeyHex - Peer's public key in Hex
 */
function deriveSessionKey(ecdh, peerPublicKeyHex) {
  const sharedSecret = ecdh.computeSecret(peerPublicKeyHex, 'hex');
  // Use HKDF to derive a 256-bit key from the shared secret
  const derivedKey = crypto.hkdfSync('sha256', sharedSecret, Buffer.alloc(0), Buffer.alloc(0), 32);
  return Buffer.from(derivedKey);
}

/**
 * Encrypt a buffer using AES-256-GCM
 * @param {Buffer} data - Plaintext buffer
 * @param {Buffer} key - 32-byte key buffer
 * @returns {object} - { iv, ciphertext, tag }
 */
function encrypt(data, key) {
  const iv = crypto.randomBytes(12); // 12-byte IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  return {
    iv,
    ciphertext,
    tag
  };
}

/**
 * Decrypt a buffer using AES-256-GCM
 * @param {Buffer} ciphertext - Ciphertext buffer
 * @param {Buffer} key - 32-byte key buffer
 * @param {Buffer} iv - 12-byte IV buffer
 * @param {Buffer} tag - 16-byte GCM authentication tag
 * @returns {Buffer} - Decrypted plaintext buffer
 */
function decrypt(ciphertext, key, iv, tag) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Hash a buffer or string with SHA-256 (for integrity checking)
 */
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = {
  generateECDH,
  deriveSessionKey,
  encrypt,
  decrypt,
  sha256
};

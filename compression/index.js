const zlib = require('zlib');

/**
 * Compress data buffer using GZIP, Brotli or None
 * @param {Buffer} data - Original data buffer
 * @param {string} algorithm - 'brotli' | 'gzip' | 'none'
 * @returns {Promise<{compressed: Buffer, originalSize: number, compressedSize: number, ratio: number, savings: number}>}
 */
function compress(data, algorithm = 'gzip') {
  return new Promise((resolve, reject) => {
    const originalSize = data.length;
    
    if (algorithm === 'none') {
      return resolve({
        compressed: data,
        originalSize,
        compressedSize: originalSize,
        ratio: 1.0,
        savings: 0
      });
    }

    if (algorithm === 'brotli') {
      zlib.brotliCompress(data, (err, result) => {
        if (err) return reject(err);
        const compressedSize = result.length;
        resolve({
          compressed: result,
          originalSize,
          compressedSize,
          ratio: Number((originalSize / compressedSize).toFixed(2)),
          savings: originalSize - compressedSize
        });
      });
    } else {
      // Default to gzip
      zlib.gzip(data, (err, result) => {
        if (err) return reject(err);
        const compressedSize = result.length;
        resolve({
          compressed: result,
          originalSize,
          compressedSize,
          ratio: Number((originalSize / compressedSize).toFixed(2)),
          savings: originalSize - compressedSize
        });
      });
    }
  });
}

/**
 * Decompress data buffer using GZIP, Brotli or None
 * @param {Buffer} data - Compressed data buffer
 * @param {string} algorithm - 'brotli' | 'gzip' | 'none'
 * @returns {Promise<Buffer>} - Decompressed data
 */
function decompress(data, algorithm = 'gzip') {
  return new Promise((resolve, reject) => {
    if (algorithm === 'none') {
      return resolve(data);
    }

    if (algorithm === 'brotli') {
      zlib.brotliDecompress(data, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    } else {
      // Default to gzip
      zlib.gunzip(data, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    }
  });
}

module.exports = {
  compress,
  decompress
};

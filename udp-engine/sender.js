const dgram = require('dgram');
const EventEmitter = require('events');
const { PACKET_TYPES, serialize, deserialize } = require('./packet');

class FileSender extends EventEmitter {
  constructor({
    transferId,
    host,
    port,
    data,
    chunkSize = 1024,
    initialSsthresh = 64
  }) {
    super();
    this.transferId = transferId;
    this.host = host;
    this.port = port;
    this.data = data; // Buffer of encrypted + compressed data
    this.chunkSize = chunkSize;

    // Packetizing
    this.totalPackets = Math.max(1, Math.ceil(this.data.length / this.chunkSize));

    // Congestion Control variables (TCP Reno)
    this.cwnd = 1.0;
    this.ssthresh = initialSsthresh;
    this.base = 0; // Oldest unacknowledged sequence number
    this.nextSeqNum = 0; // Next sequence number to send

    // Tracking states
    this.ackedPackets = new Set(); // Set of ACKed sequence numbers
    this.sentTimes = new Map(); // seqNum -> timestamp
    this.retransmitCounts = new Map(); // seqNum -> count
    this.isPaused = false;
    this.isStopped = false;

    // RTT estimation (RFC 6298)
    this.srtt = 150; // Smoothed RTT (ms)
    this.rttvar = 75; // RTT variation (ms)
    this.rto = 300; // Retransmission Timeout (ms)

    // Analytics counters
    this.totalRetransmissions = 0;
    this.totalPacketLossCount = 0;
    this.startTime = null;
    this.bytesAcked = 0;
    this.lastSpeedCheckTime = null;
    this.lastSpeedCheckBytes = 0;
    this.currentSpeed = 0; // Bytes/sec

    // Socket
    this.socket = null;
    this.timerInterval = null;
  }

  start() {
    this.socket = dgram.createSocket('udp4');
    this.startTime = Date.now();
    this.lastSpeedCheckTime = Date.now();

    this.socket.on('error', (err) => {
      this.emit('error', err);
      this.stop();
    });

    this.socket.on('message', (msg, rinfo) => {
      this.handleIncomingFeedback(msg, rinfo);
    });

    // Bind to any available local port to receive ACKs
    this.socket.bind(0, '0.0.0.0', () => {
      const addr = this.socket.address();
      this.emit('status', `Sender bound to local UDP port ${addr.port}, sending to ${this.host}:${this.port}`);
      this.sendMore();
    });

    // Start timer check loop every 10ms for RTO timeouts
    this.timerInterval = setInterval(() => {
      this.checkTimeouts();
      this.updateAnalytics();
    }, 20);
  }

  pause() {
    if (this.isStopped) return;
    this.isPaused = true;
    this.emit('status', 'Sender paused');
  }

  resume() {
    if (this.isStopped) return;
    this.isPaused = false;
    this.lastSpeedCheckTime = Date.now();
    this.lastSpeedCheckBytes = this.bytesAcked;
    this.emit('status', 'Sender resumed');
    this.sendMore();
  }

  stop() {
    this.isStopped = true;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
    this.emit('status', 'Sender stopped');
  }

  sendMore() {
    if (this.isPaused || this.isStopped) return;

    // Send packets within the window
    const windowLimit = this.base + Math.floor(this.cwnd);
    
    while (this.nextSeqNum < windowLimit && this.nextSeqNum < this.totalPackets) {
      this.sendPacket(this.nextSeqNum);
      this.nextSeqNum++;
    }
  }

  sendPacket(seqNum) {
    if (this.isStopped) return;

    const start = seqNum * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.data.length);
    const payload = this.data.subarray(start, end);

    const packet = serialize({
      type: PACKET_TYPES.DATA,
      transferId: this.transferId,
      seqNum,
      totalPackets: this.totalPackets,
      payload
    });

    this.sentTimes.set(seqNum, Date.now());
    
    this.socket.send(packet, this.port, this.host, (err) => {
      if (err && !this.isStopped) {
        this.emit('error', err);
      }
    });
  }

  handleIncomingFeedback(msg, rinfo) {
    try {
      const packet = deserialize(msg);
      
      if (packet.transferId !== this.transferId) {
        return; // Ignore packet if it belongs to another transfer
      }

      if (packet.type === PACKET_TYPES.ACK || packet.type === PACKET_TYPES.SACK) {
        this.processAck(packet.seqNum, packet.type === PACKET_TYPES.SACK ? packet.payload : null);
      }
    } catch (err) {
      // Corrupt ACK packet or parsing failure, ignore
    }
  }

  processAck(ackNum, sackPayload) {
    if (this.isStopped) return;

    const now = Date.now();
    let isNewAck = false;

    // Cumulative ACK: ackNum represents that all packets up to ackNum are received.
    // So all packets < ackNum + 1 are acknowledged.
    for (let seq = this.base; seq <= ackNum; seq++) {
      if (!this.ackedPackets.has(seq) && seq < this.totalPackets) {
        this.ackedPackets.add(seq);
        isNewAck = true;
        this.bytesAcked += Math.min(this.chunkSize, this.data.length - (seq * this.chunkSize));

        // Measure RTT for this packet if it wasn't retransmitted
        const sendTime = this.sentTimes.get(seq);
        const retransmitCount = this.retransmitCounts.get(seq) || 0;
        if (sendTime && retransmitCount === 0) {
          const rttSample = now - sendTime;
          this.updateRtt(rttSample);
        }
      }
    }

    // Process SACK info (list of uint32 sequence numbers received out of order)
    if (sackPayload && sackPayload.length >= 4) {
      const sackCount = Math.floor(sackPayload.length / 4);
      for (let i = 0; i < sackCount; i++) {
        const seq = sackPayload.readUInt32BE(i * 4);
        if (!this.ackedPackets.has(seq) && seq < this.totalPackets) {
          this.ackedPackets.add(seq);
          isNewAck = true;
          this.bytesAcked += Math.min(this.chunkSize, this.data.length - (seq * this.chunkSize));
          
          // Measure RTT
          const sendTime = this.sentTimes.get(seq);
          const retransmitCount = this.retransmitCounts.get(seq) || 0;
          if (sendTime && retransmitCount === 0) {
            const rttSample = now - sendTime;
            this.updateRtt(rttSample);
          }
        }
      }
    }

    if (isNewAck) {
      // Update sliding window base
      const oldBase = this.base;
      while (this.ackedPackets.has(this.base) && this.base < this.totalPackets) {
        this.base++;
      }

      // Congestion Window Adjustment (TCP Reno)
      if (this.cwnd < this.ssthresh) {
        // Slow Start: double cwnd every RTT. (Increase by 1 per ACK)
        this.cwnd += 1.0;
      } else {
        // Congestion Avoidance: increase by 1 per RTT. (Increase by 1/cwnd per ACK)
        this.cwnd += 1.0 / Math.floor(this.cwnd);
      }

      this.emit('progress', {
        bytesAcked: this.bytesAcked,
        totalBytes: this.data.length,
        progress: Number((this.bytesAcked / this.data.length).toFixed(4)),
        cwnd: Number(this.cwnd.toFixed(2)),
        ssthresh: this.ssthresh,
        rtt: this.srtt,
        lossRate: this.calculateLossRate(),
        retransmissions: this.totalRetransmissions,
        speed: this.currentSpeed
      });

      // If all packets are acked, send FIN packet
      if (this.base >= this.totalPackets) {
        this.sendFin();
      } else {
        this.sendMore();
      }
    }
  }

  updateRtt(sample) {
    // RFC 6298 RTT estimation
    const alpha = 0.125;
    const beta = 0.25;

    this.rttvar = (1 - beta) * this.rttvar + beta * Math.abs(this.srtt - sample);
    this.srtt = (1 - alpha) * this.srtt + alpha * sample;
    this.rto = Math.max(50, Math.min(3000, this.srtt + 4 * this.rttvar));
  }

  checkTimeouts() {
    if (this.isPaused || this.isStopped || this.base >= this.totalPackets) return;

    const now = Date.now();
    
    // Check if the oldest unacknowledged packet has timed out
    const sendTime = this.sentTimes.get(this.base);
    if (sendTime && (now - sendTime > this.rto)) {
      this.totalPacketLossCount++;
      this.totalRetransmissions++;

      // Retransmit packet
      const retransCount = (this.retransmitCounts.get(this.base) || 0) + 1;
      this.retransmitCounts.set(this.base, retransCount);

      // Back off RTO exponentially (up to 8000ms)
      this.rto = Math.min(8000, this.rto * 2);

      // TCP Reno congestion adjustment on Timeout
      this.ssthresh = Math.max(2, Math.floor(this.cwnd / 2));
      this.cwnd = 1.0;

      this.emit('packet-loss', {
        seqNum: this.base,
        rto: this.rto,
        cwnd: this.cwnd,
        ssthresh: this.ssthresh
      });

      // Retransmit base and reset its time
      this.sendPacket(this.base);
      
      // Let nextSeqNum be set to base + 1 so we re-evaluate from there
      this.nextSeqNum = this.base + 1;
      this.sendMore();
    }
  }

  sendFin() {
    if (this.isStopped) return;

    const packet = serialize({
      type: PACKET_TYPES.FIN,
      transferId: this.transferId,
      seqNum: this.totalPackets,
      totalPackets: this.totalPackets
    });

    // Send FIN multiple times to ensure the receiver gets it
    let finCount = 0;
    const sendFinInterval = setInterval(() => {
      if (this.isStopped || finCount >= 5) {
        clearInterval(sendFinInterval);
        this.emit('complete');
        this.stop();
        return;
      }
      
      if (this.socket) {
        this.socket.send(packet, this.port, this.host);
      }
      finCount++;
    }, 100);
  }

  calculateLossRate() {
    const totalSent = this.totalPackets + this.totalRetransmissions;
    if (totalSent === 0) return 0;
    return Number((this.totalRetransmissions / totalSent).toFixed(4));
  }

  updateAnalytics() {
    if (this.isPaused || this.isStopped) return;

    const now = Date.now();
    const elapsed = now - this.lastSpeedCheckTime;

    if (elapsed >= 1000) {
      const bytesTransferred = this.bytesAcked - this.lastSpeedCheckBytes;
      this.currentSpeed = Math.floor((bytesTransferred / elapsed) * 1000); // bytes per second
      
      this.lastSpeedCheckTime = now;
      this.lastSpeedCheckBytes = this.bytesAcked;

      this.emit('speed-update', {
        speed: this.currentSpeed,
        progress: Number((this.bytesAcked / this.data.length).toFixed(4)),
        cwnd: Number(this.cwnd.toFixed(2)),
        rtt: this.srtt,
        rto: this.rto,
        retransmissions: this.totalRetransmissions
      });
    }
  }
}

module.exports = FileSender;

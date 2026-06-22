const dgram = require('dgram');
const os = require('os');
const EventEmitter = require('events');
const db = require('../database');

const BROADCAST_ADDR = '255.255.255.255';
const BROADCAST_PORT = 41234;

const MULTICAST_ADDR = '230.1.1.1';
const MULTICAST_PORT = 41235;

const PEER_TIMEOUT_MS = 8000;

class DiscoveryService extends EventEmitter {
  constructor({ instanceId, getPorts }) {
    super();
    this.instanceId = instanceId;
    this.getPorts = getPorts; // Function returning { chatPort, filePort }

    this.peers = new Map(); // peerId -> peerDetails
    this.broadcastSocket = null;
    this.multicastSocket = null;
    this.heartbeatInterval = null;
    this.staleCheckInterval = null;
    this.isListening = false;
  }

  isVirtualInterface(name) {
    const lower = name.toLowerCase();
    return lower.includes('virtual') || 
           lower.includes('veth') || 
           lower.includes('wsl') || 
           lower.includes('loopback') || 
           lower.includes('host-only') || 
           lower.includes('vmware') || 
           lower.includes('hyper-v') ||
           lower.includes('docker') ||
           lower.includes('vpn');
  }

  getBroadcastAddress(ip, netmask) {
    try {
      const ipParts = ip.split('.').map(Number);
      const maskParts = netmask.split('.').map(Number);
      if (ipParts.length !== 4 || maskParts.length !== 4) return null;
      const broadcastParts = [];
      for (let i = 0; i < 4; i++) {
        broadcastParts.push(ipParts[i] | (255 - maskParts[i]));
      }
      return broadcastParts.join('.');
    } catch (e) {
      return null;
    }
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    let fallback = '127.0.0.1';
    
    // First pass: look for a non-virtual IPv4 interface
    for (const name of Object.keys(interfaces)) {
      if (this.isVirtualInterface(name)) continue;
      for (const entry of interfaces[name]) {
        if (entry.family === 'IPv4' && !entry.internal) {
          return entry.address;
        }
      }
    }
    
    // Second pass: any non-internal IPv4
    for (const name of Object.keys(interfaces)) {
      for (const entry of interfaces[name]) {
        if (entry.family === 'IPv4' && !entry.internal) {
          return entry.address;
        }
      }
    }
    
    return fallback;
  }

  start() {
    if (this.isListening) return;
    this.isListening = true;

    const localIP = this.getLocalIP();

    // 1. Broadcast Socket Setup
    this.broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    this.broadcastSocket.on('error', (err) => {
      this.emit('error', `Broadcast socket error: ${err.message}`);
    });

    this.broadcastSocket.on('message', (msg, rinfo) => {
      this.handleIncomingMessage(msg, rinfo);
    });

    this.broadcastSocket.bind(BROADCAST_PORT, '0.0.0.0', () => {
      try {
        this.broadcastSocket.setBroadcast(true);
        this.emit('status', `Discovery broadcasting on UDP ${BROADCAST_PORT}`);
      } catch (err) {
        this.emit('error', `Failed to enable broadcast: ${err.message}`);
      }
    });

    // 2. Multicast Socket Setup
    this.multicastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    this.multicastSocket.on('error', (err) => {
      this.emit('error', `Multicast socket error: ${err.message}`);
    });

    this.multicastSocket.on('message', (msg, rinfo) => {
      this.handleIncomingMessage(msg, rinfo);
    });

    this.multicastSocket.bind(MULTICAST_PORT, '0.0.0.0', () => {
      try {
        this.multicastSocket.addMembership(MULTICAST_ADDR);
        this.emit('status', `Discovery multicast listening on group ${MULTICAST_ADDR}:${MULTICAST_PORT}`);
      } catch (err) {
        this.emit('error', `Failed to join multicast membership: ${err.message}`);
      }
    });

    // 3. Heartbeat and Stale Peer Timers
    this.announce();
    this.heartbeatInterval = setInterval(() => this.announce(), 3000);
    this.staleCheckInterval = setInterval(() => this.checkStalePeers(), 2000);
  }

  announce() {
    if (!this.isListening) return;

    const settings = db.getSettings();
    const ports = this.getPorts();
    const localIP = this.getLocalIP();

    const payload = {
      type: 'DISCOVER_USER',
      id: this.instanceId,
      username: settings.username,
      deviceNickname: settings.deviceNickname,
      ip: localIP,
      chatPort: ports.chatPort,
      filePort: ports.filePort,
      ts: Date.now(),
      status: 'online'
    };

    const serialized = Buffer.from(JSON.stringify(payload), 'utf8');

    // Gather all active subnet broadcast destinations
    const destinations = new Set();
    destinations.add(BROADCAST_ADDR); // Include global fallback

    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        for (const entry of interfaces[name]) {
          if (entry.family === 'IPv4' && !entry.internal) {
            const bcast = this.getBroadcastAddress(entry.address, entry.netmask);
            if (bcast) {
              destinations.add(bcast);
            }
          }
        }
      }
    } catch (e) {
      this.emit('debug', `Failed calculating interface broadcasts: ${e.message}`);
    }

    // Send Broadcast to all identified broadcast addresses
    if (this.broadcastSocket) {
      for (const addr of destinations) {
        this.broadcastSocket.send(serialized, BROADCAST_PORT, addr, (err) => {
          if (err) this.emit('debug', `Broadcast to ${addr} failed: ${err.message}`);
        });
      }
    }

    // Send Multicast
    if (this.multicastSocket) {
      this.multicastSocket.send(serialized, MULTICAST_PORT, MULTICAST_ADDR, (err) => {
        if (err) this.emit('debug', `Multicast send failed: ${err.message}`);
      });
    }
  }

  handleIncomingMessage(msg, rinfo) {
    try {
      const payload = JSON.parse(msg.toString('utf8'));

      if (payload.id === this.instanceId) {
        return; // Ignore self
      }

      if (payload.type === 'DISCOVER_USER') {
        const peer = {
          id: payload.id,
          username: payload.username || 'Unknown Peer',
          deviceNickname: payload.deviceNickname || 'Unknown Device',
          ip: rinfo.address,
          chatPort: payload.chatPort,
          filePort: payload.filePort,
          status: payload.status || 'online',
          lastSeen: Date.now()
        };

        const existing = this.peers.get(peer.id);
        this.peers.set(peer.id, peer);

        if (!existing) {
          this.emit('peer-online', peer);
        } else if (existing.username !== peer.username || existing.deviceNickname !== peer.deviceNickname || existing.status !== peer.status || existing.ip !== peer.ip) {
          this.emit('peer-update', peer);
        }

        // Reply immediately with unicast USER_AVAILABLE if they initiated
        if (!existing) {
          this.replyUnicast(peer);
        }
      } else if (payload.type === 'USER_AVAILABLE') {
        const peer = {
          id: payload.id,
          username: payload.username,
          deviceNickname: payload.deviceNickname,
          ip: rinfo.address,
          chatPort: payload.chatPort,
          filePort: payload.filePort,
          status: payload.status || 'online',
          lastSeen: Date.now()
        };

        const existing = this.peers.get(peer.id);
        this.peers.set(peer.id, peer);

        if (!existing) {
          this.emit('peer-online', peer);
        } else if (existing.username !== peer.username || existing.deviceNickname !== peer.deviceNickname || existing.status !== peer.status || existing.ip !== peer.ip) {
          this.emit('peer-update', peer);
        }
      }
    } catch (err) {
      this.emit('debug', `Discovery parse failed: ${err.message}`);
    }
  }

  replyUnicast(peer) {
    const settings = db.getSettings();
    const ports = this.getPorts();
    const localIP = this.getLocalIP();

    const payload = {
      type: 'USER_AVAILABLE',
      id: this.instanceId,
      username: settings.username,
      deviceNickname: settings.deviceNickname,
      ip: localIP,
      chatPort: ports.chatPort,
      filePort: ports.filePort,
      ts: Date.now(),
      status: 'online'
    };

    const serialized = Buffer.from(JSON.stringify(payload), 'utf8');
    
    // Send directly to the discovered peer's chatPort/discovery channel
    const replySocket = dgram.createSocket('udp4');
    replySocket.send(serialized, BROADCAST_PORT, peer.ip, () => {
      replySocket.close();
    });
  }

  checkStalePeers() {
    const now = Date.now();
    for (const [peerId, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(peerId);
        this.emit('peer-offline', peerId);
      }
    }
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  stop() {
    this.isListening = false;
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }

    if (this.broadcastSocket) {
      try {
        this.broadcastSocket.close();
      } catch (e) {}
      this.broadcastSocket = null;
    }

    if (this.multicastSocket) {
      try {
        this.multicastSocket.close();
      } catch (e) {}
      this.multicastSocket = null;
    }
  }
}

module.exports = DiscoveryService;

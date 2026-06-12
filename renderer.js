const DISCOVERY_PORT = 41234;
const PEER_TIMEOUT_MS = 8000;

const api = window.api;

const elements = {
  localName: document.getElementById('local-name'),
  localIp: document.getElementById('local-ip'),
  localPorts: document.getElementById('local-ports'),
  peerCount: document.getElementById('peer-count'),
  discoveryStatus: document.getElementById('discovery-status'),
  peersGrid: document.getElementById('peers-grid'),
  activityList: document.getElementById('activity-list')
};

const state = {
  peers: new Map(),
  chatPort: null,
  filePort: null,
  discoveryStarted: false,
  activityEntries: []
};

function addActivity(kind, text) {
  state.activityEntries.unshift({
    kind,
    text,
    ts: new Date().toLocaleTimeString()
  });

  state.activityEntries = state.activityEntries.slice(0, 20);
  renderActivity();
}

function renderActivity() {
  elements.activityList.innerHTML = state.activityEntries.map((entry) => `
    <li class="activity-item">
      <span class="activity-kind">${entry.kind}</span>
      <span class="activity-text">${entry.text}</span>
      <span class="activity-ts">${entry.ts}</span>
    </li>
  `).join('');
}

function setDiscoveryStatus(text, tone = 'info') {
  elements.discoveryStatus.textContent = text;
  elements.discoveryStatus.dataset.tone = tone;
}

function updateLocalHeader() {
  elements.localName.textContent = api.hostName;
  elements.localIp.textContent = api.localIP;
  elements.localPorts.textContent = `TCP ${state.chatPort ?? 'pending'} | UDP ${state.filePort ?? 'pending'}`;
}

function touchPeer(peer) {
  const existing = state.peers.get(peer.id) || {};
  state.peers.set(peer.id, {
    ...existing,
    ...peer,
    lastSeen: Date.now()
  });

  renderPeers();
}

function removeStalePeers() {
  const now = Date.now();
  let changed = false;

  for (const [peerId, peer] of state.peers.entries()) {
    if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
      state.peers.delete(peerId);
      changed = true;
    }
  }

  if (changed) {
    renderPeers();
  }
}

function renderPeers() {
  const peers = Array.from(state.peers.values()).sort((left, right) => left.name.localeCompare(right.name));
  elements.peerCount.textContent = `${peers.length} active peer${peers.length === 1 ? '' : 's'}`;

  if (peers.length === 0) {
    elements.peersGrid.innerHTML = `
      <div class="empty-state">
        <h3>Scanning the LAN</h3>
        <p>Peers appear here automatically once they announce themselves.</p>
      </div>
    `;
    return;
  }

  elements.peersGrid.innerHTML = peers.map((peer) => `
    <article class="peer-card">
      <div>
        <div class="peer-topline">
          <span class="peer-dot"></span>
          <span>Live</span>
        </div>
        <h3>${peer.name}</h3>
        <p class="peer-meta">${peer.ip} · chat ${peer.chatPort} · files ${peer.filePort}</p>
        <p class="peer-submeta">Last seen ${new Date(peer.lastSeen).toLocaleTimeString()}</p>
      </div>
      <div class="button-row">
        <button type="button" class="primary" data-action="chat" data-peer-id="${peer.id}">Chat</button>
        <button type="button" class="secondary" data-action="file" data-peer-id="${peer.id}">Send file</button>
      </div>
    </article>
  `).join('');

  elements.peersGrid.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const peerId = button.dataset.peerId;
      const action = button.dataset.action;
      const peer = state.peers.get(peerId);

      if (!peer) {
        return;
      }

      if (action === 'chat') {
        promptAndSendChat(peer);
      }

      if (action === 'file') {
        promptAndSendFile(peer);
      }
    });
  });
}

async function promptAndSendChat(peer) {
  const message = window.prompt(`Send a TCP chat message to ${peer.name}?`);

  if (!message) {
    return;
  }

  try {
    await api.sendChatMessage({
      host: peer.ip,
      port: peer.chatPort,
      peerId: peer.id,
      peerName: peer.name,
      message
    });

    addActivity('chat', `Sent to ${peer.name}: ${message}`);
    setDiscoveryStatus(`Chat delivered to ${peer.name}`, 'success');
  } catch (error) {
    addActivity('error', `Chat failed for ${peer.name}: ${error.message}`);
    setDiscoveryStatus(`Chat failed: ${error.message}`, 'error');
  }
}

function promptAndSendFile(peer) {
  const input = document.createElement('input');
  input.type = 'file';

  input.onchange = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    const maxSize = 25 * 1024 * 1024;
    if (file.size > maxSize) {
      window.alert(`${file.name} is larger than the 25 MB transfer limit.`);
      return;
    }

    try {
      const bytes = await file.arrayBuffer();
      addActivity('file', `Sending ${file.name} to ${peer.name}`);
      setDiscoveryStatus(`Transferring ${file.name} to ${peer.name}`, 'success');

      await api.sendFile({
        host: peer.ip,
        port: peer.filePort,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        data: bytes,
        onProgress: ({ sentChunks, totalChunks }) => {
          elements.localPorts.textContent = `TCP ${state.chatPort ?? 'pending'} | UDP ${state.filePort ?? 'pending'} | file ${sentChunks}/${totalChunks}`;
        }
      });

      addActivity('file', `Finished sending ${file.name}`);
    } catch (error) {
      addActivity('error', `File transfer failed for ${peer.name}: ${error.message}`);
      setDiscoveryStatus(`File transfer failed: ${error.message}`, 'error');
    }
  };

  input.click();
}

function downloadIncomingFile({ fileName, mimeType, bytes, receivedFrom }) {
  const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  addActivity('file', `Received ${fileName} from ${receivedFrom}`);
}

function startServices() {
  api.startChatServer({
    onReady(port) {
      state.chatPort = port;
      updateLocalHeader();
      maybeStartDiscovery();
    },
    onMessage(payload) {
      addActivity('chat', `Incoming from ${payload.peerName || payload.remoteAddress}: ${payload.message}`);
      setDiscoveryStatus(`Chat received from ${payload.peerName || payload.remoteAddress}`, 'info');
    },
    onStatus(text) {
      addActivity('system', text);
    }
  });

  api.startFileReceiver({
    onReady(port) {
      state.filePort = port;
      updateLocalHeader();
      maybeStartDiscovery();
    },
    onTransferComplete(payload) {
      downloadIncomingFile(payload);
      setDiscoveryStatus(`Received ${payload.fileName}`, 'success');
    },
    onStatus(text) {
      addActivity('system', text);
    }
  });
}

function maybeStartDiscovery() {
  if (state.discoveryStarted || state.chatPort === null || state.filePort === null) {
    return;
  }

  state.discoveryStarted = true;

  api.startDiscovery({
    port: DISCOVERY_PORT,
    getAdvertisement: () => ({
      chatPort: state.chatPort,
      filePort: state.filePort
    }),
    onPeer(peer) {
      touchPeer(peer);
      setDiscoveryStatus(`Discovered ${state.peers.size} peer${state.peers.size === 1 ? '' : 's'}`, 'success');
    },
    onStatus(text) {
      setDiscoveryStatus(text);
      addActivity('system', text);
    }
  });
}

updateLocalHeader();
renderPeers();
startServices();
setInterval(removeStalePeers, 2000);

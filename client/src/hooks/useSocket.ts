import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export interface Peer {
  id: string;
  username: string;
  deviceNickname: string;
  ip: string;
  chatPort: number;
  filePort: number;
  status: 'online' | 'busy';
  lastSeen: number;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
  status: 'sent' | 'delivered' | 'seen';
}

export interface ConnectionRequest {
  peerId: string;
  username: string;
  deviceNickname: string;
}

export interface FileRequest {
  transferId: string;
  peerId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256Hash: string;
  compressionType: string;
}

export interface TransferProgress {
  transferId: string;
  direction: 'upload' | 'download';
  bytesAcked?: number;
  bytesReceived?: number;
  totalBytes?: number;
  totalPackets?: number;
  progress: number;
  cwnd?: number;
  ssthresh?: number;
  rtt?: number;
  lossRate?: number;
  retransmissions?: number;
  speed: number; // bytes/sec
  originalSize?: number;
  compressedSize?: number;
  savings?: number;
  rto?: number;
  status?: string;
}

export interface TransferLog {
  transferId: string;
  message: string;
}

declare global {
  interface Window {
    api?: {
      getLocalServerPort: () => string;
      platform: string;
    };
  }
}

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  
  // App States
  const [localInfo, setLocalInfo] = useState<{
    instanceId: string;
    username: string;
    deviceNickname: string;
    ip: string;
    port: number;
  } | null>(null);

  const [peers, setPeers] = useState<Map<string, Peer>>(new Map());
  const [chats, setChats] = useState<{ [peerId: string]: Message[] }>({});
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  const [typingPeers, setTypingPeers] = useState<{ [peerId: string]: boolean }>({});
  const [peerConnectionStates, setPeerConnectionStates] = useState<{ [peerId: string]: 'none' | 'pending' | 'connected' }>({});

  // Dialog / Pop-up prompts
  const [incomingConnection, setIncomingConnection] = useState<ConnectionRequest | null>(null);
  const [incomingFileRequest, setIncomingFileRequest] = useState<FileRequest | null>(null);

  // Transfer Trackers
  const [transfers, setTransfers] = useState<{ [transferId: string]: TransferProgress }>({});
  const [transferHistory, setTransferHistory] = useState<any[]>([]);

  // Ref to hold the socket for events
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const port = (typeof window !== 'undefined' && window.api)
      ? window.api.getLocalServerPort()
      : (new URLSearchParams(window.location.search).get('port') || '50000');

    if (typeof window !== 'undefined' && !window.api) {
      console.warn(`[SwiftShare] window.api is undefined (likely running in a normal web browser). Falling back to port ${port}. To connect, pass '?port=YOUR_SERVER_PORT' in the URL query string.`);
    }

    const s = io(`http://localhost:${port}`, {
      query: { role: 'ui' },
      transports: ['websocket']
    });

    socketRef.current = s;

    s.on('connect', () => {
      setIsConnected(true);
      
      // Request initial details
      s.emit('get-status', (status: any) => {
        setLocalInfo({
          instanceId: status.instanceId,
          username: status.username,
          deviceNickname: status.deviceNickname,
          ip: status.ip,
          port: status.port
        });
        
        const peerMap = new Map<string, Peer>();
        status.peers.forEach((p: Peer) => peerMap.set(p.id, p));
        setPeers(peerMap);
      });

      s.emit('get-transfers-history', (history: any[]) => {
        setTransferHistory(history);
      });
    });

    s.on('disconnect', () => {
      setIsConnected(false);
    });

    // 1. Discovery Events
    s.on('peer-online', (peer: Peer) => {
      setPeers(prev => {
        const next = new Map(prev);
        next.set(peer.id, peer);
        return next;
      });
    });

    s.on('peer-update', (peer: Peer) => {
      setPeers(prev => {
        const next = new Map(prev);
        next.set(peer.id, peer);
        return next;
      });
    });

    s.on('peer-offline', (peerId: string) => {
      setPeers(prev => {
        const next = new Map(prev);
        next.delete(peerId);
        return next;
      });
      setPeerConnectionStates(prev => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    });

    // 2. Chat Signalling
    s.on('incoming-connection-request', (req: ConnectionRequest) => {
      setIncomingConnection(req);
    });

    s.on('connection-established', ({ peerId }: { peerId: string }) => {
      setPeerConnectionStates(prev => ({ ...prev, [peerId]: 'connected' }));
      // Fetch initial chat logs
      s.emit('get-chats', peerId, (messages: Message[]) => {
        setChats(prev => ({ ...prev, [peerId]: messages }));
      });
    });

    s.on('connection-rejected', ({ peerId }: { peerId: string }) => {
      setPeerConnectionStates(prev => ({ ...prev, [peerId]: 'none' }));
    });

    s.on('peer-connection-status', ({ peerId, status }: { peerId: string, status: string }) => {
      if (status === 'disconnected') {
        setPeerConnectionStates(prev => ({ ...prev, [peerId]: 'none' }));
      }
    });

    s.on('incoming-message', ({ peerId, message }: { peerId: string, message: Message }) => {
      setChats(prev => {
        const peerMsgs = prev[peerId] || [];
        return {
          ...prev,
          [peerId]: [...peerMsgs.filter(m => m.id !== message.id), message]
        };
      });
    });

    s.on('peer-typing', ({ peerId, isTyping }: { peerId: string, isTyping: boolean }) => {
      setTypingPeers(prev => ({ ...prev, [peerId]: isTyping }));
    });

    s.on('message-seen-update', ({ peerId, msgId }: { peerId: string, msgId: string }) => {
      setChats(prev => {
        const peerMsgs = prev[peerId] || [];
        return {
          ...prev,
          [peerId]: peerMsgs.map(m => m.id === msgId ? { ...m, status: 'seen' } : m)
        };
      });
    });

    // 3. File Transfer Signalling & Progress
    s.on('incoming-file-request', (req: FileRequest) => {
      setIncomingFileRequest(req);
      // Cache details in transfers
      setTransfers(prev => ({
        ...prev,
        [req.transferId]: {
          transferId: req.transferId,
          peerId: req.peerId,
          direction: 'download',
          progress: 0,
          speed: 0,
          status: 'pending-approval'
        }
      }));
    });

    s.on('transfer-accepted', ({ transferId }: { transferId: string }) => {
      setTransfers(prev => ({
        ...prev,
        [transferId]: {
          ...(prev[transferId] || { transferId, direction: 'upload' }),
          progress: 0,
          status: 'accepted'
        }
      }));
    });

    s.on('transfer-rejected', ({ transferId }: { transferId: string }) => {
      setTransfers(prev => ({
        ...prev,
        [transferId]: {
          ...(prev[transferId] || { transferId, direction: 'upload' }),
          progress: 0,
          status: 'rejected'
        }
      }));
    });

    s.on('transfer-status-update', ({ transferId, status }: { transferId: string, status: string }) => {
      setTransfers(prev => ({
        ...prev,
        [transferId]: {
          ...(prev[transferId] || { transferId, direction: 'upload' }),
          progress: 0,
          status
        }
      }));
    });

    s.on('transfer-status-log', ({ transferId, message }: { transferId: string, message: string }) => {
      setTransfers(prev => ({
        ...prev,
        [transferId]: {
          ...(prev[transferId] || { transferId, direction: 'upload', progress: 0, speed: 0 }),
          status: message
        }
      }));
    });

    s.on('transfer-progress', (progress: any) => {
      const calculatedProgress = progress.expectedProgress !== undefined ? progress.expectedProgress : progress.progress;
      setTransfers(prev => ({
        ...prev,
        [progress.transferId]: {
          ...(prev[progress.transferId] || {}),
          ...progress,
          progress: calculatedProgress,
          status: 'transferring'
        }
      }));
    });

    s.on('transfer-packet-loss', ({ transferId, cwnd, ssthresh }: any) => {
      setTransfers(prev => {
        const curr = prev[transferId] || { transferId, direction: 'upload', progress: 0, speed: 0 };
        return {
          ...prev,
          [transferId]: {
            ...curr,
            cwnd,
            ssthresh,
            lossRate: (curr.lossRate || 0) + 0.01 // simulation incremental representation
          }
        };
      });
    });

    s.on('transfer-complete', ({ transferId, direction, fileName, bytes }: { transferId: string, direction: 'upload' | 'download', fileName?: string, bytes?: any }) => {
      setTransfers(prev => ({
        ...prev,
        [transferId]: {
          ...(prev[transferId] || {}),
          direction,
          progress: 1.0,
          status: 'completed',
          speed: 0
        }
      }));

      // Trigger standard browser download for incoming file complete
      if (direction === 'download' && fileName && bytes) {
        const blob = new Blob([bytes]);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      }

      // Reload transfer history
      s.emit('get-transfers-history', (history: any[]) => {
        setTransferHistory(history);
      });
    });

    s.on('transfer-error', ({ transferId, message }: { transferId: string, message: string }) => {
      setTransfers(prev => ({
        ...prev,
        [transferId]: {
          ...(prev[transferId] || {}),
          status: 'failed',
          speed: 0
        }
      }));
      alert(`Transfer Error: ${message}`);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  // UI action triggers
  const connectPeer = useCallback((peerId: string) => {
    if (!socketRef.current) return;
    setPeerConnectionStates(prev => ({ ...prev, [peerId]: 'pending' }));
    socketRef.current.emit('connect-peer', peerId, (res: any) => {
      if (!res.success) {
        setPeerConnectionStates(prev => ({ ...prev, [peerId]: 'none' }));
        alert(`Failed to connect peer: ${res.error}`);
      }
    });
  }, []);

  const respondConnection = useCallback((peerId: string, accepted: boolean) => {
    if (!socketRef.current) return;
    setIncomingConnection(null);
    socketRef.current.emit('respond-connection', { peerId, accepted }, (res: any) => {
      if (accepted && res.success) {
        setPeerConnectionStates(prev => ({ ...prev, [peerId]: 'connected' }));
      }
    });
  }, []);

  const sendChat = useCallback((peerId: string, text: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('send-chat', { peerId, text }, (res: any) => {
      if (res.success) {
        setChats(prev => {
          const peerMsgs = prev[peerId] || [];
          return {
            ...prev,
            [peerId]: [...peerMsgs, res.message]
          };
        });
      } else {
        alert(`Message delivery failed: ${res.error}`);
      }
    });
  }, []);

  const sendTyping = useCallback((peerId: string, isTyping: boolean) => {
    if (!socketRef.current) return;
    socketRef.current.emit('send-typing', { peerId, isTyping });
  }, []);

  const clearChat = useCallback((peerId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('clear-chat', peerId, (res: any) => {
      if (res.success) {
        setChats(prev => ({ ...prev, [peerId]: [] }));
      }
    });
  }, []);

  const sendFile = useCallback((peerId: string, fileName: string, fileBytes: ArrayBuffer) => {
    if (!socketRef.current) return;
    
    // Emit the ArrayBuffer directly to Socket.IO without converting to Array
    socketRef.current.emit('send-file', { peerId, fileName, fileBytes, mimeType: 'application/octet-stream' }, (res: any) => {
      if (res.success) {
        // Log in transfers progress state
        setTransfers(prev => ({
          ...prev,
          [res.transferId]: {
            transferId: res.transferId,
            peerId,
            direction: 'upload',
            progress: 0,
            speed: 0,
            status: 'requested'
          }
        }));
      } else {
        alert(`File request failed: ${res.error}`);
      }
    });
  }, []);

  const respondFile = useCallback((transferId: string, accepted: boolean) => {
    if (!socketRef.current) return;
    setIncomingFileRequest(null);
    socketRef.current.emit('respond-file', { transferId, accepted }, (res: any) => {
      if (!res.success) {
        alert(`Response submission failed: ${res.error}`);
      }
    });
  }, []);

  const controlTransfer = useCallback((transferId: string, command: 'pause' | 'resume' | 'cancel') => {
    if (!socketRef.current) return;
    socketRef.current.emit('control-transfer', { transferId, command });
  }, []);

  const updateSettings = useCallback((username: string, deviceNickname: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('update-settings', { username, deviceNickname }, (res: any) => {
      if (res.success) {
        setLocalInfo(prev => prev ? { ...prev, username, deviceNickname } : null);
      }
    });
  }, []);

  return {
    isConnected,
    localInfo,
    peers,
    chats,
    activePeerId,
    setActivePeerId,
    typingPeers,
    peerConnectionStates,
    incomingConnection,
    incomingFileRequest,
    transfers,
    transferHistory,
    
    // Actions
    connectPeer,
    respondConnection,
    sendChat,
    sendTyping,
    clearChat,
    sendFile,
    respondFile,
    controlTransfer,
    updateSettings
  };
}

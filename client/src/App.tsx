import React, { useState, useRef, useEffect } from 'react';
import {
  useSocket,
  Message
} from './hooks/useSocket';
import {
  Users,
  Send,
  FileUp,
  Settings,
  X,
  Shield,
  Activity,
  Check,
  CheckCheck,
  Download,
  Play,
  Pause,
  RefreshCw,
  Zap,
  Layers,
  Lock,
  TrendingUp,
  Clock,
  Database,
  Image,
  Video,
  Music,
  FileText
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

export default function App() {
  const {
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
  } = useSocket();

  const [messageText, setMessageText] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDeviceNickname, setNewDeviceNickname] = useState('');
  const [activeTab, setActiveTab] = useState<'chats' | 'history'>('chats');
  const [activePage, setActivePage] = useState<'dashboard' | 'faq' | 'about' | 'privacy'>('dashboard');
  const [showFeedback, setShowFeedback] = useState(false);

  // Feedback Form states
  const [feedbackCategory, setFeedbackCategory] = useState<'bug' | 'feature' | 'rate'>('bug');
  const [feedbackArea, setFeedbackArea] = useState('Select Area');
  const [feedbackSeverity, setFeedbackSeverity] = useState('Select Severity');
  const [feedbackDesc, setFeedbackDesc] = useState('');

  // Chart historical data points for Recharts
  const [chartData, setChartData] = useState<any[]>([]);

  // Web Audio Synthesizers for cute audio feedbacks
  const playChime = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = ctx.currentTime;
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.08, start);
        gain.gain.exponentialRampToValueAtTime(0.005, start + duration);
        osc.start(start);
        osc.stop(start + duration);
      };
      playTone(523.25, now, 0.12); // C5
      playTone(659.25, now + 0.08, 0.12); // E5
      playTone(783.99, now + 0.16, 0.22); // G5
    } catch (e) { }
  };

  const playBubblePop = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.12);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) { }
  };

  const [dismissedTransfers, setDismissedTransfers] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activePeer = activePeerId ? peers.get(activePeerId) : null;
  const activeConnectionState = activePeerId ? (peerConnectionStates[activePeerId] || 'none') : 'none';
  const activeChatMessages = activePeerId ? (chats[activePeerId] || []) : [];

  // Find the active transfer for the currently selected peer to feed the charts
  const activeTransfer = Object.values(transfers).find(
    t => t.peerId === activePeerId && t.status === 'transferring' && (t.cwnd !== undefined)
  );

  // Merge text messages and completed transfer events chronologically
  const chatHistoryTimeline = [
    ...activeChatMessages.map((m: any) => ({ ...m, timelineType: 'message' })),
    ...transferHistory
      .filter((t: any) => t.peerId === activePeerId && t.status === 'completed')
      .map((t: any) => ({
        id: t.id || t.transferId,
        senderId: t.direction === 'upload' ? (localInfo?.instanceId || 'self') : activePeerId,
        text: t.fileName,
        fileSize: t.fileSize,
        direction: t.direction,
        timestamp: t.timestamp || Date.now(),
        timelineType: 'file_transfer'
      }))
  ].sort((a, b) => a.timestamp - b.timestamp);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (activePeerId && activeConnectionState === 'connected') {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && activePeerId && activeConnectionState === 'connected') {
      const file = files[0];
      const buffer = await file.arrayBuffer();
      sendFile(activePeerId, file.name, buffer);
    }
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext || '')) {
      return <Image size={16} className="text-cyan-400" />;
    }
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', '3gp'].includes(ext || '')) {
      return <Video size={16} className="text-indigo-400" />;
    }
    if (['mp3', 'wav', 'aac', 'ogg', 'm4a', 'flac'].includes(ext || '')) {
      return <Music size={16} className="text-emerald-400" />;
    }
    return <FileText size={16} className="text-slate-400" />;
  };

  // Monitor typing debounce
  const typingTimeoutRef = useRef<any>(null);

  const dismissTransfer = (transferId: string) => {
    setDismissedTransfers(prev => ({
      ...prev,
      [transferId]: true
    }));
  };

  // Play cute chimes on incoming network notifications
  useEffect(() => {
    if (incomingConnection) {
      playChime();
    }
  }, [incomingConnection]);

  useEffect(() => {
    if (incomingFileRequest) {
      playChime();
    }
  }, [incomingFileRequest]);

  // Track finished transfers to play bubble pop sound
  const prevTransfersRef = useRef<any>({});

  // Automatically dismiss previous finished transfers only when a new active transfer starts
  useEffect(() => {
    // Check if any transfer just completed to trigger Pop sound
    Object.values(transfers).forEach((t: any) => {
      const prevT = prevTransfersRef.current[t.transferId];
      const statusLower = (t.status || '').toLowerCase();
      const prevStatusLower = prevT ? (prevT.status || '').toLowerCase() : '';

      const isCompleted = statusLower === 'completed' || (t.progress || 0) >= 1;
      const wasCompleted = prevStatusLower === 'completed' || (prevT?.progress || 0) >= 1;

      if (isCompleted && !wasCompleted) {
        playBubblePop();
      }
    });
    prevTransfersRef.current = transfers;

    const hasActiveTransfer = Object.values(transfers).some(t => {
      const statusLower = (t.status || '').toLowerCase();
      return statusLower !== 'completed' &&
        statusLower !== 'failed' &&
        !statusLower.includes('error') &&
        statusLower !== 'rejected' &&
        statusLower !== 'cancelled';
    });

    if (hasActiveTransfer) {
      const finishedIds = Object.values(transfers)
        .filter(t => {
          const statusLower = (t.status || '').toLowerCase();
          return statusLower === 'completed' ||
            statusLower === 'failed' ||
            statusLower.includes('error') ||
            statusLower === 'rejected' ||
            statusLower === 'cancelled';
        })
        .map(t => t.transferId);

      if (finishedIds.length > 0) {
        setDismissedTransfers(prev => {
          const next = { ...prev };
          let changed = false;
          finishedIds.forEach(id => {
            if (!next[id]) {
              next[id] = true;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
    }
  }, [transfers]);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChatMessages]);

  // Feed Recharts with real-time transfer telemetry
  useEffect(() => {
    if (activeTransfer) {
      setChartData(prev => {
        const next = [...prev, {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          cwnd: activeTransfer.cwnd || 0,
          ssthresh: activeTransfer.ssthresh || 0,
          rtt: activeTransfer.rtt || 0,
          speed: Number(((activeTransfer.speed || 0) / (1024 * 1024)).toFixed(2)), // in MB/s
          loss: (activeTransfer.lossRate || 0) * 100
        }];
        // Keep last 30 data points
        return next.slice(-30);
      });
    } else {
      setChartData([]);
    }
  }, [activeTransfer?.bytesAcked, activeTransfer?.bytesReceived]);

  // Init settings fields
  useEffect(() => {
    if (localInfo) {
      setNewUsername(localInfo.username);
      setNewDeviceNickname(localInfo.deviceNickname);
    }
  }, [localInfo]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !activePeerId) return;

    sendChat(activePeerId, messageText.trim());
    setMessageText('');

    // Clear typing indicator
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    sendTyping(activePeerId, false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageText(e.target.value);
    if (!activePeerId) return;

    sendTyping(activePeerId, true);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(activePeerId, false);
    }, 1500);
  };

  const handleFileAttach = (acceptType: string) => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = acceptType;
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activePeerId) return;

    const buffer = await file.arrayBuffer();
    sendFile(activePeerId, file.name, buffer);
  };

  const saveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings(newUsername, newDeviceNickname);
    setShowSettings(false);
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSec?: number) => {
    if (!bytesPerSec) return '0 B/s';
    const mb = bytesPerSec / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB/s`;
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackDesc.trim()) return;

    try {
      const port = localInfo?.port || '50000';
      const response = await fetch(`http://localhost:${port}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: feedbackCategory,
          affectedArea: feedbackArea,
          severity: feedbackSeverity,
          description: feedbackDesc
        })
      });
      const data = await response.json();
      if (data.success) {
        playBubblePop();
        alert(`Feedback submitted! Forwarded to officialrishav7@gmail.com`);
        setFeedbackDesc('');
        setFeedbackArea('Select Area');
        setFeedbackSeverity('Select Severity');
        setShowFeedback(false);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to submit feedback. Check server logs.');
    }
  };

  const renderFAQ = () => (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h2 className="text-xl font-bold uppercase tracking-wider font-mono text-white">Frequently Asked Questions</h2>
        <p className="text-xs text-slate-400 mt-1">Common solutions for local LAN device discovery and P2P transfers.</p>
      </div>

      <div className="space-y-4">
        <div className="p-5 bg-slate-900/40 border border-white/5 rounded-3xl">
          <h4 className="font-bold text-sm text-slate-200">Q: Why are other devices not showing on the radar?</h4>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Ensure both devices are connected to the exact same Wi-Fi router or local subnet loop. Some public or corporate Wi-Fi connections block broadcast packets (UDP Multicast/Broadcasting).
          </p>
        </div>

        <div className="p-5 bg-slate-900/40 border border-white/5 rounded-3xl">
          <h4 className="font-bold text-sm text-slate-200">Q: Is my connection private?</h4>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            Yes! SwiftPuff uses automatic Diffie-Hellman key exchanges to secure the channel before sending any payloads. All messaging and file streams are fully encrypted end-to-end.
          </p>
        </div>

        <div className="p-5 bg-slate-900/40 border border-white/5 rounded-3xl">
          <h4 className="font-bold text-sm text-slate-200">Q: How large of a file can I send?</h4>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            While SwiftPuff's custom UDP engine can theoretically handle huge files (up to 20 GB), browser/Electron windows are limited by JavaScript heap memory. To prevent crashes, files are currently capped at **2 GB**. We have set the server transfer packet buffer size limit to 2 GB so your 300 MB+ files will stream smoothly.
          </p>
        </div>
      </div>
    </div>
  );

  const renderAbout = () => (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h2 className="text-xl font-bold uppercase tracking-wider font-mono text-white">About SwiftPuff</h2>
        <p className="text-xs text-slate-400 mt-1">Learn more about the platform engineering behind this secure P2P utility.</p>
      </div>

      <div className="space-y-4 text-xs text-slate-400 leading-relaxed">
        <p>
          <strong>SwiftPuff</strong> was designed to replace heavy cloud-based transfer systems for local workspaces. When transferring files over the cloud, your data leaves your building, travels to an external server, and comes back down—wasting internet bandwidth and raising privacy concerns.
        </p>
        <p>
          By establishing direct peer-to-peer (P2P) UDP sockets, <strong>SwiftPuff</strong> streams payloads directly between computers on your local network at full gigabit hardware speeds.
        </p>

        <h3 className="text-sm font-bold text-slate-200 mt-6 mb-2">Technology Stack Highlights</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Electron Main World Core</strong>: Runs native low-level UDP socket listeners.</li>
          <li><strong>Dynamic Brotli/Gzip Compression</strong>: Compress payloads on the fly to save bandwidth.</li>
          <li><strong>UDP Rate Controller</strong>: Custom Congestion Control algorithm mimicking TCP BBR/Vegas dynamics.</li>
          <li><strong>Holographic React Frontend</strong>: Visual analytics mapping packet loss and throughput in real-time.</li>
        </ul>
      </div>
    </div>
  );

  const renderPrivacy = () => (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h2 className="text-xl font-bold uppercase tracking-wider font-mono text-white">Cryptographic Privacy Architecture</h2>
        <p className="text-xs text-slate-400 mt-1">End-to-end security specs protecting your LAN communications.</p>
      </div>

      <div className="space-y-4 text-xs text-slate-400 leading-relaxed">
        <div className="p-5 bg-slate-900/40 border border-white/5 rounded-3xl">
          <h4 className="font-bold text-sm text-slate-200 mb-2">1. Elliptic Curve Diffie-Hellman (ECDH) Handshake</h4>
          <p>
            When pairing devices, both peers perform a cryptographic handshake using ECDH (Curve25519) to securely agree upon a shared secret key without ever sending the key across the wire.
          </p>
        </div>

        <div className="p-5 bg-slate-900/40 border border-white/5 rounded-3xl">
          <h4 className="font-bold text-sm text-slate-200 mb-2">2. AES-256-GCM Symmetrical Encryption</h4>
          <p>
            Every single message packet and file segment is encrypted using 256-bit AES in Galois/Counter Mode (GCM). This guarantees both absolute confidentiality and integrity check validation.
          </p>
        </div>

        <div className="p-5 bg-slate-900/40 border border-white/5 rounded-3xl">
          <h4 className="font-bold text-sm text-slate-200 mb-2">3. Zero Third-Party Servers</h4>
          <p>
            Because the sockets connect directly between local machine IPs, your keys and files are never stored or processed by external hosting services. Data stays strictly inside your room.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden text-gray-100 relative bg-slate-950">

      {/* Top Navbar */}
      <header className="h-16 border-b border-white/5 glass shrink-0 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-accent to-accent-strong flex items-center justify-center text-bg-0 shadow-lg">
            <Shield size={18} className="text-slate-900" />
          </div>
          <span className="font-mono text-base font-extrabold uppercase tracking-widest bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            SwiftPuff
          </span>
          <div className="h-4 w-[1px] bg-white/10 mx-2" />
          <nav className="flex items-center gap-1">
            {['dashboard', 'faq', 'about', 'privacy'].map((page) => (
              <button
                key={page}
                onClick={() => setActivePage(page as any)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-300 relative ${activePage === page
                    ? 'text-accent'
                    : 'text-slate-400 hover:text-white'
                  }`}
              >
                {page}
                {activePage === page && (
                  <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-accent rounded-full animate-pulse-glow" />
                )}
              </button>
            ))}
          </nav>
        </div>

        <button
          onClick={() => setShowFeedback(true)}
          className="px-4 py-2 bg-white/5 hover:bg-accent/15 border border-white/5 hover:border-accent/30 text-xs font-semibold rounded-xl text-slate-300 hover:text-accent transition flex items-center gap-1.5"
        >
          <span>Feedback 💬</span>
        </button>
      </header>

      {/* Main Body panels */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* 1. Side Overlay Modals */}

        {/* Settings Modal */}
        {showSettings && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass w-full max-w-md rounded-3xl p-6 relative overflow-hidden pt-10">
              {/* macOS titlebar style */}
              <div className="absolute top-4 left-6 flex items-center gap-1.5 z-10">
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="w-3 h-3 rounded-full bg-[#ff5f56] hover:bg-[#ff5f56]/80 flex items-center justify-center text-[7px] text-rose-950 font-bold group"
                >
                  <span className="opacity-0 group-hover:opacity-100">×</span>
                </button>
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>
              <div className="flex items-center gap-3 mb-6 mt-4">
                <Settings className="text-accent" size={24} />
                <h2 className="text-xl font-bold">Preferences</h2>
              </div>

              <form onSubmit={saveSettings} className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-400 mb-2">Username</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-accent transition"
                    placeholder="Username"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-gray-400 mb-2">Device Nickname</label>
                  <input
                    type="text"
                    value={newDeviceNickname}
                    onChange={e => setNewDeviceNickname(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-accent transition"
                    placeholder="Device Name"
                    required
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full py-3 bg-gradient-to-r from-accent to-accent-strong text-bg-0 font-bold rounded-xl hover:shadow-lg transition transform active:scale-95"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Stacking Floating Toast Notification Center */}
        <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-4 max-w-sm w-full pointer-events-none">
          {/* Connection Handshake Notification */}
          {incomingConnection && (
            <div className="pointer-events-auto cyber-card p-6 rounded-2xl glow-cyan w-full relative overflow-hidden transition-all duration-300 border-t-2 border-t-accent animate-slide-in">
              {/* macOS titlebar style */}
              <div className="flex items-center gap-1.5 mb-4 border-b border-white/5 pb-2">
                <button
                  type="button"
                  onClick={() => respondConnection(incomingConnection.peerId, false)}
                  className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] hover:bg-[#ff5f56]/80 flex items-center justify-center text-[6px] text-rose-950 font-bold group"
                  title="Decline"
                >
                  <span className="opacity-0 group-hover:opacity-100">×</span>
                </button>
                <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
                <span className="text-[9px] font-mono text-slate-500 ml-auto uppercase tracking-wider">GATEWAY_CONN</span>
              </div>
              {/* Visual tech highlights */}
              <div className="absolute top-0 right-0 w-16 h-16 bg-accent/5 rounded-full blur-2xl pointer-events-none" />

              <div className="flex items-start gap-4">
                <div className="relative shrink-0">
                  <span className="absolute inset-0 rounded-xl bg-accent/30 animate-radar" />
                  <div className="relative p-3.5 bg-accent/10 border border-accent/25 rounded-xl text-accent">
                    <Shield size={20} />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-xs uppercase tracking-widest text-accent/80 font-mono">Pairing Request</h4>
                  <h3 className="font-bold text-base text-white mt-1 leading-tight truncate">{incomingConnection.username}</h3>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">{incomingConnection.deviceNickname}</p>

                  <p className="text-xs text-slate-300 mt-3 leading-relaxed">
                    wants to link devices and establish an encrypted transfer socket.
                  </p>

                  <div className="flex gap-2 mt-5">
                    <button
                      onClick={() => respondConnection(incomingConnection.peerId, true)}
                      className="flex-1 py-2.5 px-4 btn-premium-cyan font-bold text-xs rounded-xl shadow-lg transition transform active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      Accept Link
                    </button>
                    <button
                      onClick={() => respondConnection(incomingConnection.peerId, false)}
                      className="py-2.5 px-4 bg-white/5 border border-white/10 hover:border-rose-500/20 text-slate-400 hover:text-rose-400 font-bold text-xs rounded-xl hover:bg-rose-500/5 transition transform active:scale-95"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* File Permission Notification */}
          {incomingFileRequest && (
            <div className="pointer-events-auto cyber-card p-6 rounded-2xl glow-emerald w-full relative overflow-hidden transition-all duration-300 border-t-2 border-t-emerald-400 animate-slide-in">
              {/* macOS titlebar style */}
              <div className="flex items-center gap-1.5 mb-4 border-b border-white/5 pb-2">
                <button
                  type="button"
                  onClick={() => respondFile(incomingFileRequest.transferId, false)}
                  className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] hover:bg-[#ff5f56]/80 flex items-center justify-center text-[6px] text-rose-950 font-bold group"
                  title="Decline"
                >
                  <span className="opacity-0 group-hover:opacity-100">×</span>
                </button>
                <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
                <span className="text-[9px] font-mono text-slate-500 ml-auto uppercase tracking-wider">GATEWAY_PAYLOAD</span>
              </div>
              {/* Visual tech highlights */}
              <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />

              <div className="flex items-start gap-4">
                <div className="relative shrink-0">
                  <span className="absolute inset-0 rounded-xl bg-emerald-400/30 animate-radar" />
                  <div className="relative p-3.5 bg-emerald-400/10 border border-emerald-400/25 rounded-xl text-emerald-400">
                    <Download size={20} />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-xs uppercase tracking-widest text-emerald-400 font-mono">Incoming File</h4>

                  <div className="bg-slate-950/60 border border-white/5 rounded-xl p-3 my-3">
                    <p className="text-xs font-bold text-slate-200 break-all leading-snug">
                      {incomingFileRequest.fileName}
                    </p>
                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-white/5 text-[9px] font-mono text-slate-400">
                      <span>Size: <strong className="text-slate-300 font-sans">{formatSize(incomingFileRequest.fileSize)}</strong></span>
                      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold text-[8px]">
                        {incomingFileRequest.compressionType}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => respondFile(incomingFileRequest.transferId, true)}
                      className="flex-1 py-2.5 px-4 btn-premium-emerald font-bold text-xs rounded-xl shadow-lg transition transform active:scale-95"
                    >
                      Download File
                    </button>
                    <button
                      onClick={() => respondFile(incomingFileRequest.transferId, false)}
                      className="py-2.5 px-4 bg-white/5 border border-white/10 hover:border-rose-500/20 text-slate-400 hover:text-rose-400 font-bold text-xs rounded-xl hover:bg-rose-500/5 transition transform active:scale-95"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 2. Left Sidebar (Peers & Settings) */}
        <aside className="w-80 glass border-r border-white/5 flex flex-col h-full shrink-0">
          {/* macOS Titlebar controls */}
          <div className="flex items-center gap-1.5 px-4 pt-4 pb-2 shrink-0">
            <span className="w-3 h-3 rounded-full bg-[#ff5f56] opacity-80" />
            <span className="w-3 h-3 rounded-full bg-[#ffbd2e] opacity-80" />
            <span className="w-3 h-3 rounded-full bg-[#27c93f] opacity-80" />
          </div>
          {/* Header */}
          <div className="p-4 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-accent to-accent-strong flex items-center justify-center font-bold text-bg-0 text-lg">
                  {localInfo?.username ? localInfo.username[0].toUpperCase() : 'S'}
                </div>
                <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-bg-0 ${isConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              </div>
              <div>
                <h2 className="font-bold text-sm leading-tight">{localInfo?.username || 'Loading...'}</h2>
                <p className="text-[10px] text-gray-400 leading-tight mt-0.5">{localInfo?.deviceNickname || 'Scanning...'}</p>
              </div>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-xl transition"
            >
              <Settings size={18} />
            </button>
          </div>

          {/* Local Network Info Widget */}
          <div className="px-4 py-3 bg-white/2 border-b border-white/5 text-[11px] text-gray-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Activity size={12} className="text-accent" /> IP: <strong>{localInfo?.ip || '0.0.0.0'}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <Database size={12} className="text-accent-strong" /> Port: <strong>{localInfo?.port || 'pending'}</strong>
            </span>
          </div>

          {/* Tab Controls */}
          <div className="p-2 border-b border-white/5">
            <div className="flex bg-slate-950/40 p-1 rounded-xl border border-white/5 gap-0.5">
              <button
                onClick={() => setActiveTab('chats')}
                className={`flex-1 py-2 text-center text-[10px] font-semibold rounded-lg transition-all duration-300 ${activeTab === 'chats'
                    ? 'bg-accent/15 border border-accent/20 text-accent font-bold animate-pulse-slow'
                    : 'text-slate-400 hover:text-white'
                  }`}
              >
                Peers
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex-1 py-2 text-center text-[10px] font-semibold rounded-lg transition-all duration-300 ${activeTab === 'history'
                    ? 'bg-accent/15 border border-accent/20 text-accent font-bold animate-pulse-slow'
                    : 'text-slate-400 hover:text-white'
                  }`}
              >
                Logs
              </button>
            </div>
          </div>

          {/* Scrolled Lists */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'chats' && (
              <div className="p-2 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold px-2 py-1.5">Online LAN Users</div>
                {peers.size === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-gray-500 bg-white/2 rounded-2xl border border-dashed border-white/5">
                    <RefreshCw size={24} className="mx-auto mb-2 text-gray-600 animate-spin" />
                    <p>Searching network...</p>
                    <p className="text-[10px] text-gray-600 mt-1">Make sure other instances are online.</p>
                  </div>
                ) : (
                  Array.from(peers.values()).map(peer => {
                    const state = peerConnectionStates[peer.id] || 'none';
                    const isTyping = typingPeers[peer.id] || false;
                    const isSelected = activePeerId === peer.id;

                    return (
                      <button
                        key={peer.id}
                        onClick={() => setActivePeerId(peer.id)}
                        className={`w-full text-left p-3.5 rounded-2xl flex items-center justify-between transition-all duration-300 relative overflow-hidden border ${isSelected
                          ? 'bg-accent/10 border-accent/30 text-white shadow-[0_0_15px_rgba(71,212,255,0.15)]'
                          : 'hover:bg-white/5 border-transparent text-slate-300 hover:text-white'
                          }`}
                      >
                        {isSelected && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent" />
                        )}
                        <div className="flex items-center gap-3 truncate">
                          <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center font-semibold uppercase text-xs">
                            {peer.username.slice(0, 2)}
                          </div>
                          <div className="truncate">
                            <h4 className="font-semibold text-sm leading-tight text-white">{peer.username}</h4>
                            <p className="text-[11px] text-gray-400 mt-0.5 truncate">{peer.deviceNickname}</p>
                            {isTyping && (
                              <span className="text-[10px] text-accent font-semibold animate-pulse block mt-0.5">Typing...</span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm" />
                          {state === 'pending' && (
                            <span className="text-[9px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold">Pairing</span>
                          )}
                          {state === 'connected' && (
                            <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold">Ready</span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div className="p-3 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Transfer History</div>
                {transferHistory.length === 0 ? (
                  <div className="text-center py-8 text-xs text-gray-500">No transfers logged yet.</div>
                ) : (
                  transferHistory.map((t, idx) => (
                    <div key={idx} className="p-3 bg-white/3 rounded-xl border border-white/5 text-xs animate-slide-in">
                      <div className="flex justify-between font-semibold text-gray-200">
                        <span className="truncate max-w-[120px]">{t.fileName}</span>
                        <span className={t.direction === 'upload' ? 'text-blue-400' : 'text-emerald-400'}>
                          {t.direction === 'upload' ? '↑ Send' : '↓ Recv'}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                        <span>{formatSize(t.fileSize)}</span>
                        <span className={t.status === 'completed' ? 'text-emerald-500' : 'text-rose-500'}>
                          {t.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </aside>

        {/* 3. Center Section (Chat Room) */}
        <main
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="flex-1 flex flex-col h-full bg-bg-1/40 relative"
        >
          {isDragging && activeConnectionState === 'connected' && (
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md border-2 border-dashed border-accent/40 m-4 rounded-3xl z-40 flex flex-col items-center justify-center pointer-events-none animate-slide-in shadow-[0_0_50px_rgba(71,212,255,0.15)]">
              <div className="p-6 bg-accent/15 border border-accent/30 rounded-full text-accent mb-4 animate-bounce">
                <FileUp size={48} />
              </div>
              <h3 className="font-bold text-lg text-white font-mono uppercase tracking-widest">Drop Encrypted Payload</h3>
              <p className="text-xs text-accent/80 mt-1 font-mono">Files will be streamed securely to {activePeer?.username}</p>
            </div>
          )}

          {activePeer ? (
            <>
              {/* Peer Header */}
              <div className="p-4 border-b border-white/5 flex items-center justify-between glass">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center font-bold">
                    {activePeer.username[0].toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm leading-tight text-white">{activePeer.username}</h3>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{activePeer.deviceNickname} · {activePeer.ip}</p>
                  </div>
                </div>

                {activeConnectionState === 'connected' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => clearChat(activePeer.id)}
                      className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-xs text-gray-300 hover:text-white rounded-lg transition"
                    >
                      Clear Chat
                    </button>
                  </div>
                )}
              </div>

              {/* Chat View / Messaging Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeConnectionState !== 'connected' ? (
                  <div className="h-full flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto">
                    <div className="p-4 bg-accent/15 rounded-3xl text-accent mb-4 glow-blue">
                      <Lock size={36} />
                    </div>
                    <h3 className="font-bold text-md text-white">Secure Connection Required</h3>
                    <p className="text-xs text-gray-400 mt-2">
                      To start chatting and exchanging files, you must request a pairing handshake first.
                    </p>

                    {activeConnectionState === 'none' && (
                      <button
                        onClick={() => connectPeer(activePeer.id)}
                        className="mt-6 px-6 py-3 bg-gradient-to-r from-accent to-accent-strong text-bg-0 font-bold text-xs rounded-xl hover:shadow-lg transition transform active:scale-95 flex items-center gap-1.5"
                      >
                        <Zap size={14} /> Send Pairing Request
                      </button>
                    )}

                    {activeConnectionState === 'pending' && (
                      <div className="mt-6 px-6 py-3 bg-white/5 border border-white/10 text-gray-400 text-xs rounded-xl flex items-center gap-2">
                        <RefreshCw size={14} className="animate-spin text-accent" /> Waiting for peer approval...
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {chatHistoryTimeline.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-gray-500">
                        Encrypted connection established. Say hello!
                      </div>
                    ) : (
                      chatHistoryTimeline.map((item: any) => {
                        const isSelf = item.senderId === localInfo?.instanceId;

                        if (item.timelineType === 'file_transfer') {
                          return (
                            <div
                              key={item.id}
                              className={`flex ${isSelf ? 'justify-end' : 'justify-start'} my-2 animate-slide-in`}
                            >
                              <div className={`max-w-[75%] rounded-2xl p-4 text-xs shadow-lg border transition-all duration-300 relative overflow-hidden ${isSelf
                                ? 'bg-gradient-to-tr from-accent/15 to-accent-strong/5 border-accent/25 text-white rounded-tr-sm'
                                : 'bg-slate-900/60 border-emerald-500/20 text-slate-100 rounded-tl-sm'
                                }`}>
                                {/* macOS titlebar style for visual aesthetic */}
                                <div className="flex items-center gap-1.5 border-b border-white/5 pb-2 mb-2">
                                  <span className={`w-2 h-2 rounded-full ${isSelf ? 'bg-accent' : 'bg-emerald-400'}`} />
                                  <span className="w-2 h-2 rounded-full bg-white/10" />
                                  <span className="w-2 h-2 rounded-full bg-white/10" />
                                  <span className="text-[8px] font-mono text-slate-400 ml-auto uppercase tracking-wider">
                                    {isSelf ? 'Payload Sent' : 'Payload Received'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className={`p-2.5 rounded-xl border shrink-0 ${isSelf
                                    ? 'bg-accent/10 border-accent/25 text-accent'
                                    : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                                    }`}>
                                    {getFileIcon(item.text)}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-bold text-slate-100 break-all leading-snug">{item.text}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">{formatSize(item.fileSize)}</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={item.id}
                            className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}
                          >
                            <div className={`max-w-[70%] rounded-2xl px-4 py-3 text-xs shadow-md border transition-all duration-300 ${isSelf
                              ? 'bg-gradient-to-tr from-accent/15 to-accent-strong/5 border-accent/20 text-white rounded-tr-sm'
                              : 'bg-white/5 border-white/5 text-slate-100 rounded-tl-sm'
                              }`}>
                              <p className="break-all leading-relaxed">{item.text}</p>
                              <div className="flex items-center justify-end gap-1.5 mt-1.5 text-[9px] text-slate-400 leading-none">
                                <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                {isSelf && (
                                  <span>
                                    {item.status === 'seen' ? (
                                      <CheckCheck size={10} className="text-accent" />
                                    ) : (
                                      <Check size={10} />
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                    <div ref={chatEndRef} />
                  </>
                )}
              </div>

              {/* File Transfer Monitor Dashboard Area (Inline overlay in Chat for ongoing transfers) */}
              {Object.values(transfers).filter(t => t.peerId === activePeerId && !dismissedTransfers[t.transferId]).map(t => {
                const isUpload = t.direction === 'upload';
                const statusLower = (t.status || '').toLowerCase();
                const isCompleted = statusLower === 'completed' || (t.progress || 0) >= 1;
                const isFailed = statusLower === 'failed' || statusLower.includes('error') || statusLower.includes('fail');
                const isRejected = statusLower === 'rejected';
                const isCancelled = statusLower === 'cancelled';
                const isFinished = isCompleted || isFailed || isRejected || isCancelled;

                let statusText = 'Transferring payload...';
                if (t.status === 'requested') statusText = 'Initiating transfer...';
                else if (t.status === 'encrypting') statusText = 'Compressing & encrypting...';
                else if (isCompleted) statusText = 'Transfer completed successfully';
                else if (isFailed) statusText = `Transfer failed: ${t.status}`;
                else if (isRejected) statusText = 'Transfer declined by peer';
                else if (isCancelled) statusText = 'Transfer cancelled';

                return (
                  <div
                    key={t.transferId}
                    className={`p-4 bg-slate-900/60 backdrop-blur-md border-t border-white/5 flex flex-col gap-3 transition-all duration-300 relative overflow-hidden ${isCompleted
                      ? 'border-l-4 border-l-emerald-500 bg-emerald-500/5'
                      : isFailed || isRejected
                        ? 'border-l-4 border-l-rose-500 bg-rose-500/5'
                        : isCancelled
                          ? 'border-l-4 border-l-gray-500 bg-gray-500/5'
                          : 'border-l-4 border-l-accent'
                      }`}
                  >
                    {/* macOS titlebar style */}
                    <div className="flex items-center gap-1.5 border-b border-white/5 pb-2">
                      <button
                        type="button"
                        onClick={() => isFinished ? dismissTransfer(t.transferId) : controlTransfer(t.transferId, 'cancel')}
                        className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] hover:bg-[#ff5f56]/80 flex items-center justify-center text-[6px] text-rose-950 font-bold group"
                        title={isFinished ? "Dismiss" : "Cancel"}
                      >
                        <span className="opacity-0 group-hover:opacity-100">×</span>
                      </button>
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
                      <span className="text-[9px] font-mono text-slate-500 ml-auto uppercase tracking-wider">
                        {isUpload ? 'UPLOAD_STREAM' : 'DOWNLOAD_STREAM'}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-2.5 truncate">
                        {isCompleted ? (
                          <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] shrink-0 border border-emerald-500/30">
                            ✓
                          </div>
                        ) : isFailed || isRejected || isCancelled ? (
                          <div className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold text-[10px] shrink-0 border border-rose-500/30">
                            ✗
                          </div>
                        ) : isUpload ? (
                          <FileUp size={15} className="text-accent animate-pulse shrink-0" />
                        ) : (
                          <Download size={15} className="text-emerald-400 animate-pulse shrink-0" />
                        )}
                        <span className="font-semibold text-slate-200 truncate">{statusText}</span>
                      </div>
                      {!isFinished && (
                        <span className="text-[10px] bg-white/5 border border-white/5 px-2 py-0.5 rounded-md font-mono text-slate-300">
                          {formatSpeed(t.speed)}
                        </span>
                      )}
                    </div>

                    <div className="w-full bg-white/5 h-2.5 rounded-full overflow-hidden relative border border-white/5 shadow-inner">
                      <div
                        className={`h-full bg-gradient-to-r ${isFailed || isRejected
                          ? 'from-rose-500 to-red-500'
                          : isCancelled
                            ? 'from-gray-500 to-gray-600'
                            : isCompleted
                              ? 'from-emerald-500 to-teal-400'
                              : isUpload
                                ? 'from-blue-500 to-accent'
                                : 'from-emerald-500 to-teal-400'
                          } transition-all duration-300`}
                        style={{ width: `${isFinished ? 100 : (t.progress || 0) * 100}%` }}
                      />
                    </div>

                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-400 font-medium">
                        {isFinished
                          ? (isCompleted ? '100% complete' : 'Stopped')
                          : `${Math.round((t.progress || 0) * 100)}% complete`}
                      </span>
                      <div className="flex gap-2">
                        {!isFinished && (
                          <>
                            {t.status === 'transferring' ? (
                              <button
                                onClick={() => controlTransfer(t.transferId, 'pause')}
                                className="p-1.5 hover:text-white text-slate-400 bg-white/5 hover:bg-white/10 rounded-lg transition"
                                title="Pause"
                              >
                                <Pause size={12} />
                              </button>
                            ) : t.status === 'Paused' ? (
                              <button
                                onClick={() => controlTransfer(t.transferId, 'resume')}
                                className="p-1.5 hover:text-white text-slate-400 bg-white/5 hover:bg-white/10 rounded-lg transition"
                                title="Resume"
                              >
                                <Play size={12} />
                              </button>
                            ) : null}
                            <button
                              onClick={() => controlTransfer(t.transferId, 'cancel')}
                              className="p-1.5 hover:text-rose-400 text-slate-400 bg-white/5 hover:bg-white/10 rounded-lg transition"
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Input Bar */}
              {activeConnectionState === 'connected' && (
                <div className="p-4 border-t border-white/5 bg-slate-950/20 backdrop-blur-md">
                  <form onSubmit={handleSendMessage} className="flex gap-2 max-w-5xl mx-auto w-full items-center">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="*"
                      className="hidden"
                    />
                    <div className="flex bg-white/5 border border-white/5 rounded-xl p-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleFileAttach('image/*, .jpg, .jpeg, .png, .gif, .bmp, .webp, .svg, .heic, .heif, .psd, .ai, .tiff')}
                        className="p-2.5 text-slate-400 hover:text-accent hover:bg-white/5 rounded-lg transition"
                        title="Send Image"
                      >
                        <Image size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFileAttach('video/*, .mp4, .mkv, .avi, .mov, .flv, .webm, .m4v, .3gp')}
                        className="p-2.5 text-slate-400 hover:text-accent hover:bg-white/5 rounded-lg transition"
                        title="Send Video"
                      >
                        <Video size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFileAttach('audio/*, .mp3, .wav, .aac, .ogg, .m4a, .flac, .wma, .mid')}
                        className="p-2.5 text-slate-400 hover:text-accent hover:bg-white/5 rounded-lg transition"
                        title="Send Audio"
                      >
                        <Music size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFileAttach('*')}
                        className="p-2.5 text-slate-400 hover:text-accent hover:bg-white/5 rounded-lg transition"
                        title="Send Any File"
                      >
                        <FileText size={15} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={messageText}
                      onChange={handleInputChange}
                      placeholder="Type a secure message..."
                      className="flex-1 bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-xs focus:outline-none focus:border-accent/40 focus:bg-white/10 transition text-white placeholder-slate-500"
                    />
                    <button
                      type="submit"
                      className="p-3 btn-premium-cyan rounded-xl transition flex items-center justify-center shrink-0"
                    >
                      <Send size={15} />
                    </button>
                  </form>
                </div>
              )}
            </>
          ) : (
            <div className="h-full flex flex-col p-8 overflow-y-auto max-w-4xl mx-auto w-full justify-center">

              {/* Header branding */}
              <div className="flex flex-col items-center text-center mb-8">
                <div className="relative mb-4">
                  <div className="absolute inset-0 rounded-full bg-accent/20 blur-xl animate-pulse" />
                  <div className="w-16 h-16 rounded-2xl border border-accent/30 bg-accent/10 flex items-center justify-center text-accent relative z-10">
                    <Shield size={32} />
                  </div>
                </div>
                <h1 className="text-2xl font-black uppercase tracking-widest text-white">SwiftPuff Gateway</h1>
                <p className="text-xs text-slate-400 mt-1 max-w-md">Encrypted local LAN node file sharing system over high performance custom UDP engine.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center mt-2">

                {/* Left Column: Animated Radar scanner */}
                <div className="flex flex-col items-center justify-center p-6 bg-slate-900/40 rounded-3xl border border-white/5 relative overflow-hidden h-80 shadow-2xl">
                  {/* macOS titlebar style */}
                  <div className="absolute top-4 left-4 flex items-center gap-1.5 z-10">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
                  </div>
                  <div className="absolute top-3 right-4 text-[8px] font-mono text-accent/50 tracking-wider">RADAR_DISCOVERY</div>

                  <div className="relative w-52 h-52 rounded-full border border-accent/20 bg-slate-950/60 flex items-center justify-center overflow-hidden mt-4">
                    <div className="absolute top-0 left-0 w-1/2 h-1/2 border-r border-accent/30 animate-sweep animate-infinite" />

                    <div className="absolute w-40 h-40 rounded-full border border-accent/15" />
                    <div className="absolute w-28 h-28 rounded-full border border-accent/10" />
                    <div className="absolute w-16 h-16 rounded-full border border-accent/5" />

                    <div className="absolute w-full h-[1px] bg-white/5" />
                    <div className="absolute h-full w-[1px] bg-white/5" />

                    <div className="w-4 h-4 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
                    </div>

                    {Array.from(peers.values()).map((p, idx) => {
                      const angle = (idx * 115 * Math.PI) / 180;
                      const radius = 40 + (idx * 20) % 50;
                      const x = Math.cos(angle) * radius;
                      const y = Math.sin(angle) * radius;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setActivePeerId(p.id)}
                          style={{ transform: `translate(${x}px, ${y}px)` }}
                          className="absolute w-7 h-7 rounded-full bg-accent/15 border border-accent/30 text-[9px] font-mono font-bold text-accent flex items-center justify-center animate-pulse-glow hover:scale-125 transition cursor-pointer hover:border-accent hover:bg-accent/30 z-20 shadow-[0_0_10px_rgba(71,212,255,0.2)]"
                          title={`${p.username} (${p.deviceNickname})`}
                        >
                          {p.username.slice(0, 2).toUpperCase()}
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-[10px] text-slate-500 font-mono mt-4 animate-pulse">
                    {peers.size === 0 ? 'Scanning LAN broadcast loops...' : `Found ${peers.size} active nodes on subnets`}
                  </p>
                </div>
                {/* Stats summary widget */}
                <div className="flex flex-col gap-4">

                  {/* Local Passport Widget */}
                  <div className="p-5 bg-slate-900/40 rounded-3xl border border-white/5 relative overflow-hidden group shadow-xl">
                    <div className="absolute top-4 left-4 flex items-center gap-1.5 z-10">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] opacity-60" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] opacity-60" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] opacity-60" />
                    </div>
                    <div className="absolute top-3 right-4 text-[8px] font-mono text-accent/50 tracking-wider">PASSPORT_LOCAL</div>

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-accent to-accent-strong flex items-center justify-center font-bold text-bg-0 text-sm">
                          {localInfo?.username ? localInfo.username[0].toUpperCase() : 'S'}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm text-white leading-tight">{localInfo?.username || 'Scanning...'}</h4>
                          <p className="text-[10px] text-slate-400 font-mono mt-0.5">{localInfo?.deviceNickname || 'Initializing...'}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-[10px] font-mono text-slate-400">
                        <div>
                          IP: <strong className="text-slate-200">{localInfo?.ip || '0.0.0.0'}</strong>
                        </div>
                        <div>
                          PORT: <strong className="text-slate-200">{localInfo?.port || '50000'}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Puff Guide Center */}
                  <div className="p-5 bg-slate-900/40 border border-white/5 rounded-3xl shadow-xl space-y-3">
                    <div className="text-[9px] uppercase tracking-wider text-accent font-mono font-semibold">Illustrated Guide</div>
                    <div className="space-y-2 text-[10px] text-slate-400 leading-normal">
                      <div>
                        <strong className="text-slate-200 block mb-0.5">1. Local LAN Loop</strong>
                        Both devices must connect to the same Wi-Fi router / subnet.
                      </div>
                      <div>
                        <strong className="text-slate-200 block mb-0.5">2. Handshake Pairing</strong>
                        Click a node on the radar sweep to issue pairing clearance.
                      </div>
                      <div>
                        <strong className="text-slate-200 block mb-0.5">3. Drag & Drop Send</strong>
                        Drop files anywhere inside the active chat screen portal.
                      </div>
                    </div>
                  </div>

                </div>
              </div>

            </div>
          )}
        </main>

        {/* 4. Right Panel (Telemetry Analytics & Stats) */}
        <aside className="w-80 glass border-l border-white/5 flex flex-col h-full shrink-0 p-4 overflow-y-auto">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="text-accent" size={20} />
            <h2 className="text-sm font-bold uppercase tracking-wider">Live Analytics</h2>
          </div>

          {activeTransfer ? (
            <div className="space-y-6">
              {/* Speed & Compression Telemetry */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-3.5 bg-slate-900/40 rounded-2xl border border-white/5 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-accent" />
                  <div className="text-[9px] text-slate-400 uppercase tracking-widest font-mono">Speed</div>
                  <div className="text-sm font-bold text-white mt-1 flex items-center gap-1">
                    <Zap size={13} className="text-accent" /> {formatSpeed(activeTransfer.speed)}
                  </div>
                </div>
                <div className="p-3.5 bg-slate-900/40 rounded-2xl border border-white/5 relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-1 h-full bg-accent-strong" />
                  <div className="text-[9px] text-slate-400 uppercase tracking-widest font-mono">RTT</div>
                  <div className="text-sm font-bold text-white mt-1 flex items-center gap-1">
                    <Clock size={13} className="text-accent-strong" /> {activeTransfer.rtt ? `${activeTransfer.rtt} ms` : '0 ms'}
                  </div>
                </div>
              </div>

              {/* Compression Telemetry Widget */}
              {activeTransfer.compressedSize !== undefined && (
                <div className="p-4 bg-accent/5 border border-accent/15 rounded-2xl">
                  <div className="flex items-center gap-2 text-xs font-semibold text-accent mb-2">
                    <Layers size={14} /> Compression Layer
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-400">
                    <span>Original Size:</span>
                    <span className="font-medium text-gray-200">{formatSize(activeTransfer.originalSize)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                    <span>Compressed:</span>
                    <span className="font-medium text-gray-200">{formatSize(activeTransfer.compressedSize)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-400 mt-1 border-t border-white/5 pt-1.5 font-semibold">
                    <span className="text-accent">Savings Ratio:</span>
                    <span className="text-accent">{((activeTransfer.savings || 0) / (activeTransfer.originalSize || 1) * 100).toFixed(0)}% saved</span>
                  </div>
                </div>
              )}

              {/* Sliding Window Chart (RENO cwnd vs ssthresh) */}
              <div className="p-3 bg-white/2 rounded-2xl border border-white/5">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-2">Congestion Window Size (cwnd)</div>
                <div className="h-36 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={8} />
                      <YAxis stroke="rgba(255,255,255,0.3)" fontSize={8} />
                      <Tooltip contentStyle={{ background: '#0b1630', border: '1px solid rgba(255,255,255,0.1)', fontSize: 10 }} />
                      <Line type="monotone" dataKey="cwnd" stroke="#47d4ff" strokeWidth={2} dot={false} name="cwnd" />
                      <Line type="monotone" dataKey="ssthresh" stroke="#ffb8c2" strokeWidth={1} strokeDasharray="3 3" dot={false} name="ssthresh" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Throughput chart */}
              <div className="p-3 bg-white/2 rounded-2xl border border-white/5">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-2">Throughput Speed (MB/s)</div>
                <div className="h-36 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={8} />
                      <YAxis stroke="rgba(255,255,255,0.3)" fontSize={8} />
                      <Tooltip contentStyle={{ background: '#0b1630', border: '1px solid rgba(255,255,255,0.1)', fontSize: 10 }} />
                      <Line type="monotone" dataKey="speed" stroke="#10b981" strokeWidth={2} dot={false} name="MB/s" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Stats Telemetry Block */}
              <div className="space-y-1 bg-white/2 p-3 rounded-2xl border border-white/5 text-[11px] text-gray-400">
                <div className="flex justify-between">
                  <span>Retransmissions:</span>
                  <span className="font-semibold text-gray-200">{activeTransfer.retransmissions || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Packet Loss rate:</span>
                  <span className="font-semibold text-rose-400">{((activeTransfer.lossRate || 0) * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Dynamic RTO timeout:</span>
                  <span className="font-semibold text-gray-200">{activeTransfer.rto || 300} ms</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center text-center p-6 text-gray-500 bg-white/2 rounded-2xl border border-dashed border-white/5">
              <TrendingUp size={24} className="text-gray-600 mb-2" />
              <p className="text-xs">No active transfer detected</p>
              <p className="text-[10px] text-gray-600 mt-1">Start sending files over UDP to view live congestion graphs.</p>
            </div>
          )}
        </aside>
      </div>

      {/* Page Content Layout */}
      {activePage !== 'dashboard' && (
        <div className="absolute inset-0 top-16 bg-slate-950/90 backdrop-blur-md z-40 overflow-y-auto flex items-center justify-center p-8">
          <div className="w-full max-w-2xl bg-slate-900/60 border border-white/5 p-8 rounded-3xl shadow-2xl relative animate-slide-in">
            {/* macOS window controls style */}
            <div className="absolute top-6 left-6 flex items-center gap-1.5">
              <button
                onClick={() => setActivePage('dashboard')}
                className="w-3 h-3 rounded-full bg-[#ff5f56] hover:brightness-90 flex items-center justify-center text-[6px] text-rose-950 font-bold"
                title="Close"
              >
                ×
              </button>
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] opacity-60" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f] opacity-60" />
            </div>

            <div className="mt-4">
              {activePage === 'faq' && renderFAQ()}
              {activePage === 'about' && renderAbout()}
              {activePage === 'privacy' && renderPrivacy()}
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal Overlay */}
      {showFeedback && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in">
          <div className="cyber-card p-6 rounded-2xl glow-indigo w-full max-w-md relative overflow-hidden transition-all duration-300 border-t-2 border-t-indigo-400 animate-slide-in">
            {/* macOS titlebar style */}
            <div className="flex items-center gap-1.5 mb-4 border-b border-white/5 pb-2">
              <button
                type="button"
                onClick={() => setShowFeedback(false)}
                className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] hover:bg-[#ff5f56]/80 flex items-center justify-center text-[6px] text-rose-950 font-bold group"
              >
                <span className="opacity-0 group-hover:opacity-100">×</span>
              </button>
              <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] opacity-60" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f] opacity-60" />
              <span className="text-[9px] font-mono text-indigo-400 ml-auto uppercase tracking-wider">SHARE_FEEDBACK</span>
            </div>

            <h3 className="text-base font-bold text-white text-center mb-6">Share Feedback</h3>

            <form onSubmit={handleFeedbackSubmit} className="space-y-4 text-xs">
              <div>
                <label className="text-[9px] text-slate-400 uppercase tracking-widest font-mono font-semibold block mb-2">Feedback Category</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'bug', label: 'Bug ⚠️' },
                    { id: 'feature', label: 'Feature 💡' },
                    { id: 'rate', label: 'Rate ⭐' }
                  ].map(cat => (
                    <button
                      type="button"
                      key={cat.id}
                      onClick={() => setFeedbackCategory(cat.id as any)}
                      className={`py-2 px-3 rounded-lg font-bold text-center border transition-all ${feedbackCategory === cat.id
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                          : 'bg-white/5 border-white/5 text-slate-400 hover:text-white'
                        }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] text-slate-400 uppercase tracking-widest font-mono font-semibold block mb-1.5">What is affected?</label>
                  <select
                    value={feedbackArea}
                    onChange={(e) => setFeedbackArea(e.target.value)}
                    className="w-full bg-slate-950/60 border border-white/5 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-indigo-500/30 text-white"
                  >
                    <option value="Select Area">Select Area</option>
                    <option value="File Transfers">File Transfers</option>
                    <option value="Radar Discovery">Radar Discovery</option>
                    <option value="Sound FX">Sound FX</option>
                    <option value="Top Navigation">Top Navigation</option>
                    <option value="General UI">General UI</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-slate-400 uppercase tracking-widest font-mono font-semibold block mb-1.5">Severity</label>
                  <select
                    value={feedbackSeverity}
                    onChange={(e) => setFeedbackSeverity(e.target.value)}
                    className="w-full bg-slate-950/60 border border-white/5 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-indigo-500/30 text-white"
                  >
                    <option value="Select Severity">Select Severity</option>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High (Broken)">High (Broken)</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-[9px] text-slate-400 uppercase tracking-widest font-mono font-semibold">Describe the issue</label>
                  <span className="text-[9px] text-slate-500 font-mono">{feedbackDesc.length} / 1000</span>
                </div>
                <textarea
                  value={feedbackDesc}
                  onChange={(e) => setFeedbackDesc(e.target.value.slice(0, 1000))}
                  placeholder="Please tell us what went wrong..."
                  className="w-full h-24 bg-slate-950/60 border border-white/5 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:border-indigo-500/30 text-white resize-none"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFeedback(false)}
                  className="flex-1 py-3 bg-white/5 border border-white/5 hover:bg-white/10 text-slate-300 font-bold rounded-xl transition text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-gradient-to-r from-indigo-500 to-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20 hover:brightness-110 active:brightness-95 transition text-center"
                >
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

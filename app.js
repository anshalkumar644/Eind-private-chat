const { useState, useEffect, useRef } = React;

// --- Components ---

const Icon = ({ name, size = 24, className = "", onClick }) => {
    return <i onClick={onClick} className={`ph ph-${name} ${className}`} style={{ fontSize: size }}></i>;
};

const formatTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

// Video Player Component (Handles Audio/Video stream)
const VideoPlayer = ({ stream, isLocal }) => {
    const videoRef = useRef(null);
    useEffect(() => {
        const videoEl = videoRef.current;
        if (videoEl && stream) {
            videoEl.srcObject = stream;
            videoEl.muted = isLocal;
            if (!isLocal) {
                videoEl.volume = 1.0;
                videoEl.play().catch(e => console.log("Autoplay prevented", e));
            }
        }
    }, [stream, isLocal]);
    return (
        <video ref={videoRef} autoPlay playsInline 
            className={`w-full h-full ${isLocal ? 'object-cover' : 'object-contain'}`}
            style={{ transform: isLocal ? 'scaleX(-1)' : 'none' }}
        />
    );
};

// --- Custom Hook: usePeer ---
const usePeer = (onData, onConn, onIncomingCall, onError) => {
    const [myPeerId, setMyPeerId] = useState(null);
    const [peer, setPeer] = useState(null);
    const [status, setStatus] = useState("Initializing...");
    const connectionsRef = useRef({});
    const heartbeatRef = useRef(null);

    useEffect(() => {
        const randomId = "eind-" + Math.floor(Math.random() * 100000);
        const newPeer = new Peer(randomId, { 
            debug: 1,
            config: { iceServers: [{ url: 'stun:stun.l.google.com:19302' }, { url: 'stun:stun1.l.google.com:19302' }] }
        });

        newPeer.on('open', (id) => { setMyPeerId(id); setStatus("Online"); });
        newPeer.on('connection', (conn) => { setupConnection(conn); });
        newPeer.on('call', (call) => { if(onIncomingCall) onIncomingCall(call); });
        newPeer.on('error', (err) => { setStatus("Error"); if(onError) onError("Network Error"); });
        newPeer.on('disconnected', () => { setStatus("Reconnecting..."); newPeer.reconnect(); });

        setPeer(newPeer);

        heartbeatRef.current = setInterval(() => {
            Object.values(connectionsRef.current).forEach(conn => {
                if (conn && conn.open) conn.send({ type: 'heartbeat' });
            });
        }, 2000);

        return () => { newPeer.destroy(); clearInterval(heartbeatRef.current); };
    }, []);

    const setupConnection = (conn) => {
        conn.on('open', () => { connectionsRef.current[conn.peer] = conn; if(onConn) onConn(conn); });
        conn.on('data', (data) => { if (data.type !== 'heartbeat' && onData) onData(data, conn.peer); });
        conn.on('close', () => delete connectionsRef.current[conn.peer]);
        conn.on('error', () => delete connectionsRef.current[conn.peer]);
    };

    const connectTo = (remoteId) => {
        if (!peer) return;
        const conn = peer.connect(remoteId, { reliable: true, serialization: 'json' });
        setupConnection(conn);
    };

    const sendMessage = (connId, msg) => {
        const conn = connectionsRef.current[connId];
        if (conn && conn.open) { conn.send(msg); return true; }
        return false;
    };

    const callUser = (remoteId, stream) => {
        if(!peer) return null;
        return peer.call(remoteId, stream);
    };

    return { myPeerId, connectTo, sendMessage, callUser, status };
};

// --- Main App Component ---
const App = () => {
    const [activeChat, setActiveChat] = useState(null);
    const [showQR, setShowQR] = useState(false);
    const [notification, setNotification] = useState(null);
    
    const [incomingCall, setIncomingCall] = useState(null);
    const [activeCall, setActiveCall] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);

    const [chats, setChats] = useState([
        { id: 'bot', name: 'Eind Assistant', avatar: '🤖', lastMsg: 'Welcome to Eind!', time: '10:00', unread: 0, messages: [] }
    ]);

    const notify = (msg) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); };

    const handleIncomingData = (data, peerId) => {
        setChats(prev => {
            const existing = prev.find(c => c.id === peerId);
            let msgContent = data.type === 'text' ? data.text : (data.type === 'image' ? '📷 Photo' : '🎥 Video');
            const newMsg = { id: Date.now(), type: data.type || 'text', content: data.content || data.text, fileName: data.fileName, sender: 'them', time: formatTime(new Date()) };
            
            if (existing) {
                const others = prev.filter(c => c.id !== peerId);
                return [{ ...existing, messages: [...existing.messages, newMsg], lastMsg: msgContent, time: formatTime(new Date()), unread: existing.id === activeChat ? 0 : existing.unread + 1 }, ...others];
            } else {
                return [{ id: peerId, name: `User ${peerId.split('-')[1]}`, avatar: '👤', lastMsg: msgContent, time: formatTime(new Date()), unread: 1, isP2P: true, messages: [newMsg] }, ...prev];
            }
        });
    };

    const handleNewConn = (conn) => {
        notify(`Connected to ${conn.peer}`);
        setShowQR(false);
        setChats(prev => {
            if (prev.find(c => c.id === conn.peer)) return prev;
            return [{ id: conn.peer, name: `User ${conn.peer.split('-')[1]}`, avatar: '🔗', lastMsg: 'Connected via Eind', time: formatTime(new Date()), unread: 0, isP2P: true, messages: [] }, ...prev];
        });
    };

    const handleIncomingCall = (call) => { setIncomingCall(call); };

    const startCall = async (remoteId, type) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setLocalStream(stream);
            const call = peerControls.callUser(remoteId, stream);
            handleCallStream(call);
        } catch (err) { notify("Camera Error: " + err.message); }
    };

    const answerCall = async () => {
        if(!incomingCall) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setLocalStream(stream);
            incomingCall.answer(stream);
            handleCallStream(incomingCall);
            setIncomingCall(null);
        } catch (err) { notify("Error answering: " + err.message); }
    };

    const handleCallStream = (call) => {
        setActiveCall(call);
        call.on('stream', (remoteStream) => { setRemoteStream(remoteStream); });
        call.on('close', endCall);
        call.on('error', endCall);
    };

    const endCall = () => {
        if(activeCall) activeCall.close();
        if(localStream) localStream.getTracks().forEach(track => track.stop());
        setActiveCall(null); setIncomingCall(null); setLocalStream(null); setRemoteStream(null);
    };

    const peerControls = usePeer(handleIncomingData, handleNewConn, handleIncomingCall, notify);

    const handleSend = async (content, type = 'text', fileName = null) => {
        if (!activeChat) return;
        const payload = { type, content, fileName, text: type === 'text' ? content : null };
        const currentChat = chats.find(c => c.id === activeChat);
        
        if (currentChat.isP2P) {
            const sent = peerControls.sendMessage(activeChat, payload);
            if(!sent) { notify("Send failed (User Offline)"); return; }
        }

        const newMsg = { id: Date.now(), type, content, fileName, sender: 'me', time: formatTime(new Date()) };
        setChats(prev => prev.map(c => c.id === activeChat ? { ...c, messages: [...c.messages, newMsg], lastMsg: type === 'text' ? content : (type === 'image' ? '📷 Photo' : '🎥 Video'), time: formatTime(new Date()) } : c));

        // Bot Auto-Reply
        if (activeChat === 'bot') {
            setTimeout(() => {
                const botReplies = [
                    "Namaste! 🙏 I am Eind Assistant.",
                    "To chat with a friend, click the QR icon above!",
                    "I am made in India by Anshal! 🇮🇳",
                    "I can't make calls, but your P2P chats can!",
                    "Need help? Just scan a friend's code."
                ];
                const randomReply = botReplies[Math.floor(Math.random() * botReplies.length)];
                
                const botMsg = { 
                    id: Date.now() + 1, type: 'text', content: randomReply, sender: 'them', time: formatTime(new Date()) 
                };
                setChats(prev => prev.map(c => c.id === 'bot' ? { ...c, messages: [...c.messages, botMsg], lastMsg: randomReply, time: formatTime(new Date()) } : c));
            }, 1000);
        }
    };

    return (
        <div className="flex h-full w-full bg-app-dark overflow-hidden relative font-sans text-gray-100">
            {notification && <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-full shadow-lg z-50 border border-app-teal">{notification}</div>}

            {incomingCall && (
                <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4">
                    <div className="bg-app-panel p-8 rounded-2xl flex flex-col items-center shadow-2xl border border-gray-700 w-80">
                        <div className="w-24 h-24 bg-gray-700 rounded-full mb-6 flex items-center justify-center text-4xl animate-pulse">📞</div>
                        <h2 className="text-2xl mb-2 font-bold text-white">Eind Call</h2>
                        <p className="text-gray-400 mb-8">Incoming call...</p>
                        <div className="flex gap-8 w-full justify-center">
                            <button onClick={() => { incomingCall.close(); setIncomingCall(null); }} className="bg-red-500 hover:bg-red-600 p-4 rounded-full transition-all shadow-lg"><Icon name="phone-slash" size={32} weight="fill" /></button>
                            <button onClick={answerCall} className="bg-green-500 hover:bg-green-600 p-4 rounded-full transition-all shadow-lg animate-bounce"><Icon name="phone" size={32} weight="fill" /></button>
                        </div>
                    </div>
                </div>
            )}

            {activeCall && (
                <div className="fixed inset-0 bg-black z-[60] flex flex-col">
                    <div className="flex-1 relative bg-gray-900 flex items-center justify-center video-container">
                        {remoteStream ? <VideoPlayer stream={remoteStream} isLocal={false} /> : <div className="text-gray-500 animate-pulse">Connecting video...</div>}
                        <div className="absolute bottom-4 right-4 w-32 h-48 bg-gray-800 rounded-lg overflow-hidden border-2 border-gray-700 shadow-lg">
                            <VideoPlayer stream={localStream} isLocal={true} />
                        </div>
                    </div>
                    <div className="h-20 bg-gray-900 flex items-center justify-center">
                        <button onClick={endCall} className="bg-red-600 p-4 rounded-full hover:bg-red-700 shadow-lg"><Icon name="phone-slash" size={32} weight="fill" /></button>
                    </div>
                </div>
            )}

            <div className={`${activeChat ? 'hidden md:flex' : 'flex'} w-full md:w-[400px] flex-col border-r border-gray-700 bg-app-dark z-10`}>
                <div className="h-16 bg-app-panel flex items-center justify-between px-4 py-2 shrink-0">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => {navigator.clipboard.writeText(peerControls.myPeerId); notify("ID Copied");}}>
                        <div className="w-10 h-10 rounded-full bg-gray-500 overflow-hidden"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${peerControls.myPeerId}`} /></div>
                        <div className="flex flex-col">
                            <span className="font-bold text-sm text-gray-200">My Eind ID</span>
                            <div className="text-xs flex items-center text-gray-400">
                                <span className={`w-2 h-2 rounded-full mr-1 ${peerControls.status === 'Online' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                {peerControls.status}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-4 text-gray-400">
                        <button onClick={() => setShowQR(true)} className="text-app-teal hover:bg-gray-700 p-2 rounded-full"><Icon name="qr-code" size={24} /></button>
                    </div>
                </div>
                <div className="p-2 border-b border-gray-800">
                    <div className="bg-app-panel rounded-lg flex items-center px-4 py-1.5">
                        <Icon name="magnifying-glass" className="text-gray-500 mr-4" size={18} />
                        <input placeholder="Search Eind" className="bg-transparent border-none outline-none text-sm w-full text-gray-300 placeholder-gray-500" />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {chats.map(chat => (
                        <div key={chat.id} onClick={() => setActiveChat(chat.id)} className={`flex items-center p-3 cursor-pointer hover:bg-app-panel ${activeChat === chat.id ? 'bg-app-panel' : ''}`}>
                            <div className="w-12 h-12 rounded-full bg-gray-600 mr-3 flex items-center justify-center text-2xl relative">
                                {chat.avatar}
                            </div>
                            <div className="flex-1 border-b border-gray-800 pb-3">
                                <div className="flex justify-between mb-1"><span className="text-gray-100 font-medium">{chat.name}</span><span className="text-xs text-gray-500">{chat.time}</span></div>
                                <div className="flex justify-between"><span className="text-sm text-gray-400 truncate max-w-[200px]">{chat.lastMsg}</span>{chat.unread > 0 && <span className="bg-app-teal text-black text-xs font-bold px-1.5 py-0.5 rounded-full">{chat.unread}</span>}</div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="p-2 text-center text-xs text-gray-600 border-t border-gray-800">
                    Eind Web • Made with ❤️ in India 🇮🇳
                </div>
            </div>

            {activeChat ? (
                <ChatWindow chat={chats.find(c => c.id === activeChat)} onBack={() => setActiveChat(null)} onSend={handleSend} onCall={(type) => startCall(activeChat, type)} myId={peerControls.myPeerId} />
            ) : (
                <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-app-panel border-b-[6px] border-app-teal relative">
                    <div className="flex flex-col items-center z-10 p-8 text-center">
                        <h1 className="text-5xl font-light text-gray-200 mb-2 tracking-wide">Eind</h1>
                        <p className="text-gray-400 text-lg mb-8">Seamless P2P Communication</p>
                        
                        <div className="mt-8 bg-gray-800/50 p-6 rounded-xl border border-gray-700">
                            <p className="text-gray-400 text-sm mb-1">Created by</p>
                            <p className="text-xl font-bold text-white mb-4">Anshal</p>
                            <div className="flex items-center justify-center gap-2 text-gray-300 font-medium bg-gray-800 px-4 py-2 rounded-full border border-gray-600">
                                Made in India <span className="text-2xl">🇮🇳</span>
                            </div>
                        </div>

                        <p className="text-xs text-gray-500 mt-12 flex items-center gap-1">
                            <Icon name="lock-key" size={12}/> End-to-end encrypted
                        </p>
                    </div>
                    <div className="absolute inset-0 chat-bg opacity-10"></div>
                </div>
            )}

            {showQR && <QRModal myId={peerControls.myPeerId} onClose={() => setShowQR(false)} onScanSuccess={peerControls.connectTo} />}
        </div>
    );
};

const ChatWindow = ({ chat, onBack, onSend, onCall }) => {
    const [input, setInput] = useState("");
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), [chat.messages]);

    const handleFileSelect = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 1.5 * 1024 * 1024) { alert("File > 1.5MB. Too large for P2P."); return; }
        try {
            const base64 = await fileToBase64(file);
            const type = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : 'file');
            onSend(base64, type, file.name);
        } catch (err) { console.error("File error", err); }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-[#0b141a] relative">
            <div className="absolute inset-0 chat-bg"></div>
            <div className="h-16 bg-app-panel flex items-center px-4 py-2 shrink-0 z-10 border-l border-gray-700 shadow-md">
                <button onClick={onBack} className="md:hidden mr-2 text-gray-300"><Icon name="arrow-left" /></button>
                <div className="w-10 h-10 rounded-full bg-gray-600 mr-3 flex items-center justify-center text-xl">{chat.avatar}</div>
                <div className="flex-1"><h2 className="text-gray-100 font-medium">{chat.name}</h2></div>
                <div className="flex gap-6 text-app-teal">
                        {chat.isP2P && <button onClick={() => onCall('video')} className="hover:bg-gray-700 p-2 rounded-full transition"><Icon name="video-camera" size={24} weight="fill" /></button>}
                        {chat.isP2P && <button onClick={() => onCall('audio')} className="hover:bg-gray-700 p-2 rounded-full transition"><Icon name="phone" size={24} weight="fill" /></button>}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 z-10 flex flex-col gap-2">
                {chat.messages.map((msg) => (
                    <div key={msg.id} className={`max-w-[85%] flex flex-col ${msg.sender === 'me' ? 'self-end items-end' : 'self-start items-start'}`}>
                        <div className={`p-1 rounded-lg shadow-md relative ${msg.sender === 'me' ? 'bg-message-out rounded-tr-none' : 'bg-message-in rounded-tl-none'}`}>
                            {msg.type === 'text' && <p className="px-3 py-2 text-gray-100 text-sm pr-12">{msg.content}</p>}
                            {msg.type === 'image' && (<div className="rounded overflow-hidden relative"><img src={msg.content} className="max-w-[250px] max-h-[300px] object-cover" /><a href={msg.content} download={msg.fileName || "photo.jpg"} className="absolute bottom-2 right-2 bg-black/50 p-2 rounded-full text-white hover:bg-black/70"><Icon name="download-simple" size={16} /></a></div>)}
                            {msg.type === 'video' && (<div className="rounded overflow-hidden relative"><video controls src={msg.content} className="max-w-[250px] max-h-[300px]" /></div>)}
                            <div className={`text-[10px] text-right px-2 pb-1 ${msg.type === 'text' ? 'absolute bottom-1 right-2' : ''} text-gray-400`}>{msg.time}{msg.sender === 'me' && <Icon name="checks" className="ml-1 inline text-blue-300" size={12}/>}</div>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            <div className="min-h-[62px] bg-app-panel px-4 py-2 flex items-center gap-4 z-10">
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*,video/*" onChange={handleFileSelect} />
                <button onClick={() => fileInputRef.current.click()} className="text-gray-400 hover:text-gray-200"><Icon name="plus" size={28} /></button>
                <div className="flex-1 bg-[#2a3942] rounded-lg flex items-center px-4">
                    <input value={input} onChange={(e) => setInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && (onSend(input), setInput(""))} type="text" placeholder="Type a message" className="w-full bg-transparent text-gray-100 py-3 text-sm focus:outline-none placeholder-gray-500" />
                </div>
                {input ? <button onClick={() => { onSend(input); setInput(""); }} className="text-app-teal"><Icon name="paper-plane-right" size={28} weight="fill" /></button> : <Icon name="microphone" className="text-gray-400" size={28} />}
            </div>
        </div>
    );
};

const QRModal = ({ myId, onClose, onScanSuccess }) => {
    const [mode, setMode] = useState('generate');
    const [manual, setManual] = useState('');
    const qrRef = useRef(null);
    
    useEffect(() => {
        if(mode === 'generate' && myId && qrRef.current) {
            qrRef.current.innerHTML = '';
            new QRCode(qrRef.current, { text: myId, width: 200, height: 200, colorDark : "#111b21", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.L });
        }
    }, [mode, myId]);

    useEffect(() => {
        let scanner;
        if(mode === 'scan') {
            setTimeout(() => {
                scanner = new Html5Qrcode("reader");
                scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, 
                    (decoded) => { scanner.stop().then(() => onScanSuccess(decoded)).catch(()=>{}); }, 
                    () => {}).catch(err => console.log(err));
            }, 300);
        }
        return () => { if(scanner) try { scanner.stop().catch(()=>{}); } catch(e){} }
    }, [mode]);

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-md p-6 relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-black"><Icon name="x" size={24} /></button>
                <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-lg">
                    <button onClick={() => setMode('generate')} className={`flex-1 py-2 rounded-md text-sm font-medium ${mode === 'generate' ? 'bg-white shadow text-app-teal' : 'text-gray-500'}`}>My ID</button>
                    <button onClick={() => setMode('scan')} className={`flex-1 py-2 rounded-md text-sm font-medium ${mode === 'scan' ? 'bg-white shadow text-app-teal' : 'text-gray-500'}`}>Scan</button>
                </div>
                <div className="min-h-[300px] flex flex-col items-center justify-center">
                    {mode === 'generate' ? (
                        <>
                            <div ref={qrRef} className="p-2 border rounded"></div>
                            <code className="mt-4 bg-gray-100 p-2 rounded text-lg">{myId}</code>
                        </>
                    ) : (
                        <>
                            <div id="reader" className="w-full h-[250px] bg-black rounded mb-4"></div>
                            <div className="flex gap-2 w-full"><input value={manual} onChange={e=>setManual(e.target.value)} placeholder="Paste ID" className="flex-1 border p-2 rounded" /><button onClick={()=>onScanSuccess(manual)} className="bg-teal-600 text-white px-4 rounded">Connect</button></div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);


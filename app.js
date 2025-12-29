const { useState, useEffect, useRef } = React;

// --- Helper Components ---
const Icon = ({ name, size = 24, className = "", onClick }) => {
    return <i onClick={onClick} className={`ph ph-${name} ${className}`} style={{ fontSize: size }}></i>;
};

const formatTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const fileToBase64 = (file) => new Promise((resolve) => { 
    const r = new FileReader(); 
    r.onload = () => resolve(r.result); 
    r.readAsDataURL(file); 
});

const solveMath = (expr) => {
    try {
        const sanitized = expr.replace(/[^0-9+\-*/().\s^%]/g, '');
        if (!sanitized || !/[0-9]/.test(sanitized)) return null;
        // eslint-disable-next-line no-new-func
        return Function('"use strict";return (' + sanitized + ')')();
    } catch (e) { return null; }
};

const VideoPlayer = ({ stream, isLocal }) => {
    const videoRef = useRef(null);
    useEffect(() => {
        const el = videoRef.current;
        if (el && stream) {
            el.srcObject = stream;
            el.muted = isLocal;
            if (!isLocal) { el.volume = 1.0; el.play().catch(e => console.log(e)); }
        }
    }, [stream, isLocal]);
    return <video ref={videoRef} autoPlay playsInline className={`w-full h-full ${isLocal?'object-cover':'object-contain'}`} style={{ transform: isLocal?'scaleX(-1)':'' }} />;
};

// --- P2P Hook ---
const usePeer = (onData, onConn, onCall, onError) => {
    const [myPeerId, setMyPeerId] = useState(null);
    const [status, setStatus] = useState("Init...");
    const peerRef = useRef(null);
    const connRef = useRef({});
    const beatRef = useRef(null);

    useEffect(() => {
        const id = "eind-" + Math.floor(Math.random()*100000);
        const p = new Peer(id, { debug: 1, config: { iceServers: [{ url: 'stun:stun.l.google.com:19302' }] } });
        p.on('open', (id) => { setMyPeerId(id); setStatus("Online"); });
        p.on('connection', (c) => setupConn(c));
        p.on('call', (c) => onCall && onCall(c));
        p.on('error', (e) => { setStatus("Error"); if(onError) onError(e.type); });
        p.on('disconnected', () => { setStatus("Reconnecting..."); p.reconnect(); });
        peerRef.current = p;
        beatRef.current = setInterval(() => Object.values(connRef.current).forEach(c => c.open && c.send({type:'ping'})), 2000);
        return () => { p.destroy(); clearInterval(beatRef.current); };
    }, []);

    const setupConn = (c) => {
        c.on('open', () => { connRef.current[c.peer] = c; if(onConn) onConn(c); });
        c.on('data', (d) => { if(d.type!=='ping' && onData) onData(d, c.peer); });
        c.on('close', () => delete connRef.current[c.peer]);
        c.on('error', () => delete connRef.current[c.peer]);
    };

    const connect = (id) => { if(peerRef.current) setupConn(peerRef.current.connect(id, {reliable:true})); };
    const send = (id, msg) => { const c = connRef.current[id]; if(c?.open) { c.send(msg); return true; } return false; };
    const call = (id, s) => peerRef.current?.call(id, s);

    return { myPeerId, connect, send, call, status };
};

// --- Main App ---
const App = () => {
    const [activeChat, setActiveChat] = useState(null);
    const [showQR, setShowQR] = useState(false);
    const [notification, setNotification] = useState(null);
    
    // Call States
    const [incomingCall, setIncomingCall] = useState(null);
    const [activeCall, setActiveCall] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);

    const [chats, setChats] = useState([
        { id: 'bot', name: 'Eind Assistant', avatar: '🤖', lastMsg: 'I can help with math or info.', time: 'Now', unread: 0, messages: [] }
    ]);

    const notify = (m) => { setNotification(m); setTimeout(() => setNotification(null), 3000); };
    
    const onData = (d, id) => {
        setChats(prev => {
            const ex = prev.find(c => c.id === id);
            const msg = { id: Date.now(), type: d.type||'text', content: d.content||d.text, sender: 'them', time: formatTime(new Date()) };
            if(ex) return [{...ex, messages:[...ex.messages, msg], lastMsg: d.type==='text'?d.text:'Media', time:formatTime(new Date()), unread: activeChat===id?0:ex.unread+1}, ...prev.filter(c=>c.id!==id)];
            return [{id, name:`User ${id.split('-')[1]}`, avatar:'👤', lastMsg: d.type==='text'?d.text:'Media', time:formatTime(new Date()), unread:1, isP2P:true, messages:[msg]}, ...prev];
        });
    };

    const onConn = (c) => {
        notify(`Connected: ${c.peer}`);
        setShowQR(false);
        setChats(prev => prev.find(ch=>ch.id===c.peer) ? prev : [{id:c.peer, name:`User ${c.peer.split('-')[1]}`, avatar:'🔗', lastMsg:'Connected', time:formatTime(new Date()), unread:0, isP2P:true, messages:[]}, ...prev]);
    };

    const onIncomingCall = (c) => setIncomingCall(c);
    const answerCall = async () => {
        if(!incomingCall) return;
        try {
            const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
            setLocalStream(s);
            incomingCall.answer(s);
            setupCall(incomingCall);
            setIncomingCall(null);
        } catch(e) { notify("Mic/Cam Error"); }
    };
    const startCall = async (id, type) => {
        try {
            const s = await navigator.mediaDevices.getUserMedia({video:type==='video', audio:true});
            setLocalStream(s);
            setupCall(peerControls.call(id, s));
        } catch(e) { notify("Mic/Cam Error"); }
    };
    const setupCall = (c) => {
        setActiveCall(c);
        c.on('stream', (s) => setRemoteStream(s));
        c.on('close', endCall);
        c.on('error', endCall);
    };
    const endCall = () => {
        activeCall?.close();
        localStream?.getTracks().forEach(t => t.stop());
        setActiveCall(null); setIncomingCall(null); setLocalStream(null); setRemoteStream(null);
    };

    const peerControls = usePeer(onData, onConn, onIncomingCall, notify);

    const handleSend = async (txt, type='text', file=null) => {
        if(!activeChat) return;
        const newMsg = { id: Date.now(), type, content: txt, fileName: file, sender: 'me', time: formatTime(new Date()) };
        setChats(prev => prev.map(c => c.id === activeChat ? {...c, messages:[...c.messages, newMsg], lastMsg: type==='text'?txt:'Media', time: formatTime(new Date())} : c));

        const chat = chats.find(c => c.id === activeChat);
        if(chat.isP2P) {
            if(!peerControls.send(activeChat, {type, content:txt, fileName:file, text:txt})) notify("Offline");
            return;
        }

        if(activeChat === 'bot' && type === 'text') {
            const typingMsgId = Date.now() + 1;
            setChats(prev => prev.map(c => c.id==='bot' ? {...c, messages:[...c.messages, {id:typingMsgId, type:'text', content:'...', sender:'them', time:''}]} : c));
            setTimeout(() => {
                let response = "";
                const lower = txt.toLowerCase();
                const mathResult = solveMath(txt);
                if (mathResult !== null) response = `Answer: ${mathResult}`;
                else if (lower.includes('who') || lower.includes('about')) response = "I am Eind Assistant, created by Anshal.";
                else if (lower.includes('hi') || lower.includes('hello')) response = "Namaste! 🙏";
                else response = "I can solve math (e.g., '5 * 5') or tell you about myself.";

                setChats(prev => prev.map(c => {
                    if(c.id === 'bot') {
                        const msgs = c.messages.filter(m => m.id !== typingMsgId);
                        return {...c, messages:[...msgs, {id: Date.now(), type:'text', content: response, sender:'them', time: formatTime(new Date())}], lastMsg: response};
                    }
                    return c;
                }));
            }, 600);
        }
    };

    return (
        <div className="flex h-full w-full bg-app-dark overflow-hidden font-sans text-gray-100 relative">
            {notification && <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-gray-800 px-4 py-2 rounded-full border border-app-teal z-50 shadow-lg whitespace-nowrap">{notification}</div>}
            
            {/* Call Overlay */}
            {incomingCall && <div className="fixed inset-0 bg-black/90 z-[70] flex items-center justify-center p-4"><div className="bg-app-panel p-6 rounded-2xl flex flex-col items-center w-full max-w-sm"><div className="text-4xl animate-bounce mb-4">📞</div><h2 className="text-xl mb-4 text-center">Incoming Call...</h2><div className="flex gap-8"><button onClick={()=>setIncomingCall(null)} className="bg-red-500 p-4 rounded-full"><Icon name="phone-slash" size={32} weight="fill"/></button><button onClick={answerCall} className="bg-green-500 p-4 rounded-full"><Icon name="phone" size={32} weight="fill"/></button></div></div></div>}
            {activeCall && <div className="fixed inset-0 bg-black z-[70] flex flex-col"><div className="flex-1 relative flex items-center justify-center">{remoteStream?<VideoPlayer stream={remoteStream} isLocal={false}/>:<div className="animate-pulse">Connecting...</div>}<div className="absolute bottom-4 right-4 w-28 h-40 bg-gray-800 rounded border border-gray-600"><VideoPlayer stream={localStream} isLocal={true}/></div></div><div className="h-20 flex items-center justify-center bg-gray-900 pb-safe"><button onClick={endCall} className="bg-red-600 p-4 rounded-full"><Icon name="phone-slash" size={32} weight="fill"/></button></div></div>}

            {/* Sidebar */}
            <div className={`${activeChat?'hidden md:flex':'flex'} w-full md:w-[400px] flex-col border-r border-gray-700 bg-app-dark h-full z-10`}>
                <div className="h-16 bg-app-panel flex items-center justify-between px-4 shrink-0"><div className="flex items-center gap-2 cursor-pointer" onClick={()=>{navigator.clipboard.writeText(peerControls.myPeerId); notify("ID Copied")}}><div className="w-10 h-10 rounded-full bg-gray-600 overflow-hidden"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${peerControls.myPeerId}`}/></div><div className="overflow-hidden"><p className="text-sm font-bold truncate">My Eind ID</p><p className={`text-xs truncate ${peerControls.status==='Online'?'text-green-400':'text-red-400'}`}>{peerControls.status}</p></div></div><button onClick={()=>setShowQR(true)} className="text-app-teal"><Icon name="qr-code" size={24}/></button></div>
                <div className="flex-1 overflow-y-auto">{chats.map(c=><div key={c.id} onClick={()=>setActiveChat(c.id)} className={`flex items-center p-3 cursor-pointer hover:bg-app-panel ${activeChat===c.id?'bg-app-panel':''}`}><div className="w-12 h-12 rounded-full bg-gray-600 mr-3 flex items-center justify-center text-2xl shrink-0">{c.avatar}</div><div className="flex-1 border-b border-gray-800 pb-3 min-w-0"><div className="flex justify-between"><span className="font-bold truncate">{c.name}</span><span className="text-xs text-gray-500 shrink-0 ml-2">{c.time}</span></div><div className="flex justify-between"><span className="text-sm text-gray-400 truncate">{c.lastMsg}</span>{c.unread>0&&<span className="bg-app-teal text-black text-xs font-bold px-2 rounded-full ml-2">{c.unread}</span>}</div></div></div>)}</div>
                <div className="p-2 text-center text-xs text-gray-600 border-t border-gray-800 shrink-0 pb-safe">Eind Web • Made in India 🇮🇳</div>
            </div>

            {/* Chat Area - Fixed Layout */}
            {activeChat ? <ChatWindow chat={chats.find(c=>c.id===activeChat)} onBack={()=>setActiveChat(null)} onSend={handleSend} onCall={startCall} /> : 
            <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-app-panel border-b-4 border-app-teal relative h-full"><div className="z-10 text-center p-4"><h1 className="text-6xl font-light mb-2">Eind</h1><p className="text-gray-400 text-xl">P2P Communication</p><div className="mt-8 bg-gray-800/60 p-6 rounded-xl border border-gray-700"><p className="text-sm text-gray-400">Created by <span className="text-white font-bold text-lg">Anshal</span></p><div className="mt-2 inline-block bg-gray-900 px-3 py-1 rounded-full border border-gray-600 text-gray-300">Made in India 🇮🇳</div></div></div><div className="absolute inset-0 chat-bg"></div></div>}

            {showQR && <QRModal id={peerControls.myPeerId} onClose={()=>setShowQR(false)} onScan={peerControls.connect} />}
        </div>
    );
};

const ChatWindow = ({ chat, onBack, onSend, onCall }) => {
    const [txt, setTxt] = useState("");
    const endRef = useRef(null);
    const fileRef = useRef(null);
    
    // Auto scroll
    useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [chat.messages]);

    const sendFile = async (e) => {
        const f = e.target.files[0];
        if(!f || f.size > 1.5*1024*1024) { alert("File > 1.5MB"); return; }
        const b64 = await fileToBase64(f);
        onSend(b64, f.type.startsWith('image')?'image':f.type.startsWith('video')?'video':'file', f.name);
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-[#0b141a] relative w-full overflow-hidden">
            <div className="absolute inset-0 chat-bg"></div>
            
            {/* Header: shrink-0 ensures it never hides */}
            <div className="h-16 bg-app-panel flex items-center px-4 shrink-0 z-20 border-l border-gray-700 shadow w-full">
                <button onClick={onBack} className="md:hidden mr-2 p-2"><Icon name="arrow-left"/></button>
                <div className="w-10 h-10 rounded-full bg-gray-600 mr-3 flex items-center justify-center text-xl shrink-0">{chat.avatar}</div>
                <div className="flex-1 min-w-0"><h2 className="font-bold truncate">{chat.name}</h2></div>
                <div className="flex gap-3 text-app-teal shrink-0">
                    {chat.isP2P && <><button onClick={()=>onCall(chat.id,'video')} className="p-2"><Icon name="video-camera" size={24} weight="fill"/></button><button onClick={()=>onCall(chat.id,'audio')} className="p-2"><Icon name="phone" size={24} weight="fill"/></button></>}
                </div>
            </div>

            {/* Messages: flex-1 allows taking remaining space, overflow-y-auto enables scrolling ONLY here */}
            <div className="flex-1 overflow-y-auto p-4 z-10 flex flex-col gap-2 w-full custom-scrollbar">
                {chat.messages.map(m => (
                    <div key={m.id} className={`max-w-[85%] ${m.sender==='me'?'self-end':'self-start'}`}>
                        <div className={`p-2 rounded-lg shadow relative ${m.sender==='me'?'bg-message-out rounded-tr-none':'bg-message-in rounded-tl-none'}`}>
                            {m.type==='text' && <p className="text-sm pr-12 whitespace-pre-wrap leading-relaxed">{m.content}</p>}
                            {m.type==='image' && <div className="relative"><img src={m.content} className="max-w-[250px] rounded"/><a href={m.content} download={m.fileName} className="absolute bottom-1 right-1 bg-black/50 p-1 rounded text-white"><Icon name="download-simple"/></a></div>}
                            {m.type==='video' && <video src={m.content} controls className="max-w-[250px] rounded"/>}
                            <span className="text-[10px] text-gray-400 absolute bottom-1 right-2 flex items-center gap-1">{m.time}{m.sender==='me'&&<Icon name="checks" className="text-blue-300" size={12}/>}</span>
                        </div>
                    </div>
                ))}
                <div ref={endRef} />
            </div>

            {/* Input: shrink-0 keeps it at bottom */}
            <div className="min-h-[60px] bg-app-panel px-4 py-2 flex items-center gap-3 z-20 shrink-0 w-full pb-safe">
                <input type="file" ref={fileRef} className="hidden" onChange={sendFile} accept="image/*,video/*"/>
                <button onClick={()=>fileRef.current.click()} className="text-gray-400 p-1"><Icon name="plus" size={24}/></button>
                <div className="flex-1 bg-[#2a3942] rounded-lg px-4 py-2"><input value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(onSend(txt),setTxt(''))} placeholder="Type a message..." className="w-full bg-transparent outline-none text-sm"/></div>
                {txt ? <button onClick={()=>{onSend(txt);setTxt('')}} className="text-app-teal p-1"><Icon name="paper-plane-right" size={24} weight="fill"/></button> : <Icon name="microphone" className="text-gray-400 p-1" size={24}/>}
            </div>
        </div>
    );
};

const QRModal = ({ id, onClose, onScan }) => {
    const [tab, setTab] = useState(0);
    const [val, setVal] = useState('');
    const ref = useRef(null);
    useEffect(() => { if(tab===0 && ref.current) { ref.current.innerHTML=''; new QRCode(ref.current, {text:id, width:180, height:180, colorDark:"#111b21", colorLight:"#fff"}); } }, [tab, id]);
    useEffect(() => { if(tab===1) { const s = new Html5Qrcode("reader"); s.start({facingMode:"environment"}, {fps:10, qrbox:250}, (t)=>{s.stop(); onScan(t);}, ()=>{}).catch(()=>{}); return ()=>s.isScanning&&s.stop(); } }, [tab]);

    return (
        <div className="fixed inset-0 bg-black/80 z-[80] flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-sm p-5 relative text-gray-800">
                <button onClick={onClose} className="absolute top-3 right-3"><Icon name="x" size={24}/></button>
                <div className="flex bg-gray-100 p-1 rounded-lg mb-4"><button onClick={()=>setTab(0)} className={`flex-1 py-1 rounded ${tab===0?'bg-white shadow text-teal-600':''}`}>My ID</button><button onClick={()=>setTab(1)} className={`flex-1 py-1 rounded ${tab===1?'bg-white shadow text-teal-600':''}`}>Scan</button></div>
                <div className="h-[250px] flex flex-col items-center justify-center">
                    {tab===0 ? <><div ref={ref} className="border p-2 rounded"></div><div className="mt-2 bg-gray-100 px-2 py-1 rounded font-mono text-sm">{id}</div></> : 
                    <><div id="reader" className="w-full h-full bg-black rounded overflow-hidden mb-2"></div><div className="flex w-full gap-2"><input value={val} onChange={e=>setVal(e.target.value)} placeholder="Paste ID" className="flex-1 border p-1 rounded"/><button onClick={()=>onScan(val)} className="bg-teal-600 text-white px-3 rounded">Go</button></div></>}
                </div>
            </div>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);

import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Activity, CheckCheck } from 'lucide-react';
import { auth } from '../lib/firebase';
import { buildApiUrl, generateRequestId } from '../lib/apiClient';

export default function PortfolioDoctorChat({ isOpen, onClose }) {
    const [messages, setMessages] = useState([
        {
            id: 'init',
            role: 'model',
            text: "Hello! I'm Consensus, your Chief Portfolio Doctor. Before we dive into your holdings, I need to understand your financial profile. Could you tell me your age to get started?",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [toastMsg, setToastMsg] = useState('');
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    // Auto-scroll to bottom of chat
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    // Focus input on open
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleSend = async (e, directMessage = null) => {
        if (e) e.preventDefault();
        const messageToSubmit = directMessage || input;
        if (!messageToSubmit.trim() || isTyping) return;

        const userText = messageToSubmit.trim();
        if (!directMessage) setInput('');

        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const newUserMsg = {
            id: Date.now().toString(),
            role: 'user',
            text: userText,
            timestamp: now
        };

        const newMessages = [...messages, newUserMsg];
        setMessages(newMessages);
        setIsTyping(true);

        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");
            const token = await user.getIdToken();

            // Format for Gemini API
            const formattedHistory = newMessages.map(m => ({
                role: m.role,
                parts: [m.text]
            }));

            const response = await fetch(buildApiUrl('/api/portfolio-doctor/chat'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Request-ID': generateRequestId(),
                    Accept: 'text/event-stream',
                },
                body: JSON.stringify({ messages: formattedHistory }),
                cache: 'no-store',
            });

            if (!response.ok) throw new Error("Network response was not ok");

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            const botMsgId = (Date.now() + 1).toString();
            setMessages(prev => [...prev, {
                id: botMsgId,
                role: 'model',
                text: '',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }]);

            let buffer = '';
            let isDone = false;

            while (!isDone) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop(); // Keep incomplete chunk in buffer

                for (const part of parts) {
                    if (part.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(part.substring(6));
                            if (data.type === 'text') {
                                setMessages(prev => prev.map(msg =>
                                    msg.id === botMsgId ? { ...msg, text: msg.text + data.text } : msg
                                ));
                            } else if (data.type === 'tool_call') {
                                showToast(data.message);
                            } else if (data.type === 'done') {
                                isDone = true;
                            } else if (data.type === 'error') {
                                console.error("Agent Stream Error:", data.message);
                                setMessages(prev => [...prev, {
                                    id: Date.now().toString(),
                                    role: 'model',
                                    text: "Sorry, I encountered an internal error analyzing that. Could we try again?",
                                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                }]);
                                isDone = true;
                            }
                        } catch (err) {
                            console.error("Parse error:", err, "Raw part:", part);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Chat error:", error);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'model',
                text: "Connection error. Please check your network and try again.",
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }]);
        } finally {
            setIsTyping(false);
        }
    };

    const showToast = (msg) => {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(''), 4000);
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.95, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.95, y: 20 }}
                    onClick={e => e.stopPropagation()}
                    className="bg-black w-full h-[100dvh] sm:h-[85vh] sm:max-h-[800px] sm:max-w-2xl rounded-none sm:rounded-3xl overflow-hidden shadow-2xl border-0 sm:border border-[#202C33] flex flex-col relative font-sans"
                >
                    {/* Header */}
                    <div className="bg-[#111114] border-b border-white/10 px-4 sm:px-6 py-4 flex items-center justify-between shrink-0 pt-safe">
                        <div className="flex items-center gap-3">
                            <div className="relative w-10 h-10 rounded-full overflow-hidden border border-white/10 shrink-0">
                                <Image src="/avatars/The CIO Agent.svg" alt="Portfolio Doctor" fill sizes="40px" className="object-cover" />
                            </div>
                            <div>
                                <h3 className="text-white font-semibold text-[16px]">Portfolio Doctor</h3>
                                <p className="text-white/50 text-[13px] flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#00C805] animate-pulse"></span>
                                    Online
                                </p>
                            </div>
                        </div>
                        <button type="button" onClick={onClose} aria-label="Close chat" className="touch-target p-2 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                        {messages.map((msg, i) => {
                            const isUser = msg.role === 'user';
                            return (
                                <motion.div
                                    key={msg.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`flex gap-3 w-full items-end ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                                >
                                    {!isUser && (
                                        <div className="relative w-8 h-8 rounded-full overflow-hidden shrink-0">
                                            <Image src="/avatars/The CIO Agent.svg" alt="Doctor" fill sizes="32px" className="object-cover" />
                                        </div>
                                    )}

                                    <div className={`flex flex-col max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
                                        <div className={`px-4 py-3 text-[15px] leading-relaxed rounded-[20px] ${isUser
                                            ? 'bg-[#0A84FF] text-white rounded-br-none'
                                            : 'bg-[#2C2C2E] text-white/90 rounded-bl-none'
                                            }`}>
                                            <p className="whitespace-pre-wrap">{msg.text}</p>
                                        </div>
                                        <span className="text-[11px] text-white/40 mt-1.5 px-1">{msg.timestamp}</span>
                                    </div>
                                </motion.div>
                            );
                        })}

                        {isTyping && (
                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex gap-3 w-full items-end mt-4"
                            >
                                <div className="relative w-8 h-8 rounded-full overflow-hidden shrink-0">
                                    <Image src="/avatars/The CIO Agent.svg" alt="Doctor" fill sizes="32px" className="object-cover" />
                                </div>
                                <div className="bg-[#2C2C2E] rounded-[20px] rounded-bl-none px-5 py-4 inline-flex items-center gap-1.5 self-end min-h-[44px]">
                                    <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                </div>
                            </motion.div>
                        )}
                        <div ref={messagesEndRef} className="h-2" />
                    </div>

                    {/* Quick Chips */}
                    <div className="flex gap-2 px-4 sm:px-6 pb-3 pt-4 overflow-x-auto scrollbar-none bg-[#111114] border-t border-white/5">
                        <button type="button" onClick={(e) => handleSend(e, "Analyze my portfolio risk")} className="touch-target whitespace-nowrap bg-[#2C2C2E] hover:bg-[#3C3C3E] text-[13px] px-4 py-2 rounded-full text-white/80 transition-colors border border-white/10 shadow-sm">Analyze Risk</button>
                        <button type="button" onClick={(e) => handleSend(e, "What are the weak links in my holdings?")} className="touch-target whitespace-nowrap bg-[#2C2C2E] hover:bg-[#3C3C3E] text-[13px] px-4 py-2 rounded-full text-white/80 transition-colors border border-white/10 shadow-sm">Find Weak Links</button>
                        <button type="button" onClick={(e) => handleSend(e, "Suggest ways to diversify")} className="touch-target whitespace-nowrap bg-[#2C2C2E] hover:bg-[#3C3C3E] text-[13px] px-4 py-2 rounded-full text-white/80 transition-colors border border-white/10 shadow-sm">Diversification</button>
                    </div>

                    {/* Input Area */}
                    <form onSubmit={(e) => handleSend(e)} className="bg-[#111114] px-4 sm:px-4 pt-1 pb-safe shrink-0 relative">
                        <div className="relative flex items-end gap-2 max-w-4xl mx-auto">
                            <input
                                ref={inputRef}
                                type="text"
                                aria-label="Message the portfolio doctor"
                                className="flex-1 bg-[#2C2C2E] text-white rounded-full pl-5 pr-12 py-3.5 focus:outline-none focus:ring-1 focus:ring-white/20 text-base sm:text-[15px] placeholder-white/40 shadow-inner"
                                placeholder="Message the Doctor..."
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                disabled={isTyping}
                            />
                            <button
                                type="submit"
                                aria-label="Send message"
                                disabled={!input.trim() || isTyping}
                                className={`absolute right-2 bottom-1.5 p-2 rounded-full transition-all duration-200 ${input.trim() && !isTyping ? 'bg-[#0A84FF] text-white hover:scale-105 shadow-md' : 'bg-transparent text-white/20'
                                    }`}
                            >
                                <Send className="w-4 h-4 ml-0.5" />
                            </button>
                        </div>
                    </form>

                    {/* Toast Notification (Memory Update) */}
                    <AnimatePresence>
                        {toastMsg && (
                            <motion.div
                                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                                className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-[#1E1E24]/90 backdrop-blur-md border border-[#00C805]/30 text-[#00C805] px-4 py-2.5 rounded-full shadow-[0_0_30px_rgba(0,200,5,0.15)] flex items-center gap-2 text-[13px] font-medium"
                            >
                                <div className="bg-[#00C805]/20 p-1 rounded-full">
                                    <CheckCheck className="w-3.5 h-3.5" />
                                </div>
                                {toastMsg}
                            </motion.div>
                        )}
                    </AnimatePresence>

                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}

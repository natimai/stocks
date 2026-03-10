'use client';
import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, ArrowLeft,
    TrendingUp, TrendingDown, Clock, Briefcase, Zap, AlertTriangle, CheckCircle2,
    LayoutDashboard, ScanLine, User, LogOut, Lock, Star, CheckCheck, Plus, Mic, Send, X, Share2
} from 'lucide-react';
import { ResponsiveContainer, Tooltip, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import CommandPalette from './CommandPalette';
import RollingPrice from './RollingPrice';
import { auth, googleProvider } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { apiGet, apiPost, buildApiUrl, generateRequestId } from '../lib/apiClient';

const InteractiveChart = dynamic(() => import('./CandlestickChart'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-[#111114] animate-pulse rounded-xl" />,
});

const PortfolioManager = dynamic(() => import('./PortfolioManager'), {
    ssr: false,
    loading: () => <div className="h-40 bg-[#111114] border border-white/10 rounded-2xl animate-pulse" />,
});

// ─── WATCHLIST HOOK ──────────────────────────────────────────────────
const WATCHLIST_KEY = 'consensusai_watchlist';

function useWatchlist(ticker) {
    const [watched, setWatched] = useState(false);
    const [pulse, setPulse] = useState(false);

    useEffect(() => {
        if (!ticker) return;
        try {
            const wl = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
            setWatched(wl.some(w => w.ticker === ticker));
        } catch { /* ignore */ }
    }, [ticker]);

    const toggle = (name) => {
        try {
            const wl = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
            const isIn = wl.some(w => w.ticker === ticker);
            const next = isIn
                ? wl.filter(w => w.ticker !== ticker)
                : [{ ticker, name, addedAt: Date.now() }, ...wl];
            localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
            setWatched(!isIn);
            setPulse(true);
            setTimeout(() => setPulse(false), 600);
        } catch { /* ignore */ }
    };

    return { watched, toggle, pulse };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = (n) => n != null ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n) : 'N/A';
const fmtPct = (v) => v != null ? `${v >= 0 ? '+' : ''}${Math.abs(Number(v)).toFixed(2)}%` : 'N/A';
const fmtVal = (v) => v == null ? 'N/A' : typeof v === 'number' ? Number(v).toFixed(2) : v;
const DEFAULT_DEBATE = { bull: '', bear: '', quant: '', cio: '' };

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeChartRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
        .map((row) => {
            const close = toFiniteNumber(row?.close ?? row?.value);
            if (close == null) return null;

            const open = toFiniteNumber(row?.open) ?? close;
            const high = toFiniteNumber(row?.high) ?? Math.max(open, close);
            const low = toFiniteNumber(row?.low) ?? Math.min(open, close);
            const volume = toFiniteNumber(row?.volume) ?? 0;
            const ts = typeof row?.time === 'number'
                ? Math.floor(row.time)
                : (typeof row?._ts === 'number' ? Math.floor(row._ts) : null);
            let dateLabel = typeof row?.date === 'string' ? row.date : null;

            if (!dateLabel && ts != null) {
                dateLabel = new Date(ts * 1000).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'America/New_York',
                });
            }

            if (!dateLabel && typeof row?.time === 'string' && row.time.trim()) {
                dateLabel = row.time.trim();
            }

            if (!dateLabel) {
                dateLabel = `${new Date().toLocaleDateString('en-US')}`;
            }

            return {
                date: dateLabel,
                _ts: ts,
                close,
                open,
                high,
                low,
                volume,
            };
        })
        .filter(Boolean);
}

function normalizeStockPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const analysis = payload.ai_analysis && typeof payload.ai_analysis === 'object' ? payload.ai_analysis : {};
    const debate = analysis.debate && typeof analysis.debate === 'object' ? analysis.debate : DEFAULT_DEBATE;

    return {
        ...payload,
        chartData: normalizeChartRows(payload.chartData),
        metrics: payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : null,
        technicals: payload.technicals && typeof payload.technicals === 'object' ? payload.technicals : null,
        ai_analysis: {
            ...analysis,
            sub_scores: analysis.sub_scores && typeof analysis.sub_scores === 'object' ? analysis.sub_scores : null,
            xai_rationale: analysis.xai_rationale && typeof analysis.xai_rationale === 'object' ? analysis.xai_rationale : null,
            debate,
        },
    };
}

// ─── TOOLTIPS ─────────────────────────────────────────────────────────────────
function RadarTip({ active, payload, trendColor }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{ background: '#1E1E24', border: 'none', borderRadius: 4, padding: '4px 8px' }}>
            <span style={{ color: '#ffffff', fontWeight: 500, fontSize: 13, marginRight: 6 }}>{payload[0].payload.subject}</span>
            <span style={{ color: trendColor, fontWeight: 700, fontSize: 13 }}>{payload[0].value}</span>
        </div>
    );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
// Maps UI label → {period, interval} for yfinance /api/chart calls
const TIMEFRAME_MAP = {
    '1D': { period: '1d', interval: '5m' },
    '1W': { period: '5d', interval: '30m' },
    '1M': { period: '1mo', interval: '1d' },
    '3M': { period: '3mo', interval: '1d' },
    'YTD': { period: 'ytd', interval: '1d' },
    '1Y': { period: '1y', interval: '1wk' },
    '5Y': { period: '5y', interval: '1mo' },
    'ALL': { period: 'max', interval: '1mo' },
};

// ─── AI ANALYSIS PROGRESS STEPS ──────────────────────────────────────────────
const ANALYSIS_STEPS = [
    { keywords: ['Verifying', 'Initializing', 'access'], label: 'Initializing' },
    { keywords: ['Fetching', 'Loading', 'market data', 'quick-stats'], label: 'Fetching Market Data' },
    { keywords: ['Bull', 'Bull agent', 'bullish'], label: 'Bull Agent Analyzing' },
    { keywords: ['Bear', 'Bear agent', 'bearish'], label: 'Bear Agent Stress-Testing' },
    { keywords: ['Quant', 'Quant agent', 'technical', 'quantitative'], label: 'Quant Running Models' },
    { keywords: ['CIO', 'synthesizing', 'synthesis', 'Generating'], label: 'CIO Synthesizing' },
    { keywords: ['complete', 'done', 'Complete'], label: 'Analysis Complete' },
];

function getActiveStep(msg) {
    if (!msg) return 0;
    const lower = msg.toLowerCase();
    for (let i = ANALYSIS_STEPS.length - 1; i >= 0; i--) {
        if (ANALYSIS_STEPS[i].keywords.some(k => lower.includes(k.toLowerCase()))) return i;
    }
    return 0;
}

function AnalysisBanner({ streamMsg, loading, trendColor }) {
    const activeStep = getActiveStep(streamMsg);
    if (!loading || !streamMsg) return null;
    return (
        <div className="sticky top-[112px] md:top-[73px] z-40 bg-[#000]/80 backdrop-blur-lg border-b border-white/5 px-4 py-3">
            <div className="max-w-4xl mx-auto">
                {/* Step dots */}
                <div className="flex items-center gap-0 mb-2.5 overflow-x-auto scrollbar-none">
                    {ANALYSIS_STEPS.map((step, i) => (
                        <React.Fragment key={step.label}>
                            <div className="flex flex-col items-center shrink-0">
                                <div
                                    className="w-2 h-2 rounded-full transition-all duration-500"
                                    style={{
                                        backgroundColor: i < activeStep
                                            ? trendColor
                                            : i === activeStep
                                                ? trendColor
                                                : 'rgba(255,255,255,0.1)',
                                        boxShadow: i === activeStep ? `0 0 8px ${trendColor}` : 'none',
                                        transform: i === activeStep ? 'scale(1.4)' : 'scale(1)',
                                    }}
                                />
                            </div>
                            {i < ANALYSIS_STEPS.length - 1 && (
                                <div
                                    className="flex-1 h-px mx-1 min-w-[16px] transition-all duration-700"
                                    style={{
                                        backgroundColor: i < activeStep ? trendColor : 'rgba(255,255,255,0.08)',
                                    }}
                                />
                            )}
                        </React.Fragment>
                    ))}
                </div>
                {/* Active step label + raw message */}
                <div className="flex items-center gap-2">
                    <span
                        className="w-2 h-2 rounded-full animate-pulse shrink-0"
                        style={{ backgroundColor: trendColor }}
                    />
                    <span className="text-xs font-bold uppercase tracking-widest" style={{ color: trendColor }}>
                        {ANALYSIS_STEPS[activeStep]?.label}
                    </span>
                    <span className="text-[11px] text-white/30 truncate hidden sm:inline ml-1">
                        — {streamMsg}
                    </span>
                </div>
            </div>
        </div>
    );
}

export default function StockDashboard({ initialTicker, onBack }) {
    // ── STATE ──
    const [ticker, setTicker] = useState(initialTicker || 'AAPL');
    const [data, setData] = useState(null);          // null until first API response
    const [loading, setLoading] = useState(false);
    const [chartLoading, setChartLoading] = useState(false);
    const [streamMsg, setStreamMsg] = useState('');
    const [liveDebate, setLiveDebate] = useState(DEFAULT_DEBATE);

    // Chart state — driven by timeframe selection
    const [timeframe, setTimeframe] = useState('1M');
    const [activeChartData, setActiveChartData] = useState([]);
    const [displayChangePercent, setDisplayChangePercent] = useState(null);
    const [hoverPrice, setHoverPrice] = useState(null);
    const [hoverDate, setHoverDate] = useState(null);
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [showPaywall, setShowPaywall] = useState(false);
    const [userProfile, setUserProfile] = useState(null); // { isPro, autoAnalysis, analysisCount }
    const [aiStarted, setAiStarted] = useState(false);    // has AI analysis been kicked off this session
    const [pendingTicker, setPendingTicker] = useState(null); // queued ticker while auth resolves

    const [targetDate, setTargetDate] = useState('');
    const [chatInput, setChatInput] = useState('');
    const [chatThread, setChatThread] = useState([]);
    const [isAgentTyping, setIsAgentTyping] = useState(false);

    // Track Auth State + fetch user profile from Firestore
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                try {
                    const token = await currentUser.getIdToken();
                    const { data: profile } = await apiGet('/api/user-profile', {
                        authToken: token,
                        retries: 1,
                    });
                    setUserProfile(profile && typeof profile === 'object' ? profile : null);
                } catch (e) {
                    // profile fetch failed — treat as free user
                    setUserProfile(null);
                }
            } else {
                setUserProfile(null);
            }
            setAuthLoading(false);
        });
        return () => unsubscribe();
    }, []);

    // Once auth resolves and there's a pending ticker, trigger the analysis
    useEffect(() => {
        if (!authLoading && pendingTicker) {
            setPendingTicker(null);
            // If Pro user with autoAnalysis on, run full analysis; otherwise just load data
            if (userProfile?.isPro && userProfile?.autoAnalysis) {
                handleSearch(pendingTicker);
            } else {
                loadStockData(pendingTicker);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading]);

    const handleGoogleLogin = async () => {
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (error) {
            console.error("Login failed", error);
        }
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logout failed", error);
        }
    };

    // Derive colors from displayChangePercent
    const isUp = (displayChangePercent || 0) >= 0;
    const TREND_COLOR = isUp ? '#00C805' : '#FF5000'; // Robinhood Green / Robinhood Red

    // ── Fetch chart data for a given ticker + timeframe ──
    const fetchChart = useRef(null);
    fetchChart.current = async (sym, tf) => {
        const { period, interval } = TIMEFRAME_MAP[tf] || TIMEFRAME_MAP['1M'];
        const safeSymbol = String(sym || '').trim().toUpperCase();
        if (!safeSymbol) return;
        setChartLoading(true);
        try {
            const { data: raw } = await apiGet(
                `/api/chart/${encodeURIComponent(safeSymbol)}?period=${encodeURIComponent(period)}&interval=${encodeURIComponent(interval)}`,
                { retries: 1, timeoutMs: 12000 }
            );
            const normalized = normalizeChartRows(raw);
            if (normalized.length === 0) {
                setActiveChartData([]);
                setDisplayChangePercent(null);
                return;
            }

            setActiveChartData(normalized);

            // Compute change % for this window: (last - first) / first * 100
            const first = toFiniteNumber(normalized[0]?.close);
            const last = toFiniteNumber(normalized[normalized.length - 1]?.close);
            if (first != null && last != null && first !== 0) {
                setDisplayChangePercent(((last - first) / first) * 100);
            } else {
                setDisplayChangePercent(null);
            }
        } catch (e) {
            console.warn('Chart fetch error:', e);
            setActiveChartData([]);
            setDisplayChangePercent(null);
        } finally {
            setChartLoading(false);
        }
    };

    // Set absolute black background via global class addition ensuring total darkness
    useEffect(() => {
        document.documentElement.style.backgroundColor = '#000000';
        document.documentElement.style.color = '#FFFFFF';
        return () => {
            document.documentElement.style.backgroundColor = '';
            document.documentElement.style.color = '';
        }
    }, []);

    // Auto-trigger: load stock data immediately. AI analysis awaits user click (unless Pro + autoAnalysis).
    useEffect(() => {
        if (initialTicker) {
            if (authLoading) {
                setPendingTicker(initialTicker);
            } else if (userProfile?.isPro && userProfile?.autoAnalysis) {
                handleSearch(initialTicker);
            } else {
                loadStockData(initialTicker);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── SEARCH HANDLER ──
    // ── FAST PATH: Load market data only (no auth needed) ──
    const loadStockData = async (selectedTicker) => {
        const safeTicker = String(selectedTicker || '').trim().toUpperCase();
        if (!safeTicker) return;
        setTicker(safeTicker);
        setLoading(true);
        setData(null);
        setAiStarted(false);
        setShowPaywall(false);
        setLiveDebate(DEFAULT_DEBATE);
        setStreamMsg('');

        try {
            const { data: fast } = await apiGet(`/api/quick-stats/${encodeURIComponent(safeTicker)}`, {
                retries: 1,
                timeoutMs: 12000,
            });
            const normalizedFast = normalizeStockPayload(fast);
            if (!normalizedFast) throw new Error('Invalid ticker');

            setData(normalizedFast);
            const defaultTF = '1M';
            setTimeframe(defaultTF);
            await fetchChart.current(safeTicker, defaultTF);
        } catch (err) {
            setStreamMsg('Error: Could not retrieve data. Try another ticker.');
        } finally {
            setLoading(false);
        }
    };

    // ── SLOW PATH: Run AI analysis (requires auth) ──
    const runAiAnalysis = async (selectedTicker, optionalDate = targetDate) => {
        const safeTicker = String(selectedTicker || '').trim().toUpperCase();
        if (!safeTicker) return;

        let idToken = '';
        if (user) {
            idToken = await user.getIdToken();
        } else {
            setShowPaywall(true);
            return;
        }

        setAiStarted(true);
        setLoading(true);
        setStreamMsg('Verifying access & Initializing FinDebate AI Framework...');

        try {
            const analyzePath = `/api/analyze/${encodeURIComponent(safeTicker)}${optionalDate ? `?date=${encodeURIComponent(optionalDate)}` : ''}`;
            const slowRes = await fetch(buildApiUrl(analyzePath), {
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'X-Request-ID': generateRequestId(),
                    Accept: 'text/event-stream',
                },
                cache: 'no-store',
            });

            if (slowRes.status === 403 || slowRes.status === 401) {
                setShowPaywall(true);
                setLoading(false);
                return;
            }

            if (!slowRes.ok) {
                let errDetail = 'AI analysis failed.';
                try {
                    const errPayload = await slowRes.json();
                    if (errPayload?.detail) errDetail = `Error: ${errPayload.detail}`;
                } catch {
                    // ignore parse errors
                }
                setStreamMsg(errDetail);
                setLoading(false);
                return;
            }

            if (slowRes.ok && slowRes.body) {
                const reader = slowRes.body.getReader();
                const decoder = new TextDecoder();
                let done = false;
                let buffer = '';
                let currentDebate = { ...DEFAULT_DEBATE };

                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;
                    if (value) {
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try {
                                    const parsed = JSON.parse(line.substring(6));
                                    if (parsed.type === 'status') {
                                        setStreamMsg(parsed.message);
                                    } else if (parsed.type === 'agent_done') {
                                        if (parsed.agent && Object.prototype.hasOwnProperty.call(currentDebate, parsed.agent)) {
                                            currentDebate[parsed.agent] = parsed.text;
                                            setLiveDebate({ ...currentDebate });
                                        }
                                    } else if (parsed.type === 'complete') {
                                        const normalized = normalizeStockPayload(parsed.data);
                                        if (normalized) {
                                            setData(normalized);
                                            setLiveDebate(normalized?.ai_analysis?.debate || currentDebate);
                                        }
                                        setLoading(false);
                                    } else if (parsed.type === 'error') {
                                        setStreamMsg(`Error: ${parsed.message}`);
                                        setLoading(false);
                                    }
                                } catch (e) { /* ignore parse errors during chunking */ }
                            }
                        }
                    }
                }
            } else {
                setLoading(false);
            }
        } catch (err) {
            console.error('AI analysis error:', err);
            setStreamMsg('Error: AI analysis failed.');
            setLoading(false);
        }
    };

    // ── LEGACY: full search (data + AI) used for internal search bar ──
    const handleSearch = async (selectedTicker, optionalDate = targetDate) => {
        await loadStockData(selectedTicker);
        if (!authLoading) {
            await runAiAnalysis(selectedTicker, optionalDate);
        }
    };

    const handleChatSubmit = async (e, directMessage = null) => {
        if (e) e.preventDefault();
        const messageToSubmit = directMessage || chatInput;
        if (!messageToSubmit.trim() || !user) return;

        let targetAgent = "CIO"; // Default
        const lowerInput = messageToSubmit.toLowerCase();
        if (lowerInput.includes("@bull")) targetAgent = "Bull";
        else if (lowerInput.includes("@bear")) targetAgent = "Bear";
        else if (lowerInput.includes("@quant")) targetAgent = "Quant";
        else if (lowerInput.includes("@cio")) targetAgent = "CIO";

        const newMessage = {
            id: Date.now(),
            role: "user",
            text: messageToSubmit,
            align: "right",
            bubbleClass: "bg-[#005C4B] rounded-2xl rounded-tr-sm text-white",
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setChatThread(prev => [...prev, newMessage]);
        if (!directMessage) setChatInput("");
        setIsAgentTyping(true);

        try {
            const token = await user.getIdToken();
            const { data } = await apiPost(
                '/api/chat_agent',
                {
                    ticker: display?.ticker || ticker,
                    user_message: messageToSubmit,
                    target_agent: targetAgent,
                    context_score: display?.score || 50,
                },
                {
                    authToken: token,
                    retries: 1,
                    timeoutMs: 20000,
                }
            );

            let avatar = '/avatars/The CIO Agent.svg';
            let name = 'The CIO';
            let nameColor = 'text-white/80';

            if (targetAgent === 'Bull') { avatar = '/avatars/The Bull.svg'; name = 'The Bull'; nameColor = 'text-emerald-500'; }
            if (targetAgent === 'Bear') { avatar = '/avatars/bear.svg'; name = 'The Bear'; nameColor = 'text-red-400'; }
            if (targetAgent === 'Quant') { avatar = '/avatars/The Quant.svg'; name = 'The Quant'; nameColor = 'text-cyan-400'; }

            const agentMsg = {
                id: Date.now() + 1,
                role: "agent",
                name: name,
                avatar: avatar,
                nameColor: nameColor,
                align: "left",
                bubbleClass: "bg-[#1E1E24] rounded-2xl rounded-tl-sm text-white/90",
                text: data?.response || 'No response from agent.',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setChatThread(prev => [...prev, agentMsg]);
        } catch (err) {
            console.error(err);
        } finally {
            setIsAgentTyping(false);
        }
    };

    // Safe extraction
    const display = data || {};
    const sub = display?.ai_analysis?.sub_scores || null;
    const xai = display?.ai_analysis?.xai_rationale || null;
    const { watched, toggle: toggleWatch, pulse: watchPulse } = useWatchlist(display?.ticker || ticker);
    // Use activeChartData (driven by timeframe) instead of static chartData from server
    const fallbackChartData = normalizeChartRows(display?.chartData);
    const rawChartData = activeChartData.length > 0 ? activeChartData : fallbackChartData;

    // For 1D, trim data to current time THEN pad with null ghost-points to 4:00 PM ET
    // This forces recharts to keep the full trading-day width on the X-axis while
    // leaving the right side visually empty (showing remaining session time).
    const chartData = (() => {
        if (timeframe !== '1D' || rawChartData.length === 0) return rawChartData;

        const nowUnix = Date.now() / 1000;
        const MARKET_CLOSE_UNIX = (() => {
            // Build today's 16:00 ET as a unix timestamp
            const now = new Date();
            const todayET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
            todayET.setHours(16, 0, 0, 0);
            // Convert back to UTC unix — offset the difference
            const utcEquivalent = now.getTime() + (todayET.getTime() - new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getTime());
            return utcEquivalent / 1000;
        })();

        let trimmed;
        if (rawChartData[0]?._ts != null) {
            // Real data with unix timestamps
            trimmed = rawChartData.filter(c => c._ts <= nowUnix);
        } else {
            // MOCK data fallback — compare via minutes-since-midnight ET
            const nowET = new Date().toLocaleTimeString('en-US', {
                timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true
            });
            const toMins = (label) => {
                if (!label) return 0;
                const m = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
                if (!m) return 0;
                let h = parseInt(m[1], 10);
                const min = parseInt(m[2], 10);
                const period = m[3].toUpperCase();
                if (period === 'PM' && h !== 12) h += 12;
                if (period === 'AM' && h === 12) h = 0;
                return h * 60 + min;
            };
            const nowMins = toMins(nowET);
            trimmed = rawChartData.filter(c => toMins(c.date) <= nowMins);
        }

        // Only pad if market is still open (now < 4 PM ET)
        if (nowUnix >= MARKET_CLOSE_UNIX) return trimmed;

        // Generate ghost (null) candles every 5 minutes from (now+5) to 16:00 ET
        const lastTs = trimmed.length > 0 && trimmed[trimmed.length - 1]._ts
            ? trimmed[trimmed.length - 1]._ts
            : nowUnix;
        const ghosts = [];
        const STEP = 5 * 60; // 5-minute intervals
        for (let ts = lastTs + STEP; ts <= MARKET_CLOSE_UNIX; ts += STEP) {
            const label = new Date(ts * 1000).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York'
            });
            ghosts.push({ date: label, close: null, _ts: ts });
        }
        return [...trimmed, ...ghosts];
    })();

    const firstClose = chartData[0]?.close ?? chartData[0]?.value;
    let currentDisplayPrice = display?.price;
    let currentDisplayChange = displayChangePercent;
    let currentDisplayDate = timeframe;

    if (hoverPrice !== null && firstClose) {
        currentDisplayPrice = hoverPrice;
        currentDisplayChange = ((hoverPrice - firstClose) / firstClose) * 100;
        currentDisplayDate = hoverDate || timeframe;
    }

    // Radar Data
    const radarData = sub ? [
        { subject: 'FND', value: sub.Fundamental || 0 },
        { subject: 'TEC', value: sub.Technical || 0 },
        { subject: 'SNT', value: sub.Sentiment || 0 },
        { subject: 'MAC', value: sub.Macro_Risk || 0 },
    ] : [];

    // Debate Agents Array for WhatsApp/iMessage styles
    // Use actual current time so messages feel live, not hardcoded demo times
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const debateAgents = [
        {
            key: 'bull',
            avatar: '/avatars/The Bull.svg',
            name: 'The Bull',
            nameColor: 'text-emerald-500',
            align: 'left',
            bubbleClass: 'bg-[#1E1E24] rounded-2xl rounded-tl-sm text-white/90',
            text: liveDebate.bull,
            time: nowTime
        },
        {
            key: 'bear',
            avatar: '/avatars/bear.svg',
            name: 'The Bear',
            nameColor: 'text-red-400',
            align: 'left',
            bubbleClass: 'bg-[#1E1E24] rounded-2xl rounded-tl-sm text-white/90',
            text: liveDebate.bear,
            time: nowTime
        },
        {
            key: 'quant',
            avatar: '/avatars/The Quant.svg',
            name: 'The Quant',
            nameColor: 'text-cyan-400',
            align: 'left',
            bubbleClass: 'bg-[#1E1E24] rounded-2xl rounded-tl-sm text-white/90',
            text: liveDebate.quant,
            time: nowTime
        },
        {
            key: 'cio',
            avatar: '/avatars/The CIO Agent.svg',
            name: 'The CIO',
            nameColor: 'text-white/80',
            align: 'right',
            bubbleClass: 'bg-[#005C4B] rounded-2xl rounded-tr-sm text-white',
            text: liveDebate.cio || (sub ? (display.summary || "Debate Concluded.") : ""),
            time: nowTime
        }
    ];

    return (
        <div suppressHydrationWarning className="min-h-screen font-sans bg-[#000000] text-white selection:bg-white/20 pb-28 md:pb-20">

            {/* ── TOP NAV (Minimalist) ── */}
            <header suppressHydrationWarning className="sticky top-0 z-50 bg-[#000000]/90 backdrop-blur-md border-b-0">
                <div suppressHydrationWarning className="max-w-4xl mx-auto px-4 py-3 md:py-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                        {/* Logo / Back Button */}
                        <div className="flex items-center gap-2.5 min-w-0">
                            {onBack && (
                                <button
                                    type="button"
                                    onClick={onBack}
                                    aria-label="Back to home"
                                    className="touch-target flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                </button>
                            )}
                            <button
                                type="button"
                                aria-label="Go to home"
                                onClick={onBack || (() => window.location.reload())}
                                className="appearance-none bg-transparent border-0 p-0 flex items-center gap-2.5 group cursor-pointer min-w-0"
                            >
                                <div className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-colors group-hover:opacity-80">
                                    <img src="/logo.svg" alt="ConsensusAI Logo" className="w-full h-full object-contain" />
                                </div>
                                <span className="truncate font-bold tracking-tight text-lg sm:text-xl text-white/90">Consensus<span className="text-[#00C805]">AI</span></span>
                            </button>
                        </div>

                        {/* Mobile auth shortcut */}
                        <div className="md:hidden">
                            {user ? (
                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    aria-label="Logout"
                                    className="touch-target flex items-center justify-center rounded-full text-white/50 hover:text-[#FF5000] hover:bg-white/5 transition-colors"
                                >
                                    <LogOut className="w-5 h-5" />
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleGoogleLogin}
                                    aria-label="Sign in"
                                    className="touch-target flex items-center justify-center rounded-full text-[#00C805] hover:bg-white/5 transition-colors"
                                >
                                    <User className="w-5 h-5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Search Bar */}
                    <div className="w-full md:max-w-sm relative z-50">
                        <div className="opacity-90 hover:opacity-100 transition-opacity">
                            <CommandPalette onSelect={handleSearch} />
                        </div>
                    </div>

                    {/* Right Nav Links */}
                    <div className="hidden md:flex items-center gap-6 text-sm font-medium">
                        <button
                            type="button"
                            onClick={() => {
                                if (!user) {
                                    handleGoogleLogin();
                                } else {
                                    document.getElementById('portfolio')?.scrollIntoView({ behavior: 'smooth' });
                                }
                            }}
                            className="touch-target text-white/50 hover:text-white transition-colors"
                        >
                            Portfolio
                        </button>
                        <span className="text-white/20 cursor-default flex items-center gap-1 text-xs">
                            Screener <span className="bg-white/10 text-white/30 text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">Soon</span>
                        </span>
                        {user ? (
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 rounded-full bg-[#1E1E24] overflow-hidden">
                                        {user.photoURL ? (
                                            <img src={user.photoURL} alt="User avatar" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center">
                                                <User className="w-3.5 h-3.5 text-white/60" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="hidden sm:inline text-sm text-white/80 font-medium">
                                            {user.displayName || user.email?.split('@')[0]}
                                        </span>
                                        {userProfile && (
                                            <span className="hidden sm:inline text-[10px] text-white/40 tracking-wide uppercase font-bold mt-0.5">
                                                {userProfile.isPro ? (
                                                    <span className="text-[#00C805]">PRO PLAN</span>
                                                ) : (
                                                    <span>Free Plan - {Math.min(userProfile.analysisCount || 0, 1)}/1 Used</span>
                                                )}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            <button
                                type="button"
                                onClick={handleLogout}
                                aria-label="Logout"
                                className="touch-target p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-[#FF5000]"
                                    title="Logout"
                                >
                                    <LogOut className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={handleGoogleLogin}
                                className="touch-target flex items-center gap-2 min-h-[44px] px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                            >
                                <svg className="w-4 h-4" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                <span className="text-sm font-medium">Sign in</span>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* ── AI ANALYSIS PROGRESS BANNER ── */}
            <AnalysisBanner streamMsg={streamMsg} loading={loading} trendColor={TREND_COLOR} />

            <main className="max-w-4xl mx-auto px-4 mt-6 sm:mt-8 space-y-12 sm:space-y-16">

                {/* ── SECTION 1: THE AI COCKPIT ── */}
                <section className="flex flex-col md:flex-row justify-between items-start md:items-end gap-8 pt-4">
                    {/* Left: Ticker & Price */}
                    <div className="flex flex-col gap-2 items-start flex-1">
                        <div className="flex items-start sm:items-center gap-3 min-w-0">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-white/10 flex items-center justify-center shrink-0 border border-white/5">
                                <img
                                    src={`https://img.logokit.com/ticker/${display?.ticker || ticker}?token=pk_frfa213068bb8ffac35321&size=128&fallback=monogram`}
                                    alt={`${display?.ticker || ticker} logo`}
                                    className="w-full h-full object-contain p-1.5"
                                    onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                                />
                            </div>
                            <h1 className="text-[24px] sm:text-[32px] font-bold tracking-tight text-white/90 leading-tight sm:leading-none m-0 truncate max-w-[65vw] sm:max-w-none">
                                {display?.name || display?.ticker || ticker}
                            </h1>
                            {/* Watchlist Button */}
                            {(display?.ticker || ticker) && (
                                <button
                                    type="button"
                                    onClick={() => toggleWatch(display?.name || display?.ticker || ticker)}
                                    aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                                    title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
                                    className="touch-target ml-1 p-1.5 rounded-full transition-all hover:scale-110 active:scale-95"
                                    style={{
                                        color: watched ? '#FFD700' : 'rgba(255,255,255,0.2)',
                                        filter: watchPulse ? 'drop-shadow(0 0 6px #FFD700)' : 'none',
                                        transition: 'color 0.2s, filter 0.3s',
                                    }}
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        className="w-6 h-6"
                                        fill={watched ? 'currentColor' : 'none'}
                                        stroke="currentColor"
                                        strokeWidth={1.8}
                                    >
                                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                    </svg>
                                </button>
                            )}
                        </div>

                        <div className="flex flex-col mt-3">
                            {/* Massive Price with slot-machine animation */}
                            <div className="text-[40px] sm:text-[56px] font-medium tracking-tight mb-1 leading-none flex items-center" style={{ fontFamily: 'SF Pro Display, Inter, sans-serif' }}>
                                <RollingPrice price={currentDisplayPrice} />
                            </div>
                            {/* Amount & Change % */}
                            {(currentDisplayChange != null) && (
                                <div className="text-[15px] sm:text-[17px] font-semibold mt-1 flex flex-wrap items-center gap-1.5" style={{ color: TREND_COLOR }}>
                                    <span>
                                        {isUp ? '+' : '-'}${Math.abs((currentDisplayPrice || 0) - (firstClose || currentDisplayPrice || 0)).toFixed(2)}
                                        {' '}({fmtPct(currentDisplayChange)})
                                    </span>
                                    <span className="text-white/40 ml-1 font-normal capitalize">
                                        {currentDisplayDate === '1D' ? 'Today' :
                                            currentDisplayDate === '1W' ? 'Past Week' :
                                                currentDisplayDate === '1M' ? 'Past Month' :
                                                    currentDisplayDate === '3M' ? 'Past 3 Months' :
                                                        currentDisplayDate === 'YTD' ? 'Year to Date' :
                                                            currentDisplayDate === '1Y' ? 'Past Year' :
                                                                currentDisplayDate === '5Y' ? 'Past 5 Years' :
                                                                    currentDisplayDate === 'ALL' ? 'All Time' :
                                                                        currentDisplayDate}
                                    </span>
                                    {chartLoading && <span className="w-3.5 h-3.5 rounded-full border border-white/20 border-t-white/70 animate-spin ml-2" />}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: The AI Score */}
                    {display?.score != null ? (
                        <div className="flex flex-col items-start md:items-end w-full md:w-auto mt-2 md:mt-0">
                            <div className="text-[52px] sm:text-[64px] md:text-[80px] leading-none font-bold tracking-tighter" style={{ color: TREND_COLOR }}>
                                {display.score}
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 mt-2 pr-1">
                                <span className="text-xs sm:text-sm font-medium text-white/40 uppercase tracking-widest">AI Score <span className="text-white/25">/ 100</span></span>
                                <div className="px-3 md:px-4 py-1.5 rounded-full text-[10px] md:text-xs font-bold tracking-widest uppercase shrink-0"
                                    style={{ backgroundColor: TREND_COLOR, color: '#000' }}>
                                    {display.recommendation || 'HOLD'}
                                </div>
                            </div>
                            {display?.metadata && (
                                <div className="mt-4 text-xs font-medium text-white/40 opacity-80 backdrop-blur-sm border border-white/5 rounded-full px-3 py-1.5 bg-white/5 flex items-center gap-2 whitespace-nowrap">
                                    {display.metadata.is_cached
                                        || display.metadata.cached
                                        ? <><Zap className="w-3.5 h-3.5" /> Generated today</>
                                        : <><Activity className="w-3.5 h-3.5" /> Analyzed live</>}
                                </div>
                            )}
                        </div>
                    ) : (
                        (loading || streamMsg.includes('Error')) ? (
                            <div className={`flex flex-col items-start md:items-end ${!loading ? 'opacity-80' : 'opacity-50'}`}>
                                <Activity className={`w-12 h-12 mb-4 ${loading ? 'animate-pulse' : ''}`} style={{ color: loading ? TREND_COLOR : '#FF5000' }} />
                                <div className={`text-xs font-medium uppercase tracking-widest max-w-[200px] text-left md:text-right ${loading ? 'text-white/50 animate-pulse' : 'text-[#FF5000]'}`}>
                                    {streamMsg || 'AI Calculating...'}
                                </div>
                            </div>
                        ) : (
                            // Locked State for Score
                            <div className="flex flex-col items-start md:items-end w-full md:w-auto mt-6 md:mt-0 relative group">
                                {/* Blurred Fake Score */}
                                <div className="text-[52px] sm:text-[64px] md:text-[80px] leading-none font-bold tracking-tighter text-white/10 blur-[8px] select-none pointer-events-none transition-all group-hover:blur-[12px]">
                                    85
                                </div>
                                <div className="flex items-center gap-2 sm:gap-3 mt-2 pr-1 opacity-20 blur-[3px] select-none pointer-events-none">
                                    <span className="text-xs sm:text-sm font-medium text-white/40 uppercase tracking-widest">AI Score</span>
                                    <div className="px-3 md:px-4 py-1.5 rounded-full text-[10px] md:text-xs font-bold tracking-widest uppercase shrink-0 bg-white/20 text-black">
                                        BUY
                                    </div>
                                </div>
                                {/* Unlock Overlay */}
                                <div className="absolute inset-0 flex flex-col items-center justify-center z-10 md:translate-x-4">
                                    <div className="w-10 h-10 bg-[#1A1A1E] rounded-full flex items-center justify-center mb-3 shadow-[0_0_30px_rgba(0,0,0,1)] border border-white/10 group-hover:bg-[#202024] transition-colors">
                                        <Lock className="w-4 h-4 text-white/50" />
                                    </div>
                                    {!user ? (
                                    <button
                                        type="button"
                                            onClick={() => setShowPaywall(true)}
                                            aria-label="Unlock score"
                                            className="touch-target flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest bg-[#00C805] text-black px-4 py-2 rounded-full hover:scale-105 transition-transform shadow-[0_0_15px_rgba(0,200,5,0.3)]"
                                        >
                                            Unlock Score
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => runAiAnalysis(ticker)}
                                            aria-label="Run AI analysis"
                                            className="touch-target flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest bg-[#00C805] text-black px-4 py-2 rounded-full hover:scale-105 transition-transform shadow-[0_0_15px_rgba(0,200,5,0.3)]"
                                        >
                                            Run Analysis
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    )}
                </section>

                {/* Expected Trend AI Callout */}
                {display?.summary && (
                    <motion.section
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-[#1E1E24] rounded-xl p-5"
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <Activity className="w-4 h-4" style={{ color: TREND_COLOR }} />
                            <span className="text-xs font-bold uppercase tracking-widest text-white/50">Expected Trend (1–6 Months)</span>
                        </div>
                        <p className="text-[17px] leading-relaxed font-normal text-white/90">
                            {display.summary}
                        </p>
                    </motion.section>
                )}


                {/* ── SECTION 3: CHARTS ── */}
                <section>
                    {/* Time Machine & Share Tools */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                        <div className="w-full sm:w-auto flex items-center gap-3 bg-[#111114] border border-[#1E1E24] px-4 py-2 rounded-xl transition-colors hover:border-white/20">
                            <Clock className="w-4 h-4 text-white/40" />
                            <span className="text-xs font-bold uppercase tracking-widest text-white/50 hidden sm:inline">Time Machine</span>
                            <input
                                type="date"
                                aria-label="Select analysis date"
                                className="bg-transparent text-base sm:text-sm text-white/90 outline-none border-none cursor-pointer font-medium [color-scheme:dark] min-h-[44px]"
                                value={targetDate}
                                max={new Date().toISOString().substring(0, 10)}
                                onChange={(e) => {
                                    const newDate = e.target.value;
                                    setTargetDate(newDate);
                                    handleSearch(ticker, newDate);
                                }}
                            />
                            {targetDate && (
                                <button
                                    type="button"
                                    onClick={() => { setTargetDate(''); handleSearch(ticker, ''); }}
                                    aria-label="Reset date"
                                    className="touch-target p-1 rounded-full bg-white/5 text-white/40 hover:text-[#FF5000] hover:bg-[#FF5000]/10 transition-colors"
                                    title="Reset date"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => {
                                navigator.clipboard.writeText(window.location.href);
                                setStreamMsg('Link copied to clipboard!');
                                setTimeout(() => setStreamMsg(''), 2000);
                            }}
                            aria-label="Share report link"
                            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center sm:justify-start gap-2 bg-[#111114] border border-[#1E1E24] px-4 py-2 rounded-xl hover:bg-white/5 hover:border-white/20 transition-all text-white/70 hover:text-white"
                        >
                            <Share2 className="w-4 h-4 text-[#00C805]" />
                            <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">Share Report</span>
                            <span className="text-xs font-bold uppercase tracking-widest sm:hidden">Share</span>
                        </button>
                    </div>

                    {/* Timeframe Toggles — each click fetches real chart data & recomputes % */}
                    <div className="flex items-center gap-1 sm:gap-2 mb-6 overflow-x-auto scrollbar-none w-full border-b border-[#1E1E24] pb-4">
                        {['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL'].map(tf => (
                            <button
                                key={tf}
                                type="button"
                                onClick={() => {
                                    setTimeframe(tf);
                                    const sym = display?.ticker || ticker;
                                    fetchChart.current(sym, tf);
                                }}
                                className={`min-h-[44px] px-4 py-2 rounded-lg text-[13px] font-bold transition-all shrink-0
                                    ${timeframe === tf ? 'text-black bg-white shadow-sm' : 'text-white/40 hover:text-white/80 hover:bg-white/5 bg-transparent'}`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>

                    {/* Minimalist Area Chart */}
                    <div className="h-[220px] sm:h-[280px] md:h-[320px] w-full relative">
                        {chartLoading && (
                            <div className="absolute inset-0 flex items-center justify-center z-10">
                                <Activity className="w-5 h-5 animate-pulse text-white/30" />
                            </div>
                        )}
                        {chartData && chartData.length > 0 ? (
                            <div className="w-full h-full relative z-0" onMouseLeave={() => { setHoverPrice(null); setHoverDate(null); }}>
                                <InteractiveChart
                                    data={chartData}
                                    type="candlestick"
                                    showSMA={true}
                                    setHoverPrice={setHoverPrice}
                                    setHoverDate={setHoverDate}
                                />
                            </div>
                        ) : !chartLoading ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                                <Activity className="w-6 h-6 text-white/20" />
                                <p className="text-xs text-white/20 font-medium">Chart data unavailable</p>
                            </div>
                        ) : null}
                    </div>
                </section>

                {/* ── SECTION 2: TECHNICAL & FUNDAMENTAL GRID ── */}
                {(display?.metrics || display?.technicals || radarData.length > 0) && (
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-[#1E1E24] pt-12">
                        {/* Column 1: Fundamentals */}
                        {display?.metrics && (
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-2">Fundamentals</h3>
                                {[
                                    { label: 'Market Cap', val: `$${fmt(display?.market_cap)}` },
                                    { label: 'P/E Ratio', val: fmtVal(display?.metrics?.P_E_Ratio) },
                                    { label: 'P/B Ratio', val: fmtVal(display?.metrics?.P_B_Ratio) },
                                    { label: 'PEG Ratio', val: fmtVal(display?.metrics?.PEG_Ratio) },
                                    { label: 'D/E Ratio', val: fmtVal(display?.metrics?.Debt_to_Equity) },
                                ].map(m => (
                                    <div key={m.label} className="flex justify-between items-center text-sm">
                                        <span className="text-white/60">{m.label}</span>
                                        <span className="font-medium">{m.val}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Column 2: Technicals */}
                        {display?.technicals && (
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-2">Technicals</h3>
                                {[
                                    { label: 'SMA 50', val: `$${fmtVal(display?.technicals?.SMA_50)}` },
                                    { label: 'SMA 200', val: `$${fmtVal(display?.technicals?.SMA_200)}` },
                                    { label: 'RSI 14', val: fmtVal(display?.technicals?.RSI_14) },
                                    { label: 'MACD', val: display?.technicals?.MACD_Signal || 'N/A' },
                                    { label: 'Williams %R', val: fmtVal(display?.technicals?.Williams_R) },
                                ].map(m => (
                                    <div key={m.label} className="flex justify-between items-center text-sm">
                                        <span className="text-white/60">{m.label}</span>
                                        <span className="font-medium text-right">{m.val}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Column 3: Radar Chart */}
                        {radarData.length > 0 && (
                            <div className="flex flex-col items-center justify-center">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-0 self-start md:self-center">Vector Analysis</h3>
                                <div className="w-full h-[180px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <RadarChart cx="50%" cy="50%" outerRadius="65%" data={radarData}>
                                            <PolarGrid stroke="#1E1E24" />
                                            <PolarAngleAxis dataKey="subject" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
                                            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
                                            <Radar name="Score" dataKey="value" stroke={TREND_COLOR} fill={TREND_COLOR} fillOpacity={0.15} strokeWidth={2} />
                                            <Tooltip content={<RadarTip trendColor={TREND_COLOR} />} />
                                        </RadarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </section>
                )}


                {/* ── SECTION 4: EXPLAINABLE AI (XAI) ── */}
                {xai && (
                    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Bullish Drivers */}
                        <div className="bg-[#1E1E24] rounded-xl p-6">
                            <div className="flex items-center gap-2 mb-5">
                                <TrendingUp className="w-4 h-4" style={{ color: '#00C805' }} />
                                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#00C805' }}>Bullish Drivers</span>
                            </div>
                            <ul className="space-y-4">
                                {xai?.Top_Positive_Drivers?.map((d, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#00C805' }} />
                                        <span className="text-sm font-medium text-white/80 leading-relaxed">{d}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Bearish Risks */}
                        <div className="bg-[#1E1E24] rounded-xl p-6">
                            <div className="flex items-center gap-2 mb-5">
                                <TrendingDown className="w-4 h-4" style={{ color: '#FF5000' }} />
                                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#FF5000' }}>Bearish Risks</span>
                            </div>
                            <ul className="space-y-4">
                                {xai?.Top_Negative_Drivers?.map((d, i) => (
                                    <li key={i} className="flex items-start gap-3">
                                        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#FF5000' }} />
                                        <span className="text-sm font-medium text-white/80 leading-relaxed">{d}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </section>
                )}

                {/* ── SECTION 5: AI AGENTS DEBATE ROOM (Chat Interface) ── */}
                <section className="pt-12 sm:pt-16 max-w-2xl mx-auto w-full">
                    <div className="mb-6 text-center">
                        <h2 className="text-2xl font-semibold tracking-tight">AI Strategy Committee</h2>
                        <p className="text-sm text-white/50 mt-1">Live synthesis from autonomous specialist agents.</p>
                    </div>

                    <div className="bg-black font-sans sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col h-[calc(100dvh-11rem)] min-h-[340px] sm:min-h-[460px] max-h-[760px] border border-white/5 relative">
                        {/* Chat Header */}
                        <div className="bg-[#202C33] px-4 py-3 flex items-center gap-3 shadow-md z-10 shrink-0">
                            <div className="w-10 h-10 rounded-full bg-[#111114] flex items-center justify-center shrink-0 border border-white/10 relative overflow-hidden">
                                <img src="/avatars/The Bull.svg" alt="" className="absolute top-0 left-0 w-[55%] h-[55%] object-cover" />
                                <img src="/avatars/The CIO Agent.svg" alt="" className="absolute bottom-0 right-0 w-[55%] h-[55%] object-cover" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-white/90 font-medium text-[15px]">AI Strategy Committee</span>
                                <span className="text-white/50 text-[13px]">4 participants</span>
                            </div>
                        </div>

                        {/* Chat Messages / Body */}
                        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 relative">

                            {/* LOCKED STATE - SHOW IF NO DATA/ANALYSIS COMING IN YET */}
                            {(!loading && !sub) && (
                                <>
                                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-[#0B141A]/70 backdrop-blur-[6px]">
                                        <div className="w-16 h-16 bg-[#202C33] rounded-full flex items-center justify-center mb-5 shadow-2xl border border-white/10">
                                            <Lock className="w-7 h-7 text-white/40" />
                                        </div>
                                        <h3 className="text-2xl font-bold text-white mb-3">Unlock AI Debate Room</h3>
                                        <p className="text-white/50 text-[15px] mb-8 max-w-sm leading-relaxed">
                                            Watch our multi-agent framework debate the fundamental, technical, and macro case for <strong className="text-white/80">{ticker}</strong> in real-time.
                                        </p>
                                        <div className="flex flex-col gap-3 w-full max-w-[240px]">
                                            {!user ? (
                                                <button type="button" aria-label="Sign in to access live debate" onClick={() => setShowPaywall(true)} className="touch-target flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#00C805] hover:bg-[#00e005] text-black font-bold text-[15px] transition-all shadow-[0_0_20px_rgba(0,200,5,0.2)] hover:scale-[1.03]">
                                                    <Zap className="w-4 h-4" /> Sign In to Access
                                                </button>
                                            ) : (
                                                <button type="button" aria-label="Start live debate" onClick={() => runAiAnalysis(ticker)} className="touch-target flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-[#00C805] hover:bg-[#00e005] text-black font-bold text-[15px] transition-all shadow-[0_0_20px_rgba(0,200,5,0.2)] hover:scale-[1.03]" disabled={showPaywall}>
                                                    <Zap className="w-4 h-4" /> Start Live Debate
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Blurred Dummy Chat Layout behind the lock */}
                                    <div className="space-y-6 opacity-[0.15] blur-sm pointer-events-none select-none overflow-hidden h-full mt-4">
                                        <div className="flex gap-2.5 w-full justify-start">
                                            <div className="w-8 h-8 rounded-full bg-emerald-500/50 mt-auto mb-1 shrink-0"></div>
                                            <div className="bg-[#1E1E24] rounded-2xl rounded-tl-sm p-4 w-56 h-20"></div>
                                        </div>
                                        <div className="flex gap-2.5 w-full justify-start">
                                            <div className="w-8 h-8 rounded-full bg-red-400/50 mt-auto mb-1 shrink-0"></div>
                                            <div className="bg-[#1E1E24] rounded-2xl rounded-tl-sm p-4 w-72 h-28"></div>
                                        </div>
                                        <div className="flex gap-2.5 w-full justify-end mt-8">
                                            <div className="bg-[#005C4B] rounded-2xl rounded-tr-sm p-4 w-64 h-24"></div>
                                        </div>
                                    </div>
                                </>
                            )}
                            <AnimatePresence>
                                {debateAgents.map((agent, i) => {
                                    if (!agent.text) return null; // Only render if agent has spoken
                                    const isRight = agent.align === 'right';

                                    return (
                                        <motion.div
                                            key={agent.key}
                                            initial={{ opacity: 0, scale: 0.95, y: 15 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            transition={{ duration: 0.35, delay: i * 0.15, ease: "easeOut" }}
                                            className={`flex gap-2.5 w-full items-end mt-4 ${isRight ? 'flex-row-reverse' : 'flex-row'}`}
                                        >
                                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                                                <img src={agent.avatar} alt={agent.name} className="w-full h-full object-cover" />
                                            </div>

                                            <div className={`flex flex-col max-w-[75%] ${isRight ? 'items-end' : 'items-start'}`}>
                                                {!isRight && (
                                                    <span className="text-xs text-gray-500 mb-1 ml-1">
                                                        {agent.name}
                                                    </span>
                                                )}

                                                <div className={`px-4 py-2.5 text-[15px] leading-tight rounded-2xl ${isRight
                                                    ? 'bg-[#0A84FF] text-white rounded-br-none'
                                                    : 'bg-[#2C2C2E] text-white rounded-bl-none'
                                                    }`}>
                                                    <p className="whitespace-pre-wrap">{agent.text}</p>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}

                                {/* STREAM LOADING INDICATOR (TYPING) */}
                                {/* CUSTOM USER & AGENT CHAT MSG THREAD */}
                                {chatThread.map((msg, i) => {
                                    const isRight = msg.align === 'right';

                                    return (
                                        <motion.div
                                            key={msg.id}
                                            initial={{ opacity: 0, scale: 0.95, y: 15 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            transition={{ duration: 0.35, ease: "easeOut" }}
                                            className={`flex gap-2.5 w-full items-end mt-4 ${isRight ? 'flex-row-reverse' : 'flex-row'}`}
                                        >
                                            {isRight ? (
                                                <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-[#0A84FF]/20 border border-[#0A84FF]/30 flex items-center justify-center">
                                                    <User className="w-4 h-4 text-[#0A84FF]" />
                                                </div>
                                            ) : (
                                                <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                                                    <img src={msg.avatar} alt={msg.name} className="w-full h-full object-cover" />
                                                </div>
                                            )}

                                            <div className={`flex flex-col max-w-[75%] ${isRight ? 'items-end' : 'items-start'}`}>
                                                {!isRight && (
                                                    <span className="text-xs text-gray-500 mb-1 ml-1">
                                                        {msg.name}
                                                    </span>
                                                )}

                                                <div className={`px-4 py-2.5 text-[15px] leading-tight rounded-2xl ${isRight
                                                    ? 'bg-[#0A84FF] text-white rounded-br-none'
                                                    : 'bg-[#2C2C2E] text-white rounded-bl-none'
                                                    }`}>
                                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                                </div>
                                            </div>
                                        </motion.div>
                                    );
                                })}

                                {/* Stream Loading Indicator (Typing) */}
                                {(loading || isAgentTyping) && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="flex gap-2.5 w-full justify-start mt-4 items-end"
                                    >
                                        <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                                            <div className="w-full h-full bg-[#202C33] flex items-center justify-center">
                                                <Activity className="w-4 h-4 text-emerald-500/50" />
                                            </div>
                                        </div>
                                        <div className="bg-[#2C2C2E] rounded-2xl rounded-bl-none px-4 py-3 inline-flex items-center gap-1.5 self-end">
                                            <span className="w-1.5 h-1.5 bg-emerald-500/80 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                            <span className="w-1.5 h-1.5 bg-emerald-500/80 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                            <span className="w-1.5 h-1.5 bg-emerald-500/80 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Quick Chips */}
                        <div className="flex gap-2 px-4 pb-2 pt-2 overflow-x-auto scrollbar-none bg-[#202C33] border-b border-white/5">
                            <button type="button" onClick={(e) => handleChatSubmit(e, "@bull What are the upside catalysts?")} className="touch-target whitespace-nowrap bg-[#2A3942] hover:bg-[#344550] text-xs px-3 py-1.5 rounded-full text-white/70 transition-colors">Ask the Bull</button>
                            <button type="button" onClick={(e) => handleChatSubmit(e, "@bear What are the macro risks?")} className="touch-target whitespace-nowrap bg-[#2A3942] hover:bg-[#344550] text-xs px-3 py-1.5 rounded-full text-white/70 transition-colors">Assess Risks</button>
                            <button type="button" onClick={(e) => handleChatSubmit(e, "@quant What are the key technical levels?")} className="touch-target whitespace-nowrap bg-[#2A3942] hover:bg-[#344550] text-xs px-3 py-1.5 rounded-full text-white/70 transition-colors">Technical Outlook</button>
                        </div>

                        {/* Interactive Input Area */}
                        <form onSubmit={(e) => handleChatSubmit(e)} className="bg-[#202C33] px-3 pb-safe pt-1 flex items-center gap-2 sm:gap-3 shrink-0">
                            <button type="button" aria-label="Add attachment (coming soon)" className="touch-target p-1.5 text-white/40 hover:text-white transition-colors">
                                <Plus className="w-6 h-6" />
                            </button>
                            <input
                                type="text"
                                aria-label="Message the AI committee"
                                className="flex-1 bg-[#2A3942] rounded-full px-4 py-2 sm:py-2.5 text-base sm:text-[15px] text-white/90 border border-transparent focus:outline-none focus:border-white/20 transition-colors shadow-inner placeholder-white/30"
                                placeholder="Message @quant, @bull, etc..."
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                disabled={isAgentTyping || !user}
                            />
                            {chatInput.trim() ? (
                                <button type="submit" aria-label="Send message" disabled={isAgentTyping} className="touch-target p-1.5 text-[#00C805] hover:scale-110 transition-transform">
                                    <Send className="w-5 h-5 sm:w-6 sm:h-6" />
                                </button>
                            ) : (
                                <button type="button" aria-label="Voice input (coming soon)" className="touch-target p-1.5 text-white/40 hover:text-white transition-colors">
                                    <Mic className="w-5 h-5 sm:w-6 sm:h-6" />
                                </button>
                            )}
                        </form>

                    </div>
                </section>

                {/* ── SECTION 2: PORTFOLIO MANAGER ── */}
                {user && (
                    <section id="portfolio" className="pt-4 border-t border-[#1E1E24]">
                        <PortfolioManager />
                    </section>
                )}

                {/* ── FOOTER ── */}
                <footer className="pt-16 pb-8 mt-12 border-t border-[#1E1E24]">
                    <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-12">
                        <div className="max-w-xs">
                            <div className="flex items-center gap-2 mb-4">
                                <img src="/logo.svg" alt="ConsensusAI Logo" className="w-4 h-4" />
                                <span className="font-semibold tracking-tight text-white/50">ConsensusAI</span>
                            </div>
                            <p className="text-xs text-white/40 leading-relaxed">
                                Advanced multi-agent framework analyzing quantitative and fundamental market structures in real-time.
                            </p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-10 sm:gap-16">
                            <div>
                                <h4 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-4">Platform</h4>
                                <ul className="space-y-3 text-sm text-white/40">
                                    <li><span className="flex items-center gap-1.5">Screener <span className="text-[9px] bg-white/5 text-white/25 px-1.5 py-0.5 rounded-full">Coming Soon</span></span></li>
                                    <li><span className="flex items-center gap-1.5">Market Map <span className="text-[9px] bg-white/5 text-white/25 px-1.5 py-0.5 rounded-full">Coming Soon</span></span></li>
                                    <li><span className="flex items-center gap-1.5">Agent Logs <span className="text-[9px] bg-white/5 text-white/25 px-1.5 py-0.5 rounded-full">Coming Soon</span></span></li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-4">Account</h4>
                                <ul className="space-y-3 text-sm text-white/40">
                                    <li><span className="flex items-center gap-1.5">Settings <span className="text-[9px] bg-white/5 text-white/25 px-1.5 py-0.5 rounded-full">Coming Soon</span></span></li>
                                    <li><button type="button" onClick={() => document.getElementById('portfolio')?.scrollIntoView({ behavior: 'smooth' })} className="touch-target hover:text-white transition-colors">Portfolio</button></li>
                                    <li><span className="flex items-center gap-1.5">API Keys <span className="text-[9px] bg-white/5 text-white/25 px-1.5 py-0.5 rounded-full">Coming Soon</span></span></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-[#1E1E24]/50 gap-4">
                        <p className="text-xs text-white/30 font-medium">© 2026 ConsensusAI Technologies. All rights reserved.</p>
                        <p className="text-[10px] text-white/20 uppercase tracking-widest font-bold">Pure Data • No Noise</p>
                    </div>
                </footer>

                {/* ── INLINE AI PAYWALL ── */}
                <AnimatePresence>
                    {showPaywall && (
                        <motion.section
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="pt-8 mb-16 border-t border-[#1E1E24]"
                        >
                            <div className="bg-[#111114] border border-white/10 p-8 md:p-12 rounded-3xl w-full text-center relative overflow-hidden shadow-2xl mt-4">
                                {/* Decorative glow */}
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-[#00C805]/10 blur-[60px] pointer-events-none" />

                                <div className="mx-auto w-16 h-16 bg-[#1A1A1E] border border-[#00C805]/20 rounded-2xl flex items-center justify-center mb-6 relative z-10">
                                    <Lock className="w-8 h-8 text-[#00C805]" />
                                    <div className="absolute -top-2 -right-2 bg-black rounded-full p-1 border border-white/10">
                                        <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                                    </div>
                                </div>

                                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4 relative z-10">
                                    {!user ? "Unlock Premium AI Analysis" : "Upgrade to Pro"}
                                </h2>

                                <div className="text-white/60 mb-8 leading-relaxed max-w-xl mx-auto space-y-4 relative z-10">
                                    <p className="text-lg">
                                        Our proprietary AI algorithm is developed based on hundreds of financial studies and market research papers to achieve the most accurate automated analysis possible.
                                    </p>
                                    <p className="font-medium text-white/80">
                                        {!user
                                            ? "Create a 100% free account today to get your first full AI analysis on the house."
                                            : "You've used your free analysis. Upgrade to ConsensusAI Pro for unlimited scans, live market vectors, and real-time agent debates."}
                                    </p>
                                </div>

                                <div className="max-w-sm mx-auto space-y-4 relative z-10">
                                    {!user ? (
                                        <button
                                            type="button"
                                            onClick={handleGoogleLogin}
                                            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-black font-bold text-lg bg-[#00C805] hover:bg-[#00e005] transition-all shadow-[0_0_20px_rgba(0,200,5,0.2)] hover:shadow-[0_0_30px_rgba(0,200,5,0.3)] transform hover:scale-[1.02]"
                                        >
                                            Get 1 Free Analysis
                                        </button>
                                    ) : (
                                        <a
                                            href="mailto:netanel18999@gmail.com?subject=ConsensusAI Pro Upgrade"
                                            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-black font-bold text-lg bg-[#00C805] hover:bg-[#00e005] transition-all shadow-[0_0_20px_rgba(0,200,5,0.2)] hover:shadow-[0_0_30px_rgba(0,200,5,0.3)] transform hover:scale-[1.02]"
                                        >
                                            Unlock Unlimited Access
                                        </a>
                                    )}
                                </div>
                            </div>
                        </motion.section>
                    )}
                </AnimatePresence>

            </main>

            {/* ── MOBILE BOTTOM NAVIGATION ── */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#000000]/95 backdrop-blur-xl border-t border-white/10 flex items-center justify-around px-2 pb-safe">
                <button
                    type="button"
                    onClick={onBack || (() => window.location.reload())}
                    aria-label="Go to home dashboard"
                    className="touch-target flex flex-col items-center justify-center gap-1 py-2.5 px-4 text-white/40 hover:text-white transition-colors"
                >
                    <LayoutDashboard className="w-5 h-5" />
                    <span className="text-[10px] font-medium">Home</span>
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (!user) handleGoogleLogin();
                        else document.getElementById('portfolio')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    aria-label="Open portfolio"
                    className="touch-target flex flex-col items-center justify-center gap-1 py-2.5 px-4 text-white/40 hover:text-white transition-colors"
                >
                    <Briefcase className="w-5 h-5" />
                    <span className="text-[10px] font-medium">Portfolio</span>
                </button>
                {user ? (
                    <button
                        type="button"
                        onClick={handleLogout}
                        aria-label="Sign out"
                        className="touch-target flex flex-col items-center justify-center gap-1 py-2.5 px-4 text-white/40 hover:text-[#FF5000] transition-colors"
                    >
                        <LogOut className="w-5 h-5" />
                        <span className="text-[10px] font-medium">Sign Out</span>
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={handleGoogleLogin}
                        aria-label="Sign in"
                        className="touch-target flex flex-col items-center justify-center gap-1 py-2.5 px-4 text-[#00C805] transition-colors"
                    >
                        <User className="w-5 h-5" />
                        <span className="text-[10px] font-medium">Sign In</span>
                    </button>
                )}
            </nav>
        </div >
    );
}

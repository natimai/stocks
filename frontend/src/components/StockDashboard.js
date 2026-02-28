'use client';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, ArrowLeft,
    TrendingUp, TrendingDown, Clock, Search, Briefcase, Zap, AlertTriangle, CheckCircle2,
    LayoutDashboard, ScanLine, User, LogOut, Lock, Star
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import CommandPalette from './CommandPalette';
import RollingPrice from './RollingPrice';
import { auth, googleProvider } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

// ─── MOCK DATA (AAPL - Score 77 - BUY - Up) ─────────────────────────────────
const MOCK = {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    score: 77,
    recommendation: 'BUY',
    summary: 'Apple is positioned to benefit from the next AI hardware supercycle. The iPhone 17 Pro refresh cycle, combined with Apple Intelligence feature rollouts, points to sustained ASP expansion and margin improvement through Q2 2026.',
    price: 213.49,
    changePercent: 1.2,
    market_cap: 3280000000000,
    metrics: {
        P_E_Ratio: 34.76,
        P_B_Ratio: 48.2,
        ROE_pct: 156.1,
        Debt_to_Equity: 1.76,
        '5Y_EPS_Growth_Rate_pct': 14.3,
        PEG_Ratio: 2.19,
        Free_Cash_Flow_Yield_pct: 3.8,
        Recent_EPS_Revision_Trend: 'Upward',
    },
    technicals: {
        SMA_50: 198.22,
        SMA_200: 185.67,
        RSI_14: 62.4,
        MACD_Signal: 'Bullish Crossover',
        Williams_R: -25.5,
        Volume_Momentum: 'Expanding',
    },
    ai_analysis: {
        sub_scores: { Fundamental: 70, Technical: 88, Sentiment: 72, Macro_Risk: 55 },
        xai_rationale: {
            Top_Positive_Drivers: [
                'RSI at 62.4 — bullish momentum without overbought conditions',
                'Bullish MACD crossover confirmed on daily timeframe',
                'FCF yield of 3.8% supports continued buyback program',
                'Price above both SMA-50 and SMA-200 — healthy trend structure',
            ],
            Top_Negative_Drivers: [
                'P/E of 34.76 is 39% premium to sector median (25.0)',
                'High D/E ratio of 1.76 limits balance-sheet flexibility',
                'VIX elevated at 18.2 — macro uncertainty persists',
                'China revenue risk from tariff escalation cycle',
            ],
        },
        debate: {
            bull: "Stop obsessing over the headline P/E of 34.76. True market leaders command a premium. Apple's ecosystem monetization — Services ARPU growing 14% YoY, Vision Pro seeding the next platform — justifies every multiple basis point. I'm targeting $240.",
            bear: "The China drag is real. 19% of revenue from a region where Huawei is clawing back domestic market share, in an environment of escalating US-China trade tensions. Additionally, a P/E of 34.76 at a 39% premium to sector leaves zero margin of safety. Any macro shock and this stock corrects 20%.",
            quant: "RSI at 62 — momentum positive but not euphoric. MACD bullish crossover confirmed 3 sessions ago with above-average volume (+12%). Williams %R at -25.5 shows buyers in control but approaching short-term overbought. Holding above SMA-50 ($198.22) is the key support level to monitor.",
            cio: "The debate is balanced. Fundamental richness is real but not disqualifying given the FCF generation. Technical trend is constructive. I am scoring AAPL a 77 — a measured BUY. Position sizing should reflect the valuation risk. Set a stop at $195 (below SMA-50).",
        },
    },
    chartData: (() => {
        // Generate 90 data points across a mock intraday from ~9:30 AM to 4:00 PM
        const points = [];
        let price = 185;
        const startMinutes = 9 * 60 + 30; // 9:30 AM in minutes
        for (let i = 0; i < 90; i++) {
            const totalMins = startMinutes + i * 4; // every 4 minutes → 90 points = ~6 hours
            const h = Math.floor(totalMins / 60);
            const m = totalMins % 60;
            const period = h >= 12 ? 'PM' : 'AM';
            const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
            const label = `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
            price = price + Math.sin(i * 0.1) * 0.5 + 0.1 + (Math.random() - 0.48) * 1.5;
            points.push({ date: label, close: parseFloat(price.toFixed(2)) });
        }
        return points;
    })(),
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = (n) => n != null ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n) : 'N/A';
const fmtPct = (v) => v != null ? `${v >= 0 ? '+' : ''}${Math.abs(Number(v)).toFixed(2)}%` : 'N/A';
const fmtVal = (v) => v == null ? 'N/A' : typeof v === 'number' ? Number(v).toFixed(2) : v;

// ─── TOOLTIPS ─────────────────────────────────────────────────────────────────
function ChartTip({ active, payload, trendColor, setHoverPrice, setHoverDate }) {
    useEffect(() => {
        if (active && payload && payload.length > 0) {
            setHoverPrice(payload[0].value);
            setHoverDate(payload[0].payload?.date);
        } else {
            setHoverPrice(null);
            setHoverDate(null);
        }
    }, [active, payload, setHoverPrice, setHoverDate]);

    if (!active || !payload?.length) return null;
    return (
        <div style={{ background: '#1E1E24', border: `1px solid ${trendColor}40`, borderRadius: 6, padding: '6px 10px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
            <span style={{ color: trendColor, fontWeight: 600, fontSize: 13, display: 'block' }}>${Number(payload[0].value).toFixed(2)}</span>
            <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginTop: 2 }}>{payload[0].payload.date}</span>
        </div>
    );
}

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

export default function StockDashboard({ initialTicker, onBack }) {
    // ── STATE ──
    const [ticker, setTicker] = useState(initialTicker || 'AAPL');
    const [data, setData] = useState(null);          // null until first API response
    const [loading, setLoading] = useState(false);
    const [chartLoading, setChartLoading] = useState(false);
    const [streamMsg, setStreamMsg] = useState('');
    const [liveDebate, setLiveDebate] = useState({ bull: '', bear: '', quant: '', cio: '' });

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

    // Track Auth State + fetch user profile from Firestore
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            if (currentUser) {
                try {
                    const token = await currentUser.getIdToken();
                    const res = await fetch(
                        `https://quantai-backend-316459358121.europe-west1.run.app/api/user-profile`,
                        { headers: { Authorization: `Bearer ${token}` } }
                    );
                    if (res.ok) {
                        const profile = await res.json();
                        setUserProfile(profile);
                    }
                } catch (e) {
                    // profile fetch failed — treat as free user
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
        setChartLoading(true);
        try {
            const res = await fetch(`https://quantai-backend-316459358121.europe-west1.run.app/api/chart/${sym}?period=${period}&interval=${interval}`);
            if (!res.ok) return;
            const raw = await res.json();
            if (!Array.isArray(raw) || raw.length === 0) return;

            // Normalize to {date, close} shape expected by the AreaChart
            const normalized = raw.map(c => ({
                date: typeof c.time === 'number'
                    ? new Date(c.time * 1000).toLocaleTimeString('en-US', {
                        hour: '2-digit', minute: '2-digit',
                        timeZone: 'America/New_York'
                    })
                    : c.time,
                _ts: typeof c.time === 'number' ? c.time : null, // raw unix timestamp for filtering
                close: c.close ?? c.value,
                open: c.open,
                high: c.high,
                low: c.low,
                volume: c.volume,
            }));

            setActiveChartData(normalized);

            // Compute change % for this window: (last - first) / first * 100
            const first = normalized[0]?.close;
            const last = normalized[normalized.length - 1]?.close;
            if (first && last && first !== 0) {
                setDisplayChangePercent(((last - first) / first) * 100);
            }
        } catch (e) {
            console.warn('Chart fetch error:', e);
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
        if (!selectedTicker) return;
        setTicker(selectedTicker);
        setLoading(true);
        setData(null);
        setAiStarted(false);
        setShowPaywall(false);
        setLiveDebate({ bull: '', bear: '', quant: '', cio: '' });
        setStreamMsg('');

        try {
            const fastRes = await fetch(`https://quantai-backend-316459358121.europe-west1.run.app/api/quick-stats/${selectedTicker}`);
            if (!fastRes.ok) throw new Error('Invalid ticker');
            const fast = await fastRes.json();
            setData(fast);
            const defaultTF = '1M';
            setTimeframe(defaultTF);
            await fetchChart.current(selectedTicker, defaultTF);
        } catch (err) {
            setStreamMsg('Error: Could not retrieve data. Try another ticker.');
        } finally {
            setLoading(false);
        }
    };

    // ── SLOW PATH: Run AI analysis (requires auth) ──
    const runAiAnalysis = async (selectedTicker) => {
        if (!selectedTicker) return;
        setAiStarted(true);
        setLoading(true);
        setStreamMsg('Verifying access & Initializing FinDebate AI Framework...');

        let idToken = '';
        if (user) {
            idToken = await user.getIdToken();
        } else {
            setShowPaywall(true);
            setLoading(false);
            return;
        }

        try {
            const slowRes = await fetch(`https://quantai-backend-316459358121.europe-west1.run.app/api/analyze/${selectedTicker}`, {
                headers: { 'Authorization': `Bearer ${idToken}` }
            });

            if (slowRes.status === 403 || slowRes.status === 401) {
                setShowPaywall(true);
                setLoading(false);
                return;
            }

            if (slowRes.ok && slowRes.body) {
                const reader = slowRes.body.getReader();
                const decoder = new TextDecoder();
                let done = false;
                let buffer = '';
                let currentDebate = { bull: '', bear: '', quant: '', cio: '' };

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
                                        currentDebate[parsed.agent] = parsed.text;
                                        setLiveDebate({ ...currentDebate });
                                    } else if (parsed.type === 'complete') {
                                        setData(parsed.data);
                                        setLiveDebate(parsed.data.ai_analysis.debate || currentDebate);
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
    const handleSearch = async (selectedTicker) => {
        await loadStockData(selectedTicker);
        if (!authLoading) {
            await runAiAnalysis(selectedTicker);
        }
    };

    // Safe extraction
    const display = data || {};
    const sub = display?.ai_analysis?.sub_scores || null;
    const xai = display?.ai_analysis?.xai_rationale || null;
    // Use activeChartData (driven by timeframe) instead of static chartData from server
    const rawChartData = activeChartData.length > 0 ? activeChartData : (display?.chartData || []);

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

    // Debate Agents Array for sequential rendering
    const debateAgents = [
        { key: 'bull', icon: '🐂', name: 'The Bull', role: 'Fundamental Value', text: liveDebate.bull },
        { key: 'bear', icon: '🐻', name: 'The Bear', role: 'Macro Risk', text: liveDebate.bear },
        { key: 'quant', icon: '🤖', name: 'The Quant', role: 'Technical Momentum', text: liveDebate.quant },
        { key: 'cio', icon: '⚖️', name: 'The CIO', role: 'Chief Investment Officer', text: liveDebate.cio || (sub ? (display.summary || "Debate Concluded.") : "") }
    ];

    return (
        <div suppressHydrationWarning className="min-h-screen font-sans bg-[#000000] text-white selection:bg-white/20 pb-20">

            {/* ── TOP NAV (Minimalist) ── */}
            <header suppressHydrationWarning className="sticky top-0 z-50 bg-[#000000]/90 backdrop-blur-md border-b-0">
                <div suppressHydrationWarning className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4 md:gap-6">
                    {/* Logo / Back Button */}
                    <div className="flex items-center gap-3">
                        {onBack && (
                            <button
                                onClick={onBack}
                                className="flex items-center gap-1.5 text-white/40 hover:text-white transition-colors text-sm font-medium group"
                            >
                                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                                <span className="hidden sm:inline">Home</span>
                            </button>
                        )}
                        <div className="flex items-center gap-2 group cursor-pointer" onClick={onBack || (() => window.location.reload())}>
                            <div className="shrink-0 w-8 h-8 rounded-full bg-[#1E1E24] flex items-center justify-center transition-colors group-hover:bg-white/10">
                                <Activity className="w-4 h-4 text-white" />
                            </div>
                            <span className="hidden sm:inline-block font-semibold tracking-tight text-lg text-white/90">Quant<span className="text-white">AI</span></span>
                        </div>
                    </div>

                    {/* Search Bar - Taking middle space */}
                    <div className="flex-1 max-w-sm relative z-50">
                        <div className="opacity-90 hover:opacity-100 transition-opacity">
                            <CommandPalette onSelect={handleSearch} />
                        </div>
                    </div>

                    {/* Right Nav Links */}
                    <div className="hidden md:flex items-center gap-6 text-sm font-medium">
                        <button className="text-white/50 hover:text-white transition-colors">Portfolio</button>
                        <button className="text-white/50 hover:text-white transition-colors">Screener</button>
                        <button className="text-white/50 hover:text-white transition-colors">History</button>
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
                                    onClick={handleLogout}
                                    className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-[#FF5000]"
                                    title="Logout"
                                >
                                    <LogOut className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleGoogleLogin}
                                className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
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

            <main className="max-w-4xl mx-auto px-4 mt-8 space-y-16">

                {/* ── SECTION 1: THE AI COCKPIT ── */}
                <section className="flex flex-col md:flex-row justify-between items-start md:items-end gap-8 pt-4">
                    {/* Left: Ticker & Price */}
                    <div className="flex flex-col gap-2 items-start flex-1">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full overflow-hidden bg-white/10 flex items-center justify-center shrink-0 border border-white/5">
                                <img
                                    src={`https://img.logokit.com/ticker/${display?.ticker || ticker}?token=pk_frfa213068bb8ffac35321&size=128&fallback=monogram`}
                                    alt={`${display?.ticker || ticker} logo`}
                                    className="w-full h-full object-contain p-1.5"
                                    onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                                />
                            </div>
                            <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tight text-white/90 leading-none m-0">
                                {display?.name || display?.ticker || ticker}
                            </h1>
                        </div>

                        <div className="flex flex-col mt-3">
                            {/* Massive Price with slot-machine animation */}
                            <div className="text-[52px] sm:text-[64px] font-medium tracking-tight mb-1 leading-none flex items-center" style={{ fontFamily: 'SF Pro Display, Inter, sans-serif' }}>
                                <RollingPrice price={currentDisplayPrice} />
                            </div>
                            {/* Amount & Change % */}
                            {(currentDisplayChange != null) && (
                                <div className="text-[17px] font-semibold mt-1 flex items-center gap-1.5" style={{ color: TREND_COLOR }}>
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
                            <div className="text-[64px] md:text-[80px] leading-none font-bold tracking-tighter" style={{ color: TREND_COLOR }}>
                                {display.score}
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 mt-2 pr-1">
                                <span className="text-xs sm:text-sm font-medium text-white/40 uppercase tracking-widest">AI Score</span>
                                <div className="px-3 md:px-4 py-1.5 rounded-full text-[10px] md:text-xs font-bold tracking-widest uppercase shrink-0"
                                    style={{ backgroundColor: TREND_COLOR, color: '#000' }}>
                                    {display.recommendation || 'HOLD'}
                                </div>
                            </div>
                        </div>
                    ) : (
                        (loading || streamMsg.includes('Error')) && (
                            <div className={`flex flex-col items-start md:items-end ${!loading ? 'opacity-80' : 'opacity-50'}`}>
                                <Activity className={`w-12 h-12 mb-4 ${loading ? 'animate-pulse' : ''}`} style={{ color: loading ? TREND_COLOR : '#FF5000' }} />
                                <div className={`text-xs font-medium uppercase tracking-widest max-w-[200px] text-left md:text-right ${loading ? 'text-white/50 animate-pulse' : 'text-[#FF5000]'}`}>
                                    {streamMsg || 'AI Calculating...'}
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
                    {/* Timeframe Toggles — each click fetches real chart data & recomputes % */}
                    <div className="flex items-center gap-1 sm:gap-2 mb-6 overflow-x-auto pb-2 scrollbar-none w-full border-b border-[#1E1E24] pb-4">
                        {['1D', '1W', '1M', '3M', 'YTD', '1Y', '5Y', 'ALL'].map(tf => (
                            <button key={tf}
                                onClick={() => {
                                    setTimeframe(tf);
                                    const sym = display?.ticker || ticker;
                                    fetchChart.current(sym, tf);
                                }}
                                className={`px-4 py-2 rounded-lg text-[13px] font-bold transition-all shrink-0
                                    ${timeframe === tf ? 'text-black bg-white shadow-sm' : 'text-white/40 hover:text-white/80 hover:bg-white/5 bg-transparent'}`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>

                    {/* Minimalist Area Chart */}
                    <div className="h-[240px] sm:h-[300px] w-full relative">
                        {chartLoading && (
                            <div className="absolute inset-0 flex items-center justify-center z-10">
                                <Activity className="w-5 h-5 animate-pulse text-white/30" />
                            </div>
                        )}
                        {chartData && chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart
                                    data={chartData}
                                    margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
                                    onMouseLeave={() => {
                                        setHoverPrice(null);
                                        setHoverDate(null);
                                    }}
                                >
                                    <XAxis
                                        dataKey="date"
                                        hide={true} // Cleanest SoFi vibe: no x-axis text by default
                                    />
                                    <YAxis
                                        domain={['auto', 'auto']}
                                        hide={true}
                                    />
                                    <Tooltip
                                        cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeDasharray: '4 4' }}
                                        content={
                                            <ChartTip
                                                trendColor={TREND_COLOR}
                                                setHoverPrice={setHoverPrice}
                                                setHoverDate={setHoverDate}
                                            />
                                        }
                                        position={{ y: 0 }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="close"
                                        stroke={TREND_COLOR}
                                        strokeWidth={2}
                                        dot={false}
                                        activeDot={{ r: 4, fill: TREND_COLOR, stroke: '#000', strokeWidth: 2 }}
                                        isAnimationActive={false}
                                        connectNulls={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Activity className="w-6 h-6 animate-pulse text-white/20" />
                            </div>
                        )}
                    </div>
                </section>

                {/* ── SECTION 2: TECHNICAL & FUNDAMENTAL GRID ── */}
                {(display?.metrics || display?.technicals || radarData.length > 0) && (
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-8 border-t border-[#1E1E24] pt-12">
                        {/* Column 1: Fundamentals */}
                        {display?.metrics && (
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2">Fundamentals</h3>
                                {[
                                    { label: 'Market Cap', val: `$${fmt(display?.market_cap)}` },
                                    { label: 'P/E Ratio', val: fmtVal(display?.metrics?.P_E_Ratio) },
                                    { label: 'P/B Ratio', val: fmtVal(display?.metrics?.P_E_Ratio) },
                                    { label: 'PEG Ratio', val: fmtVal(display?.metrics?.PEG_Ratio) },
                                    { label: 'D/E Ratio', val: fmtVal(display?.metrics?.Debt_to_Equity) },
                                ].map(m => (
                                    <div key={m.label} className="flex justify-between items-center text-sm">
                                        <span className="text-white/50">{m.label}</span>
                                        <span className="font-medium">{m.val}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Column 2: Technicals */}
                        {display?.technicals && (
                            <div className="space-y-4">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2">Technicals</h3>
                                {[
                                    { label: 'SMA 50', val: `$${fmtVal(display?.technicals?.SMA_50)}` },
                                    { label: 'SMA 200', val: `$${fmtVal(display?.technicals?.SMA_200)}` },
                                    { label: 'RSI 14', val: fmtVal(display?.technicals?.RSI_14) },
                                    { label: 'MACD', val: display?.technicals?.MACD_Signal || 'N/A' },
                                    { label: 'Williams %R', val: fmtVal(display?.technicals?.Williams_R) },
                                ].map(m => (
                                    <div key={m.label} className="flex justify-between items-center text-sm">
                                        <span className="text-white/50">{m.label}</span>
                                        <span className="font-medium text-right">{m.val}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Column 3: Radar Chart */}
                        {radarData.length > 0 && (
                            <div className="flex flex-col items-center justify-center">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-0 self-start md:self-center">Vector Analysis</h3>
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

                {/* ── AI ANALYSIS CTA ── shown when market data is loaded and AI hasn't been triggered */}
                {data && !aiStarted && !showPaywall && (
                    <motion.section
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="pt-8 border-t border-[#1E1E24]"
                    >
                        <div className="bg-[#111114] border border-[#00C805]/20 rounded-3xl p-8 md:p-10 text-center relative overflow-hidden">
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-[#00C805]/8 blur-[50px] pointer-events-none" />
                            <Zap className="w-8 h-8 text-[#00C805] mx-auto mb-4 relative z-10" />
                            <h3 className="text-2xl font-bold text-white mb-2 relative z-10">Run AI Analysis</h3>
                            <p className="text-white/50 text-sm mb-6 max-w-md mx-auto relative z-10">
                                Our multi-agent AI framework — built on hundreds of financial studies — will debate the bull, bear, quant, and macro case for <strong className="text-white/80">{ticker}</strong>.
                            </p>
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 relative z-10">
                                {!user ? (
                                    <button
                                        onClick={handleGoogleLogin}
                                        className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-[#00C805] hover:bg-[#00e005] text-black font-bold text-base transition-all shadow-[0_0_20px_rgba(0,200,5,0.2)] hover:shadow-[0_0_30px_rgba(0,200,5,0.35)] hover:scale-[1.03]"
                                    >
                                        <Zap className="w-4 h-4" /> Sign in for 1 Free Analysis
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => runAiAnalysis(ticker)}
                                        className="flex items-center gap-2 px-8 py-3.5 rounded-xl bg-[#00C805] hover:bg-[#00e005] text-black font-bold text-base transition-all shadow-[0_0_20px_rgba(0,200,5,0.2)] hover:shadow-[0_0_30px_rgba(0,200,5,0.35)] hover:scale-[1.03]"
                                    >
                                        <Zap className="w-4 h-4" /> Start AI Analysis
                                    </button>
                                )}
                                {user && userProfile?.isPro && (
                                    <span className="text-xs text-white/30 flex items-center gap-1">
                                        <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                                        Pro — Unlimited
                                    </span>
                                )}
                                {user && !userProfile?.isPro && (
                                    <span className="text-xs text-white/30">
                                        {1 - (userProfile?.analysisCount || 0)} free analysis remaining
                                    </span>
                                )}
                            </div>
                        </div>
                    </motion.section>
                )}

                {/* ── SECTION 5: AI AGENTS DEBATE ROOM ── */}
                <section className="pt-8 border-t border-[#1E1E24]">
                    <div className="mb-8">
                        <h2 className="text-2xl font-semibold tracking-tight">AI Debate Thread</h2>
                        <p className="text-sm text-white/50 mt-1">Live synthesis from 4 autonomous specialist agents.</p>
                    </div>

                    <div className="space-y-8 pl-2 border-l border-[#1E1E24]/50 ml-4 pb-8">
                        <AnimatePresence>
                            {debateAgents.map((agent, i) => {
                                if (!agent.text) return null; // Only render if agent has spoken

                                return (
                                    <motion.div
                                        key={agent.key}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.5, ease: "easeOut" }}
                                        className="relative pl-8"
                                    >
                                        {/* Connector Line */}
                                        <div className="absolute top-4 -left-[0.5px] w-6 border-t border-[#1E1E24]/50"></div>
                                        <div className="absolute -left-4 sm:-left-3 top-2 sm:top-2.5 bg-[#1E1E24] w-8 h-8 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-xs sm:text-[10px] md:text-xs">
                                            {agent.icon}
                                        </div>

                                        <div className="bg-[#1E1E24] rounded-2xl rounded-tl-sm p-4 sm:p-5 inline-block max-w-[95%] sm:max-w-[85%] md:max-w-[80%]">
                                            <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                                                <span className="text-sm font-bold text-white/90">{agent.name}</span>
                                                <span className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest">{agent.role}</span>
                                            </div>
                                            <p className="text-[14px] sm:text-[15px] leading-relaxed text-white/80">
                                                {agent.text}
                                            </p>
                                        </div>
                                    </motion.div>
                                );
                            })}

                            {/* Stream Loading Indicator */}
                            {loading && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="relative pl-8"
                                >
                                    <div className="absolute top-4 -left-[0.5px] w-6 border-t border-[#1E1E24]/50"></div>
                                    <div className="bg-[#1E1E24] rounded-2xl rounded-tl-sm px-5 py-3 inline-flex items-center gap-3">
                                        <div className="flex gap-1">
                                            <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce delay-75"></span>
                                            <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce delay-150"></span>
                                            <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce delay-300"></span>
                                        </div>
                                        <span className="text-xs font-medium text-white/40 uppercase tracking-widest">{streamMsg}</span>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </section>

                {/* ── FOOTER ── */}
                <footer className="pt-16 pb-8 mt-12 border-t border-[#1E1E24]">
                    <div className="flex flex-col md:flex-row justify-between items-start gap-8 mb-12">
                        <div className="max-w-xs">
                            <div className="flex items-center gap-2 mb-4">
                                <Activity className="w-4 h-4 text-white/50" />
                                <span className="font-semibold tracking-tight text-white/50">QuantAI</span>
                            </div>
                            <p className="text-xs text-white/40 leading-relaxed">
                                Advanced multi-agent framework analyzing quantitative and fundamental market structures in real-time.
                            </p>
                        </div>
                        <div className="flex gap-16">
                            <div>
                                <h4 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-4">Platform</h4>
                                <ul className="space-y-3 text-sm text-white/40">
                                    <li><button className="hover:text-white transition-colors">Screener</button></li>
                                    <li><button className="hover:text-white transition-colors">Market Map</button></li>
                                    <li><button className="hover:text-white transition-colors">Agent Logs</button></li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-4">Account</h4>
                                <ul className="space-y-3 text-sm text-white/40">
                                    <li><button className="hover:text-white transition-colors">Settings</button></li>
                                    <li><button className="hover:text-white transition-colors">Billing</button></li>
                                    <li><button className="hover:text-white transition-colors">API Keys</button></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-[#1E1E24]/50 gap-4">
                        <p className="text-xs text-white/30 font-medium">© 2026 QuantAI Technologies. All rights reserved.</p>
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
                                            : "You've used your free analysis. Upgrade to QuantAI Pro for unlimited scans, live market vectors, and real-time agent debates."}
                                    </p>
                                </div>

                                <div className="max-w-sm mx-auto space-y-4 relative z-10">
                                    {!user ? (
                                        <button
                                            onClick={handleGoogleLogin}
                                            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-black font-bold text-lg bg-[#00C805] hover:bg-[#00e005] transition-all shadow-[0_0_20px_rgba(0,200,5,0.2)] hover:shadow-[0_0_30px_rgba(0,200,5,0.3)] transform hover:scale-[1.02]"
                                        >
                                            Get 1 Free Analysis
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => window.location.href = '#upgrade'}
                                            className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-black font-bold text-lg bg-[#00C805] hover:bg-[#00e005] transition-all shadow-[0_0_20px_rgba(0,200,5,0.2)] hover:shadow-[0_0_30px_rgba(0,200,5,0.3)] transform hover:scale-[1.02]"
                                        >
                                            Unlock Unlimited Access
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.section>
                    )}
                </AnimatePresence>

            </main>
        </div >
    );
}

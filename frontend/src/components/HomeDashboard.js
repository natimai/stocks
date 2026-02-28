'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, Search, TrendingUp, TrendingDown, BarChart2,
    Zap, Scale, Clock, ArrowRight, ChevronRight, Sparkles,
    LayoutDashboard, ScanLine, Briefcase, User, LogOut, Lock
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

// ─── MOCK DATA ──────────────────────────────────────────────────────────────
const TOP_PICKS_TICKERS = [
    { ticker: 'NVDA', name: 'NVIDIA Corp.' },
    { ticker: 'AAPL', name: 'Apple Inc.' },
    { ticker: 'META', name: 'Meta Platforms' },
    { ticker: 'TSLA', name: 'Tesla Inc.' },
];

const RECENT_SCANS_TICKERS = ['MSFT', 'AMZN', 'GOOGL', 'JPM', 'SPY', 'COIN'];

const TYPEWRITER_SUGGESTIONS = [
    'Try analyzing NVDA...',
    'Try searching for AAPL...',
    'Analyze Tesla\'s sentiment...',
    'What\'s the AI score for META?',
    'Run a scan on MSFT...',
    'Analyze Amazon\'s fundamentals...',
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getScoreColor(score) {
    if (score >= 70) return '#00C805';
    if (score >= 50) return '#FFB800';
    return '#FF5000';
}

function getSignalBg(signal) {
    if (signal === 'STRONG BUY' || signal === 'BUY') return '#00C805';
    if (signal === 'HOLD') return '#FFB800';
    return '#FF5000';
}

// ─── MINI SPARKLINE ───────────────────────────────────────────────────────────
function Sparkline({ data, color, width = 80, height = 36 }) {
    if (!data || data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((v - min) / range) * height;
        return `${x},${y}`;
    });
    const pathD = `M ${pts.join(' L ')}`;
    const fillPts = `M 0,${height} L ${pts.join(' L ')} L ${width},${height} Z`;

    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
            <defs>
                <linearGradient id={`sg-${data[0]}-${color}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={fillPts} fill={`url(#sg-${data[0]}-${color})`} />
            <path d={pathD} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// ─── TYPEWRITER COMPONENT ─────────────────────────────────────────────────────
function TypewriterText({ suggestions }) {
    const [index, setIndex] = useState(0);
    const [displayed, setDisplayed] = useState('');
    const [phase, setPhase] = useState('typing'); // typing | pausing | erasing

    useEffect(() => {
        const current = suggestions[index];
        let timeout;

        if (phase === 'typing') {
            if (displayed.length < current.length) {
                timeout = setTimeout(() => setDisplayed(current.slice(0, displayed.length + 1)), 55);
            } else {
                timeout = setTimeout(() => setPhase('pausing'), 1800);
            }
        } else if (phase === 'pausing') {
            timeout = setTimeout(() => setPhase('erasing'), 400);
        } else if (phase === 'erasing') {
            if (displayed.length > 0) {
                timeout = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 28);
            } else {
                setIndex((i) => (i + 1) % suggestions.length);
                setPhase('typing');
            }
        }
        return () => clearTimeout(timeout);
    }, [displayed, phase, index, suggestions]);

    return (
        <span className="text-white/30 text-sm font-normal">
            {displayed}
            <span className="inline-block w-px h-3.5 bg-white/30 ml-0.5 animate-pulse align-middle" />
        </span>
    );
}

// ─── STOCK CARD (TOP PICKS) ───────────────────────────────────────────────────
function StockCard({ stock, onSearch, index }) {
    const isUp = stock.change >= 0;
    const color = getScoreColor(stock.score);
    const sparkColor = isUp ? '#00C805' : '#FF5000';

    return (
        <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -3, transition: { duration: 0.2 } }}
            onClick={() => onSearch(stock.ticker)}
            className="bg-[#111114] rounded-2xl p-5 cursor-pointer flex-shrink-0 w-[220px] md:w-auto"
            style={{ border: '1px solid rgba(255,255,255,0.05)' }}
        >
            {/* Top row */}
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                    <img
                        src={`https://img.logokit.com/ticker/${stock.ticker}?token=pk_frfa213068bb8ffac35321`}
                        alt={`${stock.ticker} logo`}
                        className="w-9 h-9 rounded-full bg-white/5 object-contain p-1 shrink-0"
                        onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                    />
                    <div>
                        <div className="text-base font-bold text-white tracking-tight">{stock.ticker}</div>
                        <div className="text-xs text-white/40 mt-0.5 truncate max-w-[110px]">{stock.name}</div>
                    </div>
                </div>
                <div
                    className="text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full uppercase shrink-0"
                    style={{ backgroundColor: `${getSignalBg(stock.signal)}18`, color: getSignalBg(stock.signal) }}
                >
                    {stock.signal}
                </div>
            </div>

            {/* Sparkline */}
            <div className="my-3">
                <Sparkline data={stock.sparkline} color={sparkColor} width={160} height={44} />
            </div>

            {/* Bottom row */}
            <div className="flex items-end justify-between mt-2">
                <div>
                    <div className="text-lg font-semibold text-white">
                        {stock.price != null ? `$${stock.price.toFixed(2)}` : '---'}
                    </div>
                    <div className="text-xs font-medium mt-0.5" style={{ color: sparkColor }}>
                        {isUp ? '+' : ''}{stock.change != null ? stock.change.toFixed(2) : '0.00'}%
                    </div>
                </div>
                <div className="flex flex-col items-end">
                    <div className="text-3xl font-bold leading-none" style={{ color }}>{stock.score}</div>
                    <div className="text-[10px] text-white/30 uppercase tracking-widest mt-0.5">AI Score</div>
                </div>
            </div>
        </motion.div>
    );
}

// ─── MAIN HOMEPAGE ────────────────────────────────────────────────────────────
export default function HomeDashboard({ onSearch }) {
    const [query, setQuery] = useState('');
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef(null);
    const [livePicks, setLivePicks] = useState(null);   // null = loading
    const [liveScans, setLiveScans] = useState(null);
    const [user, setUser] = useState(null);
    const [userProfile, setUserProfile] = useState(null);

    // Track Auth State and fetch profile
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
                    // Ignore errors
                }
            } else {
                setUserProfile(null);
            }
        });
        return () => unsubscribe();
    }, []);

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

    // Fetch live prices for cards on mount
    useEffect(() => {
        const fetchAll = async () => {
            try {
                // Fetch Top Picks
                const pickResults = await Promise.all(
                    TOP_PICKS_TICKERS.map(async ({ ticker, name }) => {
                        try {
                            const res = await fetch(`https://quantai-backend-316459358121.europe-west1.run.app/api/quick-stats/${ticker}`);
                            if (!res.ok) throw new Error('fail');
                            const d = await res.json();
                            const isUp = (d.changePercent ?? 0) >= 0;
                            // Build a rough sparkline from chartData if available
                            const spark = (d.chartData || []).slice(-12).map(c => c.close);
                            return {
                                ticker,
                                name: d.name || name,
                                price: d.price ?? 0,
                                change: d.changePercent ?? 0,
                                score: d.score ?? 70,
                                signal: d.recommendation ?? (isUp ? 'BUY' : 'HOLD'),
                                sparkline: spark.length >= 2 ? spark : [d.price, d.price],
                            };
                        } catch {
                            return { ticker, name, price: null, change: 0, score: 70, signal: 'BUY', sparkline: [] };
                        }
                    })
                );
                setLivePicks(pickResults);

                // Fetch Recent Scans
                const scanResults = await Promise.all(
                    RECENT_SCANS_TICKERS.map(async (ticker, i) => {
                        try {
                            const res = await fetch(`https://quantai-backend-316459358121.europe-west1.run.app/api/quick-stats/${ticker}`);
                            if (!res.ok) throw new Error('fail');
                            const d = await res.json();
                            const isUp = (d.changePercent ?? 0) >= 0;
                            return {
                                ticker,
                                price: d.price ?? 0,
                                score: d.score ?? 70,
                                signal: d.recommendation ?? (isUp ? 'BUY' : 'HOLD'),
                                ago: `${(i + 1) * 3} mins ago`,
                            };
                        } catch {
                            return { ticker, price: null, score: 70, signal: 'BUY', ago: `${(i + 1) * 3} mins ago` };
                        }
                    })
                );
                setLiveScans(scanResults);
            } catch (e) {
                console.warn('Live picks fetch error:', e);
            }
        };
        fetchAll();
    }, []);

    // Skeleton shimmer card shown while loading
    const SkeletonCard = ({ i }) => (
        <div
            className="bg-[#111114] rounded-2xl p-5 flex-shrink-0 w-[220px] md:w-auto animate-pulse"
            style={{ border: '1px solid rgba(255,255,255,0.05)' }}
        >
            <div className="h-4 w-16 bg-white/10 rounded mb-3" />
            <div className="h-3 w-24 bg-white/5 rounded mb-4" />
            <div className="h-8 w-full bg-white/5 rounded mb-4" />
            <div className="h-5 w-20 bg-white/10 rounded" />
        </div>
    );

    const displayPicks = livePicks ?? TOP_PICKS_TICKERS.map(t => ({ ...t, price: null, change: 0, score: 70, signal: 'BUY', sparkline: [] }));
    const displayScans = liveScans ?? RECENT_SCANS_TICKERS.map((t, i) => ({ ticker: t, price: null, score: 70, signal: 'BUY', ago: `${(i + 1) * 3} mins ago` }));

    const handleSubmit = useCallback((e) => {
        e?.preventDefault();
        const trimmed = query.trim().toUpperCase();
        if (trimmed) onSearch(trimmed);
    }, [query, onSearch]);

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleSubmit();
    };

    // Set global bg
    useEffect(() => {
        document.documentElement.style.backgroundColor = '#000000';
        document.documentElement.style.color = '#FFFFFF';
    }, []);

    return (
        <div className="min-h-screen bg-[#000000] text-white font-sans selection:bg-white/20" suppressHydrationWarning>

            {/* ── SECTION 1: NAVBAR ── */}
            <motion.header
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="sticky top-0 z-50 bg-[#000000]/90 backdrop-blur-xl"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
            >
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    {/* Logo */}
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#00C805]/10 flex items-center justify-center">
                            <Activity className="w-4 h-4 text-[#00C805]" />
                        </div>
                        <span className="font-bold text-lg tracking-tight text-white">
                            Quant<span className="text-[#00C805]">AI</span>
                        </span>
                    </div>

                    {/* Right nav */}
                    <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
                        {[
                            { icon: LayoutDashboard, label: 'Dashboard' },
                            { icon: ScanLine, label: 'Market Scans' },
                            { icon: Briefcase, label: 'My Portfolio' },
                        ].map(({ icon: Icon, label }) => (
                            <button
                                key={label}
                                className="flex items-center gap-1.5 text-white/50 hover:text-white transition-colors duration-200"
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {label}
                            </button>
                        ))}
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
                                                    <span className="text-[#00C805]">PRO</span>
                                                ) : (
                                                    <span>Free ({Math.min(userProfile.analysisCount || 0, 1)}/1)</span>
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
                                <span>Sign in</span>
                            </button>
                        )}
                    </nav>
                </div>
            </motion.header>

            {/* ── SECTION 2: HERO ── */}
            <section className="relative max-w-6xl mx-auto px-6 pt-20 pb-28 text-center overflow-hidden">
                {/* Background ambient glow */}
                <div
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full pointer-events-none"
                    style={{
                        background: 'radial-gradient(ellipse at center, rgba(0,200,5,0.07) 0%, transparent 70%)',
                        filter: 'blur(40px)',
                    }}
                />

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                >
                    {/* Badge */}
                    <div className="inline-flex items-center gap-2 bg-[#111114] rounded-full px-4 py-1.5 mb-8"
                        style={{ border: '1px solid rgba(0,200,5,0.2)' }}>
                        <Sparkles className="w-3 h-3 text-[#00C805]" />
                        <span className="text-xs text-[#00C805] font-semibold tracking-widest uppercase">
                            Multi-Agent AI Framework · Live
                        </span>
                    </div>

                    {/* Headline */}
                    <h1 className="text-5xl md:text-7xl font-bold tracking-tighter leading-[1.05] text-white mb-5">
                        Wall Street Level AI.
                        <br />
                        <span className="text-white/30">In Your Pocket.</span>
                    </h1>

                    <p className="text-white/40 text-lg md:text-xl max-w-xl mx-auto mb-12 leading-relaxed font-light">
                        Search any stock and view market data for <strong>free</strong>.
                        <br className="hidden md:block" />
                        Get <strong>1 free AI analysis</strong> upon registration. Our AI is built on hundreds of financial studies for maximum accuracy.
                    </p>

                    {/* Search Bar */}
                    <form onSubmit={handleSubmit} className="relative max-w-xl mx-auto">
                        <motion.div
                            animate={isFocused
                                ? { boxShadow: '0 0 0 2px rgba(0,200,5,0.35), 0 0 40px rgba(0,200,5,0.12)' }
                                : { boxShadow: '0 0 0 1px rgba(255,255,255,0.08)' }
                            }
                            transition={{ duration: 0.25 }}
                            className="relative bg-[#111114] rounded-2xl overflow-hidden"
                            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                        >
                            <Search
                                className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none"
                                style={{ color: isFocused ? '#00C805' : 'rgba(255,255,255,0.25)' }}
                            />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value.toUpperCase())}
                                onKeyDown={handleKeyDown}
                                onFocus={() => setIsFocused(true)}
                                onBlur={() => setIsFocused(false)}
                                placeholder={"Search any stock ticker (e.g., NVDA, AAPL)..."}
                                className={`w-full bg-transparent pl-14 pr-[160px] py-5 text-base outline-none text-white placeholder:text-white/25`}
                                style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.01em' }}
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 z-10">
                                <motion.button
                                    type="submit"
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.97 }}
                                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-black bg-[#00C805] hover:bg-[#00e005] shadow-[0_0_15px_rgba(0,200,5,0.15)] transition-all"
                                >
                                    Analyze <ArrowRight className="w-4 h-4" />
                                </motion.button>
                            </div>
                        </motion.div>

                        {/* Free Tier Explainer Text */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="mt-4 flex items-center justify-center gap-2 text-sm text-white/50"
                        >
                            <span><strong className="text-white/80">100% Free</strong> Search & Live Data. <strong className="text-[#00C805]">1 Free AI Analysis</strong> on sign up.</span>
                        </motion.div>
                    </form>

                    {/* Typewriter suggestions */}
                    <div className="mt-4 h-6 flex items-center justify-center">
                        <TypewriterText suggestions={TYPEWRITER_SUGGESTIONS} />
                    </div>
                </motion.div>

                {/* Quick ticker chips */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                    className="flex items-center justify-center flex-wrap gap-2 mt-8"
                >
                    {['NVDA', 'AAPL', 'TSLA', 'META', 'MSFT', 'AMZN', 'GOOGL'].map((t) => (
                        <button
                            key={t}
                            onClick={() => onSearch(t)}
                            className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-white/50 hover:text-white/90 transition-all duration-200"
                            style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                        >
                            {t}
                        </button>
                    ))}
                </motion.div>
            </section>

            {/* ── SECTION 3: TRENDING AI INSIGHTS ── */}
            <section className="max-w-6xl mx-auto px-6 pb-24">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                >
                    <div className="flex items-center justify-between mb-7">
                        <div className="flex items-center gap-2.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#00C805] animate-pulse" />
                            <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/40">
                                Trending AI Insights
                            </span>
                        </div>
                        <button className="text-xs text-white/30 hover:text-white/70 transition-colors flex items-center gap-1">
                            View all <ChevronRight className="w-3 h-3" />
                        </button>
                    </div>

                    {/* Cards — horizontal scroll on mobile, grid on desktop */}
                    <div className="flex md:grid md:grid-cols-4 gap-4 overflow-x-auto pb-4 md:pb-0 scrollbar-none -mx-6 px-6 md:mx-0 md:px-0">
                        {livePicks === null
                            ? TOP_PICKS_TICKERS.map((_, i) => <SkeletonCard key={i} i={i} />)
                            : displayPicks.map((stock, i) => (
                                <StockCard key={stock.ticker} stock={stock} onSearch={onSearch} index={i} />
                            ))
                        }
                    </div>
                </motion.div>
            </section>

            {/* ── SECTION 4: RECENT AI SCANS ── */}
            <section className="max-w-6xl mx-auto px-6 pb-24">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-60px' }}
                    transition={{ duration: 0.5 }}
                >
                    <div className="flex items-center gap-2.5 mb-7">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#FFB800] animate-pulse" />
                        <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/40">
                            Recent AI Scans
                        </span>
                    </div>

                    <div
                        className="rounded-2xl overflow-hidden"
                        style={{ border: '1px solid rgba(255,255,255,0.05)' }}
                    >
                        {displayScans.map((scan, i) => {
                            const isUp = scan.signal === 'BUY' || scan.signal === 'STRONG BUY';
                            const color = getScoreColor(scan.score);
                            return (
                                <motion.div
                                    key={scan.ticker}
                                    initial={{ opacity: 0, x: -10 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: i * 0.06, duration: 0.35 }}
                                    onClick={() => onSearch(scan.ticker)}
                                    className="flex items-center justify-between px-6 py-4 cursor-pointer transition-colors hover:bg-white/[0.03] group"
                                    style={i !== displayScans.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.04)' } : {}}
                                >
                                    {/* Left: ticker + timestamp */}
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 overflow-hidden bg-white/5"
                                            style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                                            <img
                                                src={`https://img.logokit.com/ticker/${scan.ticker}?token=pk_frfa213068bb8ffac35321`}
                                                alt={`${scan.ticker} logo`}
                                                className="w-full h-full object-contain p-1.5"
                                                onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                                            />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-white">{scan.ticker}</div>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <Clock className="w-2.5 h-2.5 text-white/25" />
                                                <span className="text-[11px] text-white/30">Analyzed {scan.ago}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: price, score, signal */}
                                    <div className="flex items-center gap-6">
                                        <div className="hidden sm:block text-sm font-medium text-white/70">
                                            {scan.price != null ? `$${scan.price.toFixed(2)}` : <span className="w-16 h-3 bg-white/10 rounded animate-pulse inline-block" />}
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-lg font-bold" style={{ color }}>{scan.score}</span>
                                            <span className="text-[10px] text-white/30 uppercase">/ 100</span>
                                        </div>
                                        <div
                                            className="text-[10px] font-bold tracking-wider px-2.5 py-1 rounded-full uppercase hidden sm:block"
                                            style={{ backgroundColor: `${getSignalBg(scan.signal)}15`, color: getSignalBg(scan.signal) }}
                                        >
                                            {scan.signal}
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-white/15 group-hover:text-white/40 transition-colors" />
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </motion.div>
            </section>

            {/* ── SECTION 5: HOW OUR AI WORKS ── */}
            <section className="max-w-6xl mx-auto px-6 pb-32">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-60px' }}
                    transition={{ duration: 0.5 }}
                >
                    <div className="text-center mb-14">
                        <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/30">
                            How Our AI Works
                        </span>
                        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white mt-3">
                            The Multi-Agent Debate Framework
                        </h2>
                        <p className="text-white/40 mt-3 text-base max-w-lg mx-auto">
                            No black boxes. Four autonomous agents argue every trade — then a Chief Investment Officer scores the outcome.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {[
                            {
                                icon: '🐂',
                                color: '#00C805',
                                label: 'The Bull',
                                sublabel: 'Fundamental Analysis',
                                desc: 'Analyzes earnings growth, P/E ratios, FCF yield, and institutional ownership to build the strongest possible long case.',
                                lucideIcon: TrendingUp,
                            },
                            {
                                icon: '🐻',
                                color: '#FF5000',
                                label: 'The Bear',
                                sublabel: 'Macro Risk Stress-Test',
                                desc: 'Challenges every thesis. Stress-tests against VIX spikes, interest rate risk, geopolitical exposure, and sector rotations.',
                                lucideIcon: TrendingDown,
                            },
                            {
                                icon: '⚖️',
                                color: '#FFB800',
                                label: 'The Judge',
                                sublabel: 'Final Synthesis & Score',
                                desc: 'The Chief Investment Officer absorbs both arguments, applies quantitative weighting, and delivers a 0–100 AI score with a clear signal.',
                                lucideIcon: Scale,
                            },
                        ].map(({ icon, color, label, sublabel, desc, lucideIcon: Icon }, i) => (
                            <motion.div
                                key={label}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.12, duration: 0.45 }}
                                whileHover={{ y: -4, transition: { duration: 0.2 } }}
                                className="bg-[#0A0A0C] rounded-2xl p-7 flex flex-col gap-5 group"
                                style={{ border: '1px solid rgba(255,255,255,0.05)' }}
                            >
                                {/* Icon ring */}
                                <div className="flex items-center gap-3">
                                    <div
                                        className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
                                        style={{ backgroundColor: `${color}12`, border: `1px solid ${color}25` }}
                                    >
                                        {icon}
                                    </div>
                                    <div>
                                        <div className="font-bold text-white text-sm">{label}</div>
                                        <div className="text-[11px] uppercase tracking-widest font-medium mt-0.5" style={{ color }}>
                                            {sublabel}
                                        </div>
                                    </div>
                                </div>

                                <p className="text-[14px] text-white/50 leading-relaxed">
                                    {desc}
                                </p>

                                <div className="mt-auto flex items-center gap-1.5 text-xs font-semibold" style={{ color: `${color}80` }}>
                                    <Icon className="w-3.5 h-3.5" />
                                    <span style={{ color }}>{label === 'The Judge' ? 'Final Score' : label === 'The Bull' ? 'Bullish Drivers' : 'Risk Factors'}</span>
                                </div>
                            </motion.div>
                        ))}
                    </div>

                    {/* CTA row after agents */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.4, duration: 0.5 }}
                        className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4"
                    >
                        <button
                            onClick={() => inputRef?.current?.focus()}
                            className="flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-sm text-black transition-all hover:brightness-110 active:scale-95"
                            style={{ backgroundColor: '#00C805' }}
                        >
                            <Zap className="w-4 h-4" />
                            Run Your First Analysis
                        </button>
                        <button className="flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-sm text-white/60 hover:text-white transition-colors">
                            View sample report
                            <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                    </motion.div>
                </motion.div>
            </section>

            {/* ── FOOTER ── */}
            <footer
                className="max-w-6xl mx-auto px-6 py-10"
                style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
            >
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <Activity className="w-3.5 h-3.5 text-white/20" />
                        <span className="text-xs text-white/20 font-semibold">QuantAI</span>
                    </div>
                    <p className="text-xs text-white/20">© 2026 QuantAI Technologies. For informational purposes only. Not financial advice.</p>
                    <p className="text-[10px] text-white/15 uppercase tracking-widest font-bold">Pure Data · No Noise</p>
                </div>
            </footer>
        </div>
    );
}

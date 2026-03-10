'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Activity, Search, TrendingUp, TrendingDown, BarChart2,
    Zap, Scale, Clock, ArrowRight, ChevronRight, Sparkles,
    LayoutDashboard, ScanLine, Briefcase, User, LogOut, Lock, X
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import PortfolioManager from './PortfolioManager';

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
        <span className="text-white/50 text-sm font-normal">
            {displayed}
            <span className="inline-block w-px h-3.5 bg-white/50 ml-0.5 animate-pulse align-middle" />
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
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSearch(stock.ticker);
                }
            }}
            role="button"
            tabIndex={0}
            className="bg-[#111114] rounded-2xl p-5 cursor-pointer flex-shrink-0 w-[240px] sm:w-[220px] md:w-auto min-h-[220px] active:scale-[0.99] transition-transform"
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
                    {stock.score != null ? (
                        <>
                            <div className="text-3xl font-bold leading-none" style={{ color }}>{stock.score}</div>
                            <div className="text-[10px] text-white/30 uppercase tracking-widest mt-0.5">AI Score</div>
                        </>
                    ) : (
                        <div className="flex flex-col items-end opacity-40 group-hover:opacity-100 transition-opacity">
                            <div className="flex items-center gap-1.5 text-white/20">
                                <Lock className="w-3 h-3" />
                                <span className="text-xs font-bold uppercase tracking-tighter">Locked</span>
                            </div>
                            <div className="text-2xl font-black text-white/5 blur-[3px]">88</div>
                        </div>
                    )}
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
    const WATCHLIST_KEY = 'consensusai_watchlist';

    // Load watchlist from localStorage + fetch prices
    useEffect(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]');
            setWatchlist(stored);
            stored.forEach(async ({ ticker }) => {
                try {
                    const res = await fetch(`https://quantai-backend-316459358121.europe-west1.run.app/api/quick-stats/${ticker}`);
                    if (res.ok) {
                        const d = await res.json();
                        setWatchlistPrices(prev => ({ ...prev, [ticker]: { price: d.price, change: d.changePercent } }));
                    }
                } catch { /* ignore */ }
            });
        } catch { /* ignore */ }
    }, []);
    const [livePicks, setLivePicks] = useState(null);   // null = loading
    const [liveScans, setLiveScans] = useState(null);
    const [user, setUser] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [showPortfolio, setShowPortfolio] = useState(false);
    const [isEditingPicks, setIsEditingPicks] = useState(false);
    const [editPicksInput, setEditPicksInput] = useState('');
    const [isSavingPicks, setIsSavingPicks] = useState(false);
    const [watchlist, setWatchlist] = useState([]);
    const [watchlistPrices, setWatchlistPrices] = useState({});

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

    // Fetch live prices for cards
    useEffect(() => {
        const fetchAll = async () => {
            // Determine which tickers to fetch: user customPicks or default TOP_PICKS_TICKERS
            const tickersToFetch = (userProfile?.customPicks && userProfile.customPicks.length > 0)
                ? userProfile.customPicks.map(t => ({ ticker: t, name: t }))
                : TOP_PICKS_TICKERS;

            try {
                // Fetch Top Picks
                const pickResults = await Promise.all(
                    tickersToFetch.map(async ({ ticker, name }) => {
                        try {
                            const res = await fetch(`https://quantai-backend-316459358121.europe-west1.run.app/api/quick-stats/${ticker}`);
                            if (!res.ok) throw new Error('fail');
                            const d = await res.json();
                            const isUp = (d.changePercent ?? 0) >= 0;
                            const spark = (d.chartData || []).slice(-12).map(c => c.close);

                            // Real AI Score from backend if available, else default 70
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
                                change: d.changePercent ?? 0,
                            };
                        } catch {
                            return { ticker, price: null, score: 70, signal: 'BUY', change: 0 };
                        }
                    })
                );
                setLiveScans(scanResults);
            } catch (e) {
                console.warn('Live picks fetch error:', e);
            }
        };
        fetchAll();
    }, [userProfile?.customPicks]); // Re-fetch when custom picks change

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
    const displayScans = liveScans ?? RECENT_SCANS_TICKERS.map((t) => ({ ticker: t, price: null, score: 70, signal: 'BUY', change: 0 }));

    const handleSavePicks = async () => {
        if (!user || !userProfile?.isPro) return;
        setIsSavingPicks(true);
        try {
            const tickers = editPicksInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length > 0).slice(0, 5);
            const token = await user.getIdToken();
            const res = await fetch(`https://quantai-backend-316459358121.europe-west1.run.app/api/user-settings`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ customPicks: tickers })
            });
            if (res.ok) {
                setUserProfile(prev => ({ ...prev, customPicks: tickers }));
                setIsEditingPicks(false);
            }
        } catch (e) {
            console.error('Failed to save picks', e);
        } finally {
            setIsSavingPicks(false);
        }
    };

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
        <div className="min-h-screen bg-[#000000] text-white font-sans selection:bg-white/20 pb-28 md:pb-0" suppressHydrationWarning>

            {/* ── SECTION 1: NAVBAR ── */}
            <motion.header
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="sticky top-0 z-50 bg-[#000000]/90 backdrop-blur-xl"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
            >
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    {/* Logo */}
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center">
                            <img src="/logo.svg" alt="ConsensusAI Logo" className="w-full h-full object-contain" />
                        </div>
                        <span className="font-bold text-xl tracking-tight text-white">
                            Consensus<span className="text-[#00C805]">AI</span>
                        </span>
                    </div>

                    {/* Right nav */}
                    <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
                        {[
                            { icon: LayoutDashboard, label: 'Dashboard' },
                            { icon: ScanLine, label: 'Market Scans' },
                            {
                                icon: Briefcase, label: 'My Portfolio', onClick: () => {
                                    if (!user) handleGoogleLogin();
                                    else setShowPortfolio(true);
                                }
                            }
                        ].map(({ icon: Icon, label, onClick }) => (
                            <button
                                key={label}
                                type="button"
                                onClick={onClick}
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
                                <span>Sign in</span>
                            </button>
                        )}
                    </nav>
                </div>
            </motion.header>

            {/* ── SECTION 2: HERO OR PORTFOLIO ── */}
            {showPortfolio && user ? (
                <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10 pb-20">
                    <div className="mb-6">
                        <button
                            type="button"
                            onClick={() => setShowPortfolio(false)}
                            className="touch-target text-white/40 hover:text-white text-sm font-medium flex items-center gap-2 transition-colors"
                        >
                            ← Back to Dashboard
                        </button>
                    </div>
                    <PortfolioManager />
                </section>
            ) : (
                <>
                    <section className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-20 sm:pb-28 text-center overflow-hidden">
                        {/* Background ambient glow */}
                        <div
                            className="absolute top-0 left-1/2 -translate-x-1/2 w-[420px] sm:w-[600px] h-[260px] sm:h-[300px] rounded-full pointer-events-none"
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
                            <div className="inline-flex items-center gap-2 bg-[#111114] rounded-full px-3.5 sm:px-4 py-1.5 mb-6 sm:mb-8"
                                style={{ border: '1px solid rgba(0,200,5,0.2)' }}>
                                <Sparkles className="w-3 h-3 text-[#00C805]" />
                                <span className="text-[10px] sm:text-xs text-[#00C805] font-semibold tracking-widest uppercase">
                                    Multi-Agent AI Framework · Live
                                </span>
                            </div>

                            {/* Headline */}
                            <h1 className="text-3xl sm:text-5xl md:text-7xl font-bold tracking-tighter leading-[1.08] sm:leading-[1.05] text-white mb-4 sm:mb-5">
                                Wall Street Level AI.
                                <br />
                                <span className="text-white/30">In Your Pocket.</span>
                            </h1>

                            <p className="text-white/40 text-base sm:text-lg md:text-xl max-w-xl mx-auto mb-8 sm:mb-12 leading-relaxed font-light">
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
                                    className="relative bg-[#111114] rounded-2xl overflow-hidden sm:block"
                                    style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                                >
                                    <Search
                                        className="absolute left-4 sm:left-5 top-5 sm:top-1/2 sm:-translate-y-1/2 w-5 h-5 pointer-events-none"
                                        style={{ color: isFocused ? '#00C805' : 'rgba(255,255,255,0.25)' }}
                                    />
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        aria-label="Search stock ticker"
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        onFocus={() => setIsFocused(true)}
                                        onBlur={() => setIsFocused(false)}
                                        placeholder={"Search any stock ticker (e.g., NVDA, AAPL)..."}
                                        className={`w-full bg-transparent pl-12 sm:pl-14 pr-4 sm:pr-40 pt-4 pb-3 sm:py-5 text-base outline-none text-white placeholder:text-white/25`}
                                        style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.01em' }}
                                    />
                                    <div className="px-3 pb-3 sm:p-0 sm:absolute sm:right-3 sm:top-1/2 sm:-translate-y-1/2 z-10">
                                        <motion.button
                                            type="submit"
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.97 }}
                                            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-black bg-[#00C805] hover:bg-[#00e005] shadow-[0_0_15px_rgba(0,200,5,0.15)] transition-all"
                                        >
                                            Analyze <ArrowRight className="w-4 h-4" />
                                        </motion.button>
                                    </div>
                                </motion.div>

                                {/* Free Tier Explainer Text */}
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="mt-4 flex items-center justify-center gap-2 text-xs sm:text-sm text-white/50"
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
                            className="flex items-center justify-center flex-wrap gap-2 mt-6 sm:mt-8"
                        >
                            {['NVDA', 'AAPL', 'TSLA', 'META', 'MSFT', 'AMZN', 'GOOGL'].map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => onSearch(t)}
                                    className="touch-target px-3.5 py-1.5 rounded-full text-xs font-semibold text-white/50 hover:text-white/90 transition-all duration-200"
                                    style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                                >
                                    {t}
                                </button>
                            ))}
                        </motion.div>
                    </section>

                    {/* ── SECTION 3: TRENDING AI INSIGHTS ── */}
                    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24">
                        <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                        >
                            <div className="flex items-center justify-between mb-7 gap-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#00C805] animate-pulse" />
                                    <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/50">
                                        Trending AI Insights
                                    </span>
                                </div>
                                {userProfile?.isPro && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditPicksInput((userProfile?.customPicks || ["NVDA", "AAPL", "META", "TSLA", "MSFT"]).join(', '));
                                            setIsEditingPicks(true);
                                        }}
                                        className="touch-target flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all text-[11px] font-bold uppercase tracking-wider"
                                    >
                                        <Activity className="w-3.5 h-3.5" />
                                        <span>Personalize</span>
                                    </button>
                                )}
                                {!userProfile?.isPro && (
                                    <button
                                        type="button"
                                        onClick={() => document.getElementById('recent-scans')?.scrollIntoView({ behavior: 'smooth' })}
                                        className="touch-target text-xs text-white/30 hover:text-white/70 transition-colors flex items-center gap-1"
                                    >
                                        View all <ChevronRight className="w-3 h-3" />
                                    </button>
                                )}
                            </div>

                            {/* Picks Edit Modal Overlay */}
                            <AnimatePresence>
                                {isEditingPicks && (
                                    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            onClick={() => setIsEditingPicks(false)}
                                            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                                        />
                                        <motion.div
                                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                            className="relative w-full max-w-md bg-[#111114] border border-white/10 rounded-2xl p-6 shadow-2xl"
                                        >
                                            <h3 className="text-lg font-bold text-white mb-1">Customize Your Dashboard</h3>
                                            <p className="text-sm text-white/60 mb-5">Select up to 5 favorite tickers to track on your home screen.</p>

                                            <div className="space-y-4">
                                                <div className="flex flex-wrap gap-2 mb-4">
                                                    {editPicksInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length > 0).map((ticker, idx) => (
                                                        <div key={`${ticker}-${idx}`} className="flex items-center gap-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full text-xs font-bold text-white group">
                                                            {ticker}
                                                            <button
                                                                type="button"
                                                                aria-label={`Remove ${ticker}`}
                                                                onClick={() => {
                                                                    const current = editPicksInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
                                                                    const next = current.filter((_, i) => i !== idx);
                                                                    setEditPicksInput(next.join(', '));
                                                                }}
                                                                className="touch-target text-white/20 hover:text-red-400 flex items-center justify-center"
                                                            >
                                                                <X className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>

                                                <div className="relative">
                                                    <input
                                                        autoFocus
                                                        type="text"
                                                        value={editPicksInput}
                                                        onChange={(e) => setEditPicksInput(e.target.value.toUpperCase())}
                                                        placeholder="Enter tickers (e.g. AAPL, BTC-USD)"
                                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-base sm:text-sm text-white focus:outline-none focus:border-[#00C805]/50 transition-colors"
                                                    />
                                                </div>

                                                <div className="flex gap-3 pt-2">
                                                    <button
                                                        type="button"
                                                        onClick={handleSavePicks}
                                                        disabled={isSavingPicks}
                                                        className="touch-target flex-1 min-h-[44px] bg-[#00C805] text-black font-bold py-3 rounded-xl hover:bg-[#00e005] transition-all disabled:opacity-50"
                                                    >
                                                        {isSavingPicks ? 'SAVING...' : 'SAVE CHANGES'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsEditingPicks(false)}
                                                        className="touch-target min-h-[44px] px-6 py-3 rounded-xl bg-white/5 text-white/60 font-medium hover:bg-white/10 transition-all"
                                                    >
                                                        CANCEL
                                                    </button>
                                                </div>
                                            </div>
                                        </motion.div>
                                    </div>
                                )}
                            </AnimatePresence>

                            {/* Cards — horizontal scroll on mobile, grid on desktop */}
                            <div className="flex md:grid md:grid-cols-4 gap-4 overflow-x-auto pb-4 md:pb-0 scrollbar-none -mx-4 sm:-mx-6 px-4 sm:px-6 md:mx-0 md:px-0">
                                {livePicks === null
                                    ? TOP_PICKS_TICKERS.map((_, i) => <SkeletonCard key={i} i={i} />)
                                    : displayPicks.map((stock, i) => (
                                        <StockCard key={stock.ticker} stock={stock} onSearch={onSearch} index={i} />
                                    ))
                                }
                            </div>
                        </motion.div>
                    </section>

                    {/* ── SECTION 3b: WATCHLIST ── */}
                    {watchlist.length > 0 && (
                        <section className="max-w-6xl mx-auto px-4 sm:px-6">
                            <motion.div
                                initial={{ opacity: 0, y: 16 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true, margin: '-60px' }}
                                transition={{ duration: 0.5 }}
                            >
                                <div className="flex items-center gap-2.5 mb-5">
                                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[#FFD700]" stroke="#FFD700" strokeWidth={1.5}>
                                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                    </svg>
                                    <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/50">Watchlist</span>
                                    <span className="text-[10px] text-white/40 font-bold bg-white/5 px-2 py-0.5 rounded-full">{watchlist.length}</span>
                                </div>

                                <div className="rounded-2xl overflow-hidden border border-white/5 bg-[#111114]">
                                    {watchlist.map((item, i) => {
                                        const data = watchlistPrices[item.ticker];
                                        const isUp = (data?.change ?? 0) >= 0;
                                        const changeColor = isUp ? '#00C805' : '#FF5000';
                                        return (
                                            <div
                                                key={item.ticker}
                                                className="flex flex-wrap sm:flex-nowrap items-center gap-y-2 px-4 sm:px-5 py-3.5 hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 cursor-pointer"
                                                onClick={() => onSearch(item.ticker)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        onSearch(item.ticker);
                                                    }
                                                }}
                                                role="button"
                                                tabIndex={0}
                                            >
                                                {/* Logo */}
                                                <div className="w-8 h-8 rounded-full bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden mr-3 shrink-0">
                                                    <img
                                                        src={`https://img.logokit.com/ticker/${item.ticker}?token=pk_frfa213068bb8ffac35321&size=64`}
                                                        alt={item.ticker}
                                                        className="w-full h-full object-contain p-1"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                </div>
                                                {/* Ticker & Name */}
                                                <div className="flex-1 min-w-0">
                                                    <span className="font-bold text-sm text-white/90">{item.ticker}</span>
                                                    {item.name && item.name !== item.ticker && (
                                                        <span className="text-xs text-white/50 ml-2 truncate hidden sm:inline">{item.name}</span>
                                                    )}
                                                </div>
                                                {/* Price & Change */}
                                                <div className="text-right ml-auto mr-2 sm:mr-4">
                                                    {data?.price != null ? (
                                                        <>
                                                            <div className="font-semibold text-sm text-white/90">${data.price.toFixed(2)}</div>
                                                            <div className="text-xs font-semibold" style={{ color: changeColor }}>
                                                                {isUp ? '+' : ''}{(data.change ?? 0).toFixed(2)}%
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="text-xs text-white/50 animate-pulse">Loading…</div>
                                                    )}
                                                </div>
                                                {/* Remove Button */}
                                                <button
                                                    type="button"
                                                    aria-label={`Remove ${item.ticker} from watchlist`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const WATCHLIST_KEY = 'consensusai_watchlist';
                                                        const next = watchlist.filter(w => w.ticker !== item.ticker);
                                                        localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
                                                        setWatchlist(next);
                                                    }}
                                                    className="touch-target p-1.5 rounded-full text-white/15 hover:text-[#FF5000] hover:bg-red-500/10 transition-all"
                                                    title="Remove from watchlist"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </motion.div>
                        </section>
                    )}

                    {/* ── SECTION 4: RECENT AI SCANS ── */}
                    <section id="recent-scans" className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 sm:pb-24">
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
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    onSearch(scan.ticker);
                                                }
                                            }}
                                            role="button"
                                            tabIndex={0}
                                            className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 sm:px-6 py-4 cursor-pointer transition-colors hover:bg-white/[0.03] group"
                                            style={i !== displayScans.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.04)' } : {}}
                                        >
                                            {/* Left: ticker + info */}
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
                                                        <span
                                                            className="text-[11px] font-medium"
                                                            style={{ color: (scan.change ?? 0) >= 0 ? '#00C805' : '#FF5000' }}
                                                        >
                                                            {scan.change != null ? `${(scan.change >= 0 ? '+' : '')}${scan.change.toFixed(2)}%` : '—'}
                                                        </span>
                                                        <span className="text-white/20 text-[11px]">today</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Right: price, score, signal */}
                                            <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto justify-between sm:justify-end">
                                                <div className="text-sm font-medium text-white/70">
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
                                                <ChevronRight className="w-4 h-4 text-white/15 group-hover:text-white/40 transition-colors shrink-0" />
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </motion.div>
                    </section>

                    {/* ── SECTION 5: HOW OUR AI WORKS ── */}
                    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24 sm:pb-32">
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
                                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-white mt-3">
                                    The Multi-Agent Debate Framework
                                </h2>
                                <p className="text-white/40 mt-3 text-base max-w-lg mx-auto">
                                    No black boxes. Four autonomous agents argue every trade — then a Chief Investment Officer scores the outcome.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {[
                                    {
                                        color: '#00C805',
                                        label: 'The Bull',
                                        sublabel: 'Fundamental Analysis',
                                        desc: 'Analyzes earnings growth, P/E ratios, FCF yield, and institutional ownership to build the strongest possible long case.',
                                        lucideIcon: TrendingUp,
                                    },
                                    {
                                        color: '#FF5000',
                                        label: 'The Bear',
                                        sublabel: 'Macro Risk Stress-Test',
                                        desc: 'Challenges every thesis. Stress-tests against VIX spikes, interest rate risk, geopolitical exposure, and sector rotations.',
                                        lucideIcon: TrendingDown,
                                    },
                                    {
                                        color: '#FFB800',
                                        label: 'The Judge',
                                        sublabel: 'Final Synthesis & Score',
                                        desc: 'The Chief Investment Officer absorbs both arguments, applies quantitative weighting, and delivers a 0–100 AI score with a clear signal.',
                                        lucideIcon: Scale,
                                    },
                                ].map(({ color, label, sublabel, desc, lucideIcon: Icon }, i) => (
                                    <motion.div
                                        key={label}
                                        initial={{ opacity: 0, y: 20 }}
                                        whileInView={{ opacity: 1, y: 0 }}
                                        viewport={{ once: true }}
                                        transition={{ delay: i * 0.12, duration: 0.45 }}
                                        whileHover={{ y: -4, transition: { duration: 0.2 } }}
                                        className="bg-[#0A0A0C] rounded-2xl p-5 sm:p-7 flex flex-col gap-5 group"
                                        style={{ border: '1px solid rgba(255,255,255,0.05)' }}
                                    >
                                        {/* Icon ring */}
                                        <div className="flex items-center gap-3">
                                            <div
                                                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                                                style={{ backgroundColor: `${color}12`, border: `1px solid ${color}25` }}
                                            >
                                                <Icon className="w-5 h-5" style={{ color }} />
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
                                    type="button"
                                    onClick={() => inputRef?.current?.focus()}
                                    className="touch-target flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-sm text-black transition-all hover:brightness-110 active:scale-95"
                                    style={{ backgroundColor: '#00C805' }}
                                >
                                    <Zap className="w-4 h-4" />
                                    Run Your First Analysis
                                </button>
                            </motion.div>
                        </motion.div>
                    </section>

                    {/* ── FOOTER ── */}
                    <footer
                        className="max-w-6xl mx-auto px-4 sm:px-6 py-10"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                    >
                        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <img src="/logo.svg" alt="ConsensusAI" className="w-3.5 h-3.5" />
                                <span className="text-xs text-white/20 font-semibold">ConsensusAI</span>
                            </div>
                            <p className="text-xs text-white/20">© 2026 ConsensusAI Technologies. For informational purposes only. Not financial advice.</p>
                            <p className="text-[10px] text-white/15 uppercase tracking-widest font-bold">Pure Data · No Noise</p>
                        </div>
                    </footer>
                </>
            )}

            {/* ── MOBILE BOTTOM NAVIGATION ── */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#000000]/95 backdrop-blur-xl border-t border-white/5 flex items-center justify-around px-2 pb-safe">
                <button
                    type="button"
                    onClick={() => {
                        setShowPortfolio(false);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    aria-label="Go to home dashboard"
                    className="touch-target flex flex-col items-center justify-center gap-1 py-2.5 px-4 text-white/70"
                >
                    <LayoutDashboard className="w-5 h-5" />
                    <span className="text-[10px] font-medium">Home</span>
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (!user) handleGoogleLogin();
                        else setShowPortfolio(true);
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
                        className="touch-target flex flex-col items-center justify-center gap-1 py-2.5 px-4 text-[#00C805]"
                    >
                        <User className="w-5 h-5" />
                        <span className="text-[10px] font-medium">Sign In</span>
                    </button>
                )}
            </nav>
        </div>
    );
}

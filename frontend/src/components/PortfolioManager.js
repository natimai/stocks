'use client';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Plus, Layers, Edit2, Check, X } from 'lucide-react';
import { auth } from '../lib/firebase';
import PortfolioDoctorChat from './PortfolioDoctorChat';

// Mock live prices for calculating Portfolio Value. In a real app,
// these would be fetched via Websockets or REST API per ticker.
const MOCK_PRICES = {
    'AAPL': 225.50,
    'MSFT': 430.20,
    'NVDA': 125.10,
    'TSLA': 195.40,
    'AMZN': 180.30,
    'GOOGL': 175.80,
    'META': 490.50,
};

const getMockPrice = (ticker) => {
    const t = ticker.toUpperCase();
    return MOCK_PRICES[t] || 150.00; // Mock current price fallback
};

export default function PortfolioManager() {
    const [holdings, setHoldings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [ticker, setTicker] = useState('');
    const [shares, setShares] = useState('');
    const [averageCost, setAverageCost] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [prices, setPrices] = useState({});
    const fetchedTickers = useRef(new Set());

    // Custom Chat State
    const [isChatOpen, setIsChatOpen] = useState(false);

    // Edit State
    const [editingId, setEditingId] = useState(null);
    const [editShares, setEditShares] = useState('');
    const [editAverageCost, setEditAverageCost] = useState('');

    // Autocomplete State
    const [searchResults, setSearchResults] = useState([]);
    const [showResults, setShowResults] = useState(false);

    const getBaseUrl = () => {
        return typeof window !== 'undefined' && window.location.hostname === 'localhost'
            ? 'http://localhost:8000'
            : 'https://quantai-backend-316459358121.europe-west1.run.app';
    };

    useEffect(() => {
        const uniqueTickers = [...new Set(holdings.map(h => h.ticker))];
        uniqueTickers.forEach(async (t) => {
            if (!fetchedTickers.current.has(t)) {
                fetchedTickers.current.add(t);
                try {
                    const res = await fetch(`${getBaseUrl()}/api/quick-stats/${t}`);
                    if (res.ok) {
                        const data = await res.json();
                        setPrices(prev => ({ ...prev, [t]: data.price }));
                    } else {
                        setPrices(prev => ({ ...prev, [t]: getMockPrice(t) }));
                    }
                } catch (e) {
                    setPrices(prev => ({ ...prev, [t]: getMockPrice(t) }));
                }
            }
        });
    }, [holdings]);

    useEffect(() => {
        if (auth.currentUser) {
            fetchPortfolio();
        } else {
            setLoading(false);
        }
    }, []);

    // Also re-fetch if auth state changes from null to populated
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
                fetchPortfolio();
            } else {
                setHoldings([]);
                setLoading(false);
            }
        });
        return unsubscribe;
    }, []);

    // Autocomplete hook
    useEffect(() => {
        if (ticker.trim().length >= 1) {
            const timeout = setTimeout(async () => {
                try {
                    const res = await fetch(`${getBaseUrl()}/api/search?q=${ticker}`);
                    if (res.ok) {
                        const data = await res.json();
                        setSearchResults(data);
                        setShowResults(data.length > 0);
                    }
                } catch (e) {
                    console.error("Search failed", e);
                }
            }, 300);
            return () => clearTimeout(timeout);
        } else {
            setSearchResults([]);
            setShowResults(false);
        }
    }, [ticker]);

    const handleSelectStock = (symbol) => {
        setTicker(symbol);
        setShowResults(false);
    };


    const fetchPortfolio = async () => {
        if (!auth.currentUser) return;
        setLoading(true);
        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`${getBaseUrl()}/api/portfolio`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setHoldings(data);
            }
        } catch (e) {
            console.error('Failed to fetch portfolio', e);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!ticker || !shares || !averageCost || !auth.currentUser) return;

        const newItem = {
            id: `temp-${Date.now()}`,
            ticker: ticker.toUpperCase(),
            shares: parseFloat(shares),
            average_cost: parseFloat(averageCost),
            createdAt: new Date().toISOString()
        };

        // Optimistic UI update
        setHoldings(prev => [...prev, newItem]);
        setIsAdding(true);

        const currentTicker = ticker;
        setTicker('');
        setShares('');
        setAverageCost('');

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`${getBaseUrl()}/api/portfolio`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    ticker: currentTicker,
                    shares: parseFloat(newItem.shares),
                    average_cost: parseFloat(newItem.average_cost)
                })
            });

            if (res.ok) {
                const data = await res.json();
                // Replace temp ID with actual DB ID
                setHoldings(prev => prev.map(h => h.id === newItem.id ? data : h));
            } else {
                // Revert on failure
                setHoldings(prev => prev.filter(h => h.id !== newItem.id));
            }
        } catch (e) {
            console.error('Add failed', e);
            setHoldings(prev => prev.filter(h => h.id !== newItem.id));
        } finally {
            setIsAdding(false);
        }
    };

    const handleDelete = async (id) => {
        if (!auth.currentUser) return;

        // Optimistic UI update
        const previousHoldings = [...holdings];
        setHoldings(prev => prev.filter(h => h.id !== id));

        try {
            const token = await auth.currentUser.getIdToken();
            const res = await fetch(`${getBaseUrl()}/api/portfolio/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                setHoldings(previousHoldings); // Revert
            }
        } catch (e) {
            console.error('Delete failed', e);
            setHoldings(previousHoldings); // Revert
        }
    };

    const startEditing = (item) => {
        setEditingId(item.id);
        setEditShares(item.shares.toString());
        setEditAverageCost(item.average_cost.toString());
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditShares('');
        setEditAverageCost('');
    };

    const handleEditSave = async (id) => {
        if (!auth.currentUser || !editShares || !editAverageCost) return;

        const previousHoldings = [...holdings];
        const newShares = parseFloat(editShares);
        const newAvgCost = parseFloat(editAverageCost);

        // Optimistic edit
        setHoldings(prev => prev.map(h =>
            h.id === id ? { ...h, shares: newShares, average_cost: newAvgCost } : h
        ));
        setEditingId(null);

        try {
            const token = await auth.currentUser.getIdToken();
            const currentItem = previousHoldings.find(h => h.id === id);
            const res = await fetch(`${getBaseUrl()}/api/portfolio/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    ticker: currentItem.ticker,
                    shares: newShares,
                    average_cost: newAvgCost
                })
            });

            if (!res.ok) {
                setHoldings(previousHoldings);
            } else {
                const data = await res.json();
                setHoldings(prev => prev.map(h => h.id === id ? data : h));
            }
        } catch (e) {
            console.error('Update failed', e);
            setHoldings(previousHoldings);
        }
    };

    // Calculate totals
    const totalValue = holdings.reduce((sum, h) => sum + (h.shares * (prices[h.ticker] || getMockPrice(h.ticker))), 0);
    const totalCost = holdings.reduce((sum, h) => sum + (h.shares * h.average_cost), 0);
    const totalReturnDollars = totalValue - totalCost;
    const totalReturnPercent = totalCost > 0 ? (totalReturnDollars / totalCost) * 100 : 0;

    const isUp = totalReturnDollars >= 0;
    const TREND_COLOR = isUp ? '#00C805' : '#FF5000';

    if (loading) {
        return <div className="animate-pulse h-32 bg-white/5 rounded-xl border border-white/10 mt-8 mb-16"></div>;
    }

    return (
        <div className="w-full font-sans text-white pb-8">
            <div className="flex flex-col gap-6 md:gap-8">

                {/* Header Section */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                    <div>
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white/90 mb-2">Portfolio Holdings</h2>
                        <div className="text-[40px] sm:text-[56px] font-medium tracking-tight leading-none" style={{ fontFamily: 'SF Pro Display, Inter, sans-serif' }}>
                            ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-[17px] font-semibold mt-2 flex items-center gap-1.5" style={{ color: TREND_COLOR }}>
                            <span>
                                {isUp ? '+' : '-'}${Math.abs(totalReturnDollars).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                {' '}({isUp ? '+' : ''}{totalReturnPercent.toFixed(2)}%)
                            </span>
                            <span className="text-white/40 ml-1 font-normal">All Time</span>
                        </div>
                    </div>

                    {/* Inline Form */}
                    <form onSubmit={handleAdd} className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full md:w-auto bg-[#111114] p-2 rounded-2xl border border-white/10 shadow-lg relative z-10">
                        <div className="relative w-full sm:w-28 flex-shrink-0">
                            <input
                                type="text"
                                placeholder="TICKER"
                                value={ticker}
                                onChange={(e) => { setTicker(e.target.value.toUpperCase()); setShowResults(true); }}
                                onBlur={() => setTimeout(() => setShowResults(false), 200)}
                                className="bg-black/50 border border-white/10 rounded-xl px-4 py-2 w-full text-sm focus:outline-none focus:border-white/30 uppercase placeholder-white/30 font-bold"
                                required
                            />
                            <AnimatePresence>
                                {showResults && searchResults.length > 0 && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        className="absolute top-[calc(100%+8px)] left-0 w-64 bg-[#111114] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col"
                                    >
                                        {searchResults.map((res, i) => (
                                            <div
                                                key={i}
                                                className="px-4 py-2.5 hover:bg-white/10 cursor-pointer flex justify-between items-center transition-colors border-b last:border-0 border-white/5 text-left"
                                                onClick={() => handleSelectStock(res.symbol)}
                                            >
                                                <span className="font-bold text-white text-[13px]">{res.symbol}</span>
                                                <span className="text-white/40 text-[11px] truncate flex-1 ml-3 text-right">{res.name}</span>
                                            </div>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        <input
                            type="number"
                            step="any"
                            placeholder="Shares"
                            value={shares}
                            onChange={(e) => setShares(e.target.value)}
                            className="bg-black/50 border border-white/10 rounded-xl px-4 py-2 w-full sm:w-28 text-sm focus:outline-none focus:border-white/30 placeholder-white/30 font-medium"
                            required
                        />
                        <input
                            type="number"
                            step="any"
                            placeholder="Avg Cost"
                            value={averageCost}
                            onChange={(e) => setAverageCost(e.target.value)}
                            className="bg-black/50 border border-white/10 rounded-xl px-4 py-2 w-full sm:w-28 text-sm focus:outline-none focus:border-white/30 placeholder-white/30 font-medium"
                            required
                        />
                        <button
                            type="submit"
                            disabled={isAdding}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#00C805] text-black font-bold px-5 py-2 rounded-xl hover:bg-[#00e005] hover:scale-105 transition-all shadow-[0_0_15px_rgba(0,200,5,0.2)]"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Add</span>
                        </button>
                    </form>
                </div>

                {/* Holdings Grid */}
                <div className="w-full">
                    {holdings.length === 0 ? (
                        <div className="border border-white/5 rounded-2xl bg-white/5 border-dashed p-12 text-center flex flex-col items-center justify-center">
                            <Layers className="w-10 h-10 text-white/20 mb-3" />
                            <p className="text-white/40 text-sm font-medium">Your portfolio is empty. Add a position above to start tracking.</p>
                        </div>
                    ) : (
                        <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#111114]">
                            {/* Table Header */}
                            <div className="grid grid-cols-6 sm:grid-cols-7 gap-4 px-6 py-3 border-b border-white/10 bg-[#1A1A1E] text-xs font-bold tracking-widest uppercase text-white/40">
                                <div className="col-span-2 sm:col-span-1">Ticker</div>
                                <div className="text-right">Shares</div>
                                <div className="text-right hidden sm:block">Avg Cost</div>
                                <div className="text-right">Price</div>
                                <div className="text-right col-span-2">Total / Return</div>
                            </div>

                            {/* Table Rows */}
                            <div className="divide-y divide-white/5">
                                <AnimatePresence>
                                    {holdings.map((item) => {
                                        const currentPrice = prices[item.ticker] || getMockPrice(item.ticker);
                                        const value = item.shares * currentPrice;
                                        const cost = item.shares * item.average_cost;
                                        const retDollar = value - cost;
                                        const retPercent = cost > 0 ? (retDollar / cost) * 100 : 0;
                                        const itemIsUp = retDollar >= 0;
                                        const itemColor = itemIsUp ? '#00C805' : '#FF5000';

                                        return (
                                            <motion.div
                                                key={item.id}
                                                layout
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.95, height: 0, padding: 0, margin: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="group hover:bg-white/5 transition-colors relative block w-full"
                                            >
                                                <div className="grid grid-cols-6 sm:grid-cols-7 gap-4 px-6 py-4 w-full items-center">
                                                    <div className="col-span-2 sm:col-span-1 font-bold text-white tracking-wide text-lg uppercase">
                                                        {item.ticker}
                                                    </div>
                                                    {editingId === item.id ? (
                                                        <>
                                                            <div className="col-span-1 text-right">
                                                                <input type="number" step="any" className="bg-black/50 border border-white/20 rounded px-2 py-1 w-full text-right text-sm focus:outline-none focus:border-white/50 text-white font-medium" value={editShares} onChange={e => setEditShares(e.target.value)} />
                                                            </div>
                                                            <div className="col-span-1 text-right hidden sm:block">
                                                                <input type="number" step="any" className="bg-black/50 border border-white/20 rounded px-2 py-1 w-full text-right text-sm focus:outline-none focus:border-white/50 text-white font-medium" value={editAverageCost} onChange={e => setEditAverageCost(e.target.value)} />
                                                            </div>
                                                            <div className="text-right font-medium text-white/90">
                                                                ${currentPrice.toFixed(2)}
                                                            </div>
                                                            <div className="text-right col-span-2 flex flex-col sm:flex-row items-end sm:justify-end gap-2">
                                                                <div className="flex bg-black rounded-lg overflow-hidden border border-white/10 shadow-lg">
                                                                    <button onClick={() => handleEditSave(item.id)} className="p-1.5 hover:bg-[#00C805]/20 text-[#00C805] transition-colors" title="Save"><Check className="w-4 h-4" /></button>
                                                                    <button onClick={cancelEditing} className="p-1.5 hover:bg-red-500/20 text-red-500 transition-colors border-l border-white/10" title="Cancel"><X className="w-4 h-4" /></button>
                                                                </div>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className="text-right font-medium text-white/90">
                                                                {item.shares.toLocaleString()}
                                                            </div>
                                                            <div className="text-right font-medium text-white/50 hidden sm:block">
                                                                ${item.average_cost.toFixed(2)}
                                                            </div>
                                                            <div className="text-right font-medium text-white/90">
                                                                ${currentPrice.toFixed(2)}
                                                            </div>
                                                            <div className="text-right col-span-2 flex flex-col items-end">
                                                                <span className="font-bold text-base">${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                                <span className="text-xs font-semibold mt-0.5 flex items-center gap-1" style={{ color: itemColor }}>
                                                                    {itemIsUp ? '+' : ''}{retPercent.toFixed(2)}%
                                                                </span>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>

                                                {/* Hover Trash / Edit Icon */}
                                                {editingId !== item.id && (
                                                    <div className="absolute right-6 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end pl-12 h-full gap-2 z-10 pointer-events-none">
                                                        <div className="pointer-events-auto flex items-center justify-center translate-x-3 group-hover:translate-x-0 transition-transform bg-gradient-to-l from-[#111114] via-[#111114] to-transparent pl-8 h-full space-x-2">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); startEditing(item); }}
                                                                className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                                                                title="Edit"
                                                            >
                                                                <Edit2 className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                                                                className="p-1.5 rounded-full bg-red-500/5 hover:bg-red-500/10 text-red-500/50 hover:text-red-500 transition-colors"
                                                                title="Delete"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </motion.div>
                                        );
                                    })}
                                </AnimatePresence>
                            </div>
                        </div>
                    )}
                </div>

                {/* The Bridge to AI (CTA) */}
                <div className="mt-6 mb-4 flex justify-center w-full relative z-10">
                    <button
                        onClick={() => setIsChatOpen(true)}
                        className="group relative flex items-center gap-4 bg-gradient-to-r from-[#00C805]/[0.05] via-[#00C805]/[0.15] to-[#00C805]/[0.05] border border-[#00C805]/30 hover:border-[#00C805]/80 rounded-full px-8 py-3.5 transition-all overflow-hidden shadow-[0_0_20px_rgba(0,200,5,0.05)] hover:shadow-[0_0_30px_rgba(0,200,5,0.2)] hover:scale-[1.02]">
                        {/* Glow Sweep */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#00C805]/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>

                        {/* Agent Avatars */}
                        <div className="flex -space-x-2.5">
                            <div className="w-8 h-8 rounded-full border-2 border-[#111114] bg-[#1E1E24] overflow-hidden shrink-0 shadow-sm relative z-[4]"><img src="/avatars/The Bull.svg" alt="Bull" className="w-full h-full object-cover" /></div>
                            <div className="w-8 h-8 rounded-full border-2 border-[#111114] bg-[#1E1E24] overflow-hidden shrink-0 shadow-sm relative z-[3]"><img src="/avatars/bear.svg" alt="Bear" className="w-full h-full object-cover" /></div>
                            <div className="w-8 h-8 rounded-full border-2 border-[#111114] bg-[#1E1E24] overflow-hidden shrink-0 shadow-sm relative z-[2]"><img src="/avatars/The Quant.svg" alt="Quant" className="w-full h-full object-cover" /></div>
                            <div className="w-8 h-8 rounded-full border-2 border-[#111114] bg-[#1E1E24] overflow-hidden shrink-0 shadow-sm relative z-[1]"><img src="/avatars/The CIO Agent.svg" alt="CIO" className="w-full h-full object-cover" /></div>
                        </div>

                        {/* Text */}
                        <span className="font-bold text-white/90 group-hover:text-white tracking-wide transition-all z-10 drop-shadow-sm text-sm sm:text-base">
                            Consult the AI Portfolio Doctor
                        </span>
                    </button>
                </div>

            </div>

            <PortfolioDoctorChat isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
        </div>
    );
}

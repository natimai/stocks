'use client';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Plus, Layers, Edit2, Check, X, AlertTriangle } from 'lucide-react';
import { auth } from '../lib/firebase';
import PortfolioDoctorChat from './PortfolioDoctorChat';
import { apiDelete, apiGet, apiPost, apiPut } from '../lib/apiClient';

// Returns null when price is unavailable — never show a fake price
const getMockPrice = (ticker) => null;


export default function PortfolioManager() {
    const [holdings, setHoldings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [ticker, setTicker] = useState('');
    const [shares, setShares] = useState('');
    const [averageCost, setAverageCost] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [prices, setPrices] = useState({});
    const [dailyChanges, setDailyChanges] = useState({});
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

    useEffect(() => {
        const uniqueTickers = [...new Set(holdings.map(h => h.ticker))];
        uniqueTickers.forEach(async (t) => {
            if (!fetchedTickers.current.has(t)) {
                fetchedTickers.current.add(t);
                try {
                    const { data } = await apiGet(`/api/quick-stats/${encodeURIComponent(t)}`, { retries: 1, timeoutMs: 10000 });
                    setPrices(prev => ({ ...prev, [t]: data?.price ?? getMockPrice(t) }));
                    setDailyChanges(prev => ({ ...prev, [t]: data?.changePercent ?? 0 }));
                } catch (e) {
                    setPrices(prev => ({ ...prev, [t]: getMockPrice(t) }));
                    setDailyChanges(prev => ({ ...prev, [t]: 0 }));
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
                    const { data } = await apiGet(`/api/search?q=${encodeURIComponent(ticker)}`, { retries: 1, timeoutMs: 10000 });
                    const normalized = Array.isArray(data) ? data : [];
                    setSearchResults(normalized);
                    setShowResults(normalized.length > 0);
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
            const { data } = await apiGet('/api/portfolio', { authToken: token, retries: 1 });
            setHoldings(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error('Failed to fetch portfolio', e);
        } finally {
            setLoading(false);
        }
    };

    const [addError, setAddError] = useState('');

    const handleAdd = async (e) => {
        e.preventDefault();
        setAddError('');

        // Input validation
        const parsedShares = parseFloat(shares);
        const parsedCost = parseFloat(averageCost);

        if (!ticker.trim()) return setAddError('Enter a ticker symbol.');
        if (!shares || isNaN(parsedShares) || parsedShares <= 0) return setAddError('Shares must be a positive number.');
        if (!averageCost || isNaN(parsedCost) || parsedCost <= 0) return setAddError('Average cost must be a positive number.');
        if (!auth.currentUser) return setAddError('Please sign in first.');

        // Prevent adding same ticker twice
        if (holdings.some(h => h.ticker.toUpperCase() === ticker.toUpperCase())) {
            return setAddError(`${ticker.toUpperCase()} already exists. Edit the existing row instead.`);
        }

        const newItem = {
            id: `temp-${Date.now()}`,
            ticker: ticker.toUpperCase(),
            shares: parsedShares,
            average_cost: parsedCost,
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
            const { data } = await apiPost(
                '/api/portfolio',
                {
                    ticker: currentTicker,
                    shares: parsedShares,
                    average_cost: parsedCost,
                },
                { authToken: token, retries: 1 }
            );
            // Replace temp ID with actual DB ID
            setHoldings(prev => prev.map(h => h.id === newItem.id ? data : h));
        } catch (e) {
            console.error('Add failed', e);
            setHoldings(prev => prev.filter(h => h.id !== newItem.id));
            setAddError('Network error. Please try again.');
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
            await apiDelete(`/api/portfolio/${encodeURIComponent(id)}`, {
                authToken: token,
                retries: 1,
            });
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
            const { data } = await apiPut(
                `/api/portfolio/${encodeURIComponent(id)}`,
                {
                    ticker: currentItem.ticker,
                    shares: newShares,
                    average_cost: newAvgCost,
                },
                { authToken: token, retries: 1 }
            );
            setHoldings(prev => prev.map(h => h.id === id ? data : h));
        } catch (e) {
            console.error('Update failed', e);
            setHoldings(previousHoldings);
        }
    };

    const totalValue = holdings.reduce((sum, h) => {
        const p = prices[h.ticker];
        return p != null ? sum + (h.shares * p) : sum;
    }, 0);
    const totalCost = holdings.reduce((sum, h) => {
        const p = prices[h.ticker];
        return p != null ? sum + (h.shares * h.average_cost) : sum;
    }, 0);
    const totalReturnDollars = totalValue - totalCost;

    const todayReturnDollars = holdings.reduce((sum, h) => {
        const dayChange = dailyChanges[h.ticker];
        return dayChange != null ? sum + (h.shares * dayChange) : sum;
    }, 0);
    const previousTotalValue = totalValue - todayReturnDollars;
    const todayReturnPercent = previousTotalValue > 0 ? (todayReturnDollars / previousTotalValue) * 100 : 0;
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
                        <div className="flex flex-col sm:flex-row gap-4 mt-2">
                            <div className="text-[17px] font-semibold flex items-center gap-1.5" style={{ color: todayReturnDollars >= 0 ? '#00C805' : '#FF5000' }}>
                                <span>
                                    {todayReturnDollars >= 0 ? '+' : '-'}${Math.abs(todayReturnDollars).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    {' '}({todayReturnDollars >= 0 ? '+' : ''}{todayReturnPercent.toFixed(2)}%)
                                </span>
                                <span className="text-white/40 ml-1 font-normal text-sm">Today</span>
                            </div>
                            <div className="text-[15px] font-semibold flex items-center gap-1.5" style={{ color: TREND_COLOR }}>
                                <span>
                                    {isUp ? '+' : '-'}${Math.abs(totalReturnDollars).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    {' '}({isUp ? '+' : ''}{totalReturnPercent.toFixed(2)}%)
                                </span>
                                <span className="text-white/40 ml-1 font-normal text-sm">All Time</span>
                            </div>
                        </div>
                    </div>

                    {/* Inline Form */}
                    <form onSubmit={handleAdd} className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full md:w-auto bg-[#111114] p-2 rounded-2xl border border-white/10 shadow-lg relative z-10">
                        <div className="relative w-full sm:w-28 flex-shrink-0">
                            <input
                                type="text"
                                aria-label="Ticker symbol"
                                placeholder="TICKER"
                                value={ticker}
                                onChange={(e) => { setTicker(e.target.value.toUpperCase()); setShowResults(true); }}
                                onBlur={() => setTimeout(() => setShowResults(false), 200)}
                                className="bg-black/50 border border-white/10 rounded-xl px-4 py-2 w-full min-h-[44px] text-base sm:text-sm focus:outline-none focus:border-white/30 uppercase placeholder-white/30 font-bold"
                                required
                            />
                            <AnimatePresence>
                                {showResults && searchResults.length > 0 && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -5 }}
                                        className="absolute top-[calc(100%+8px)] left-0 w-full sm:w-64 max-w-[calc(100vw-2rem)] bg-[#111114] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col"
                                    >
                                        {searchResults.map((res, i) => (
                                            <button
                                                type="button"
                                                key={i}
                                                className="w-full text-left px-4 py-2.5 hover:bg-white/10 cursor-pointer flex justify-between items-center transition-colors border-b last:border-0 border-white/5"
                                                onClick={() => handleSelectStock(res.symbol)}
                                            >
                                                <span className="font-bold text-white text-[13px]">{res.symbol}</span>
                                                <span className="text-white/40 text-[11px] truncate flex-1 ml-3 text-right">{res.name}</span>
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        <input
                            type="number"
                            step="any"
                            aria-label="Number of shares"
                            placeholder="Shares"
                            value={shares}
                            onChange={(e) => setShares(e.target.value)}
                            className="bg-black/50 border border-white/10 rounded-xl px-4 py-2 w-full sm:w-28 min-h-[44px] text-base sm:text-sm focus:outline-none focus:border-white/30 placeholder-white/30 font-medium"
                            required
                        />
                        <input
                            type="number"
                            step="any"
                            aria-label="Average cost"
                            placeholder="Avg Cost"
                            value={averageCost}
                            onChange={(e) => setAverageCost(e.target.value)}
                            className="bg-black/50 border border-white/10 rounded-xl px-4 py-2 w-full sm:w-28 min-h-[44px] text-base sm:text-sm focus:outline-none focus:border-white/30 placeholder-white/30 font-medium"
                            required
                        />
                        <button
                            type="submit"
                            disabled={isAdding}
                            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 bg-[#00C805] text-black font-bold px-5 py-2 rounded-xl hover:bg-[#00e005] hover:scale-105 transition-all shadow-[0_0_15px_rgba(0,200,5,0.2)]"
                        >
                            <Plus className="w-4 h-4" />
                            <span>Add</span>
                        </button>
                    </form>
                </div>

                {/* Validation Error */}
                {addError && (
                    <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5 -mt-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{addError}</span>
                        <button type="button" onClick={() => setAddError('')} aria-label="Dismiss error" className="touch-target ml-auto text-red-400/60 hover:text-red-400 transition-colors text-xs">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                {/* Allocation Bar */}
                {holdings.length > 0 && totalValue > 0 && (
                    <div className="flex flex-col gap-2 mb-2">
                        <div className="w-full h-2 sm:h-3 bg-white/5 rounded-full overflow-hidden flex shadow-inner">
                            {holdings.map((h, i) => {
                                const val = prices[h.ticker] ? h.shares * prices[h.ticker] : 0;
                                const pct = (val / totalValue) * 100;
                                if (pct === 0) return null;
                                const colors = ['#0A84FF', '#FF9F0A', '#30D158', '#FF453A', '#BF5AF2', '#5E5CE6', '#FF375F', '#32ADE6'];
                                return (
                                    <div
                                        key={h.id}
                                        style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }}
                                        className="h-full border-r border-black"
                                        title={`${h.ticker}: ${pct.toFixed(1)}%`}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Holdings Grid */}
                <div className="w-full">
                    {holdings.length === 0 ? (
                        <div className="border border-white/5 rounded-2xl bg-white/5 border-dashed p-12 text-center flex flex-col items-center justify-center">
                            <Layers className="w-10 h-10 text-white/20 mb-3" />
                            <p className="text-white/40 text-sm font-medium mb-5">Your portfolio is empty. Add a position above to start tracking.</p>
                            <button
                                type="button"
                                onClick={() => {
                                    const demoHoldings = [
                                        { id: 'demo1', ticker: 'AAPL', shares: 50, average_cost: 150 },
                                        { id: 'demo2', ticker: 'TSLA', shares: 20, average_cost: 180 },
                                        { id: 'demo3', ticker: 'MSFT', shares: 35, average_cost: 320 },
                                        { id: 'demo4', ticker: 'NVDA', shares: 15, average_cost: 650 },
                                    ];
                                    demoHoldings.forEach(async (item) => {
                                        if (auth.currentUser) {
                                            const token = await auth.currentUser.getIdToken();
                                            await apiPost(
                                                '/api/portfolio',
                                                { ticker: item.ticker, shares: item.shares, average_cost: item.average_cost },
                                                { authToken: token, retries: 0 }
                                            );
                                        }
                                    });
                                    setHoldings(demoHoldings);
                                }}
                                className="touch-target min-h-[44px] bg-white/10 hover:bg-white/20 text-white font-bold px-6 py-2.5 rounded-full transition-colors text-sm border border-white/10"
                            >
                                Load Demo Portfolio
                            </button>
                        </div>
                    ) : (
                        <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#111114]">
                            {/* Table Header */}
                            <div className="hidden md:grid grid-cols-8 gap-4 px-6 py-3 border-b border-white/10 bg-[#1A1A1E] text-xs font-bold tracking-widest uppercase text-white/40 items-center">
                                <div className="col-span-2">Ticker</div>
                                <div className="text-right">Shares</div>
                                <div className="text-right">Avg Cost</div>
                                <div className="text-right">Price</div>
                                <div className="text-right col-span-2">Total / Return</div>
                                <div className="text-right">Actions</div>
                            </div>

                            {/* Table Rows */}
                            <div className="divide-y divide-white/5">
                                <AnimatePresence>
                                    {holdings.map((item) => {
                                        const currentPrice = prices[item.ticker];
                                        const hasPriceData = currentPrice != null;
                                        const value = hasPriceData ? item.shares * currentPrice : null;
                                        const cost = item.shares * item.average_cost;
                                        const retDollar = hasPriceData ? value - cost : null;
                                        const retPercent = hasPriceData && cost > 0 ? (retDollar / cost) * 100 : null;
                                        const itemIsUp = hasPriceData ? retDollar >= 0 : true;
                                        const itemColor = itemIsUp ? '#00C805' : '#FF5000';

                                        return (
                                            <motion.div
                                                key={item.id}
                                                layout
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.95, height: 0, padding: 0, margin: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="hidden md:block group hover:bg-white/5 transition-colors relative w-full border-b last:border-0 border-white/5"
                                            >
                                                <div className="hidden md:grid grid-cols-8 gap-4 px-6 py-4 w-full items-center">
                                                    <div className="col-span-2 font-bold text-white tracking-wide text-sm sm:text-lg uppercase break-all flex items-center gap-2">
                                                        <div
                                                            className="w-2 h-2 rounded-full hidden sm:block shrink-0"
                                                            style={{ backgroundColor: ['#0A84FF', '#FF9F0A', '#30D158', '#FF453A', '#BF5AF2', '#5E5CE6', '#FF375F', '#32ADE6'][holdings.findIndex(h => h.id === item.id) % 8] }}
                                                        />
                                                        {item.ticker}
                                                    </div>

                                                    {editingId === item.id ? (
                                                        <>
                                                            <div className="text-right">
                                                                <input type="number" step="any" aria-label={`Edit ${item.ticker} shares`} className="bg-black/50 border border-white/20 rounded px-1 sm:px-2 py-1 w-full text-right text-sm focus:outline-none focus:border-white/50 text-white font-medium" value={editShares} onChange={e => setEditShares(e.target.value)} />
                                                            </div>
                                                            <div className="text-right">
                                                                <input type="number" step="any" aria-label={`Edit ${item.ticker} average cost`} className="bg-black/50 border border-white/20 rounded px-1 sm:px-2 py-1 w-full text-right text-sm focus:outline-none focus:border-white/50 text-white font-medium" value={editAverageCost} onChange={e => setEditAverageCost(e.target.value)} />
                                                            </div>
                                                            <div className="text-right font-medium text-white/90 text-sm sm:text-base">
                                                                {currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—"}
                                                            </div>
                                                            <div className="flex text-right col-span-2 flex-col items-end">
                                                                <span className="font-bold text-base">{value != null ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</span>
                                                                <span className="text-xs font-semibold mt-0.5 flex items-center gap-1" style={{ color: itemColor }}>
                                                                    {retPercent != null ? `${itemIsUp ? '+' : ''}${retPercent.toFixed(2)}%` : '—'}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-end items-center gap-[2px] sm:gap-1">
                                                                <button type="button" onClick={() => handleEditSave(item.id)} aria-label={`Save ${item.ticker}`} className="touch-target p-1 sm:p-2 rounded bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-colors" title="Save"><Check className="w-4 h-4 sm:w-5 sm:h-5" /></button>
                                                                <button type="button" onClick={cancelEditing} aria-label="Cancel editing" className="touch-target p-1 sm:p-2 rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors" title="Cancel"><X className="w-4 h-4 sm:w-5 sm:h-5" /></button>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div className="text-right font-medium text-white/90 text-sm sm:text-base">
                                                                {item.shares.toLocaleString()}
                                                            </div>
                                                            <div className="text-right font-medium text-white/50">
                                                                ${item.average_cost.toFixed(2)}
                                                            </div>
                                                            <div className="text-right font-medium text-white/90 text-sm sm:text-base">
                                                                {currentPrice != null ? `$${currentPrice.toFixed(2)}` : "—"}
                                                            </div>
                                                            <div className="flex text-right col-span-2 flex-col items-end">
                                                                <span className="font-bold text-base">{value != null ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</span>
                                                                <span className="text-xs font-semibold mt-0.5 flex items-center gap-1" style={{ color: itemColor }}>
                                                                    {retPercent != null ? `${itemIsUp ? '+' : ''}${retPercent.toFixed(2)}%` : '—'}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-end items-center gap-1 sm:gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEditing(item); }}
                                                                    aria-label={`Edit ${item.ticker}`}
                                                                    className="touch-target p-1.5 sm:p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-white/70 hover:text-white transition-colors"
                                                                    title="Edit"
                                                                >
                                                                    <Edit2 className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(item.id); }}
                                                                    aria-label={`Delete ${item.ticker}`}
                                                                    className="touch-target p-1.5 sm:p-2 rounded-lg bg-red-500/5 hover:bg-red-500/15 border border-red-500/10 text-red-500/70 hover:text-red-500 transition-colors"
                                                                    title="Delete"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </AnimatePresence>
                            </div>

                            {/* Mobile Cards */}
                            <div className="md:hidden divide-y divide-white/5">
                                {holdings.map((item) => {
                                    const currentPrice = prices[item.ticker];
                                    const hasPriceData = currentPrice != null;
                                    const value = hasPriceData ? item.shares * currentPrice : null;
                                    const cost = item.shares * item.average_cost;
                                    const retDollar = hasPriceData ? value - cost : null;
                                    const retPercent = hasPriceData && cost > 0 ? (retDollar / cost) * 100 : null;
                                    const itemIsUp = hasPriceData ? retDollar >= 0 : true;
                                    const itemColor = itemIsUp ? '#00C805' : '#FF5000';

                                    return (
                                        <div key={`mobile-${item.id}`} className="p-4 space-y-3">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="font-bold text-base tracking-wide uppercase text-white">{item.ticker}</p>
                                                    <p className="text-xs text-white/45 mt-0.5">Shares: {item.shares.toLocaleString()}</p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); startEditing(item); }}
                                                        aria-label={`Edit ${item.ticker}`}
                                                        className="touch-target p-2 rounded-lg bg-white/5 border border-white/5 text-white/70"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(item.id); }}
                                                        aria-label={`Delete ${item.ticker}`}
                                                        className="touch-target p-2 rounded-lg bg-red-500/5 border border-red-500/10 text-red-500/70"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>

                                            {editingId === item.id ? (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input
                                                        type="number"
                                                        step="any"
                                                        aria-label={`Edit ${item.ticker} shares`}
                                                        value={editShares}
                                                        onChange={e => setEditShares(e.target.value)}
                                                        className="bg-black/50 border border-white/20 rounded-lg px-3 py-2 min-h-[44px] text-base sm:text-sm text-white focus:outline-none focus:border-white/50"
                                                        placeholder="Shares"
                                                    />
                                                    <input
                                                        type="number"
                                                        step="any"
                                                        aria-label={`Edit ${item.ticker} average cost`}
                                                        value={editAverageCost}
                                                        onChange={e => setEditAverageCost(e.target.value)}
                                                        className="bg-black/50 border border-white/20 rounded-lg px-3 py-2 min-h-[44px] text-base sm:text-sm text-white focus:outline-none focus:border-white/50"
                                                        placeholder="Avg Cost"
                                                    />
                                                    <button type="button" aria-label={`Save ${item.ticker}`} onClick={() => handleEditSave(item.id)} className="touch-target bg-green-500/10 text-green-500 rounded-lg min-h-[44px] text-sm font-medium">Save</button>
                                                    <button type="button" aria-label="Cancel editing" onClick={cancelEditing} className="touch-target bg-red-500/10 text-red-400 rounded-lg min-h-[44px] text-sm font-medium">Cancel</button>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                                    <span className="text-white/50">Avg Cost</span>
                                                    <span className="text-right text-white/90">${item.average_cost.toFixed(2)}</span>
                                                    <span className="text-white/50">Price</span>
                                                    <span className="text-right text-white/90">{currentPrice != null ? `$${currentPrice.toFixed(2)}` : '—'}</span>
                                                    <span className="text-white/50">Total Value</span>
                                                    <span className="text-right text-white/90 font-medium">{value != null ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span>
                                                    <span className="text-white/50">Return</span>
                                                    <span className="text-right font-medium" style={{ color: itemColor }}>
                                                        {retPercent != null ? `${itemIsUp ? '+' : ''}${retPercent.toFixed(2)}%` : '—'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* The Bridge to AI (CTA) */}
                <div className="mt-6 mb-4 flex justify-center w-full relative z-10">
                    <button
                        type="button"
                        onClick={() => setIsChatOpen(true)}
                        className="touch-target group relative flex items-center gap-4 bg-gradient-to-r from-[#00C805]/[0.05] via-[#00C805]/[0.15] to-[#00C805]/[0.05] border border-[#00C805]/30 hover:border-[#00C805]/80 rounded-full px-8 py-3.5 transition-all overflow-hidden shadow-[0_0_20px_rgba(0,200,5,0.05)] hover:shadow-[0_0_30px_rgba(0,200,5,0.2)] hover:scale-[1.02]">
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

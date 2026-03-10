'use client';
import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2, Clock, X } from 'lucide-react';
import { apiGet } from '../lib/apiClient';

const HISTORY_KEY = 'consensusai_search_history';
const MAX_HISTORY = 8;

function getHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveToHistory(symbol, name) {
    try {
        const prev = getHistory().filter(h => h.symbol !== symbol);
        const next = [{ symbol, name }, ...prev].slice(0, MAX_HISTORY);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
}

function removeFromHistory(symbol) {
    try {
        const next = getHistory().filter(h => h.symbol !== symbol);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
}

export default function CommandPalette({ onSelect }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState([]);
    const wrapperRef = useRef(null);
    const inputRef = useRef(null);

    // Load history on mount (client-only)
    useEffect(() => {
        setHistory(getHistory());
    }, []);

    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, []);

    useEffect(() => {
        const fetchResults = async () => {
            if (query.trim().length === 0) {
                setResults([]);
                return;
            }
            setLoading(true);
            try {
                const { data } = await apiGet(`/api/search?q=${encodeURIComponent(query)}`, { retries: 1 });
                if (Array.isArray(data)) setResults(data);
            } catch {
                /* ignore */
            } finally {
                setLoading(false);
            }
        };

        const id = setTimeout(fetchResults, 300);
        return () => clearTimeout(id);
    }, [query]);

    const handleSelect = (symbol, name = '') => {
        saveToHistory(symbol, name);
        setHistory(getHistory());
        setQuery('');
        setIsOpen(false);
        onSelect(symbol);
    };

    const handleRemoveHistory = (e, symbol) => {
        e.stopPropagation();
        removeFromHistory(symbol);
        setHistory(getHistory());
    };

    const showHistory = isOpen && query.trim().length === 0 && history.length > 0;
    const showResults = isOpen && query.trim().length > 0;

    return (
        <div ref={wrapperRef} className="relative w-full md:max-w-md tap-highlight-none">
            {/* Input */}
            <div className="relative group">
                <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none transition-colors"
                    style={{ color: 'rgba(255,255,255,0.3)' }}
                />
                <input
                    ref={inputRef}
                    type="text"
                    aria-label="Search stock symbol"
                    placeholder="Search stock (e.g. AAPL, NVDA)..."
                    className="w-full min-h-[44px] pl-10 pr-10 py-2.5 rounded-xl bg-[#111114] border border-white/10 text-white text-base md:text-sm placeholder-white/30 focus:outline-none focus:border-white/30 focus:bg-[#1a1a1e] transition-all"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && query.trim()) {
                            e.preventDefault();
                            if (results.length > 0) {
                                handleSelect(results[0].symbol, results[0].name);
                            } else {
                                handleSelect(query.toUpperCase().trim());
                            }
                        }
                        if (e.key === 'Escape') setIsOpen(false);
                    }}
                />
                {loading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 w-4 h-4 animate-spin" />
                )}
            </div>

            {/* Dropdown */}
            {(showHistory || showResults) && (
                <div className="absolute z-50 w-full mt-2 bg-[#111114] rounded-xl shadow-2xl border border-white/10 overflow-hidden max-h-[min(60vh,420px)] overflow-y-auto">

                    {/* Recent Searches */}
                    {showHistory && (
                        <>
                            <div className="px-4 pt-3 pb-1 flex items-center gap-1.5">
                                <Clock className="w-3 h-3 text-white/25" />
                                <span className="text-[10px] font-bold uppercase tracking-widest text-white/25">Recent</span>
                            </div>
                            <ul>
                                {history.map((item) => (
                                    <li key={item.symbol} className="border-b border-white/5 last:border-0">
                                        <div className="group flex items-stretch">
                                            <button
                                                type="button"
                                                onClick={() => handleSelect(item.symbol, item.name)}
                                                className="flex-1 text-left px-4 py-2.5 min-h-[44px] hover:bg-white/5 flex items-center justify-between transition-colors"
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                                        <img
                                                            src={`https://img.logokit.com/ticker/${item.symbol}?token=pk_frfa213068bb8ffac35321&size=64`}
                                                            alt={item.symbol}
                                                            className="w-full h-full object-contain p-1"
                                                            onError={(e) => { e.target.style.display = 'none'; }}
                                                        />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <span className="font-bold text-white/90 text-sm block">{item.symbol}</span>
                                                        {item.name && <span className="text-xs text-white/35 truncate block">{item.name}</span>}
                                                    </div>
                                                </div>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => handleRemoveHistory(e, item.symbol)}
                                                aria-label={`Remove ${item.symbol} from recent searches`}
                                                className="touch-target px-2.5 flex items-center justify-center text-white/35 hover:text-white/70 hover:bg-white/5 transition-colors"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    {/* Search Results */}
                    {showResults && (
                        results.length > 0 ? (
                            <ul>
                                {results.map((item) => (
                                    <li key={item.symbol}>
                                        <button
                                            type="button"
                                            onClick={() => handleSelect(item.symbol, item.name)}
                                            className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-white/5 flex items-center justify-between transition-colors border-b border-white/5 last:border-0"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                                    <img
                                                        src={`https://img.logokit.com/ticker/${item.symbol}?token=pk_frfa213068bb8ffac35321&size=64`}
                                                        alt={item.symbol}
                                                        className="w-full h-full object-contain p-1"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                </div>
                                                <div className="min-w-0">
                                                    <span className="font-bold text-white/90 text-sm block">{item.symbol}</span>
                                                    <span className="text-xs text-white/40 truncate block">{item.name}</span>
                                                </div>
                                            </div>
                                            <span className="text-[10px] font-semibold bg-white/5 border border-white/10 text-white/40 px-2 py-1 rounded shrink-0">
                                                {item.exchange}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : !loading ? (
                            <div className="px-4 py-6 text-center text-white/30 text-sm">
                                No stocks found matching &quot;{query}&quot;
                            </div>
                        ) : null
                    )}
                </div>
            )}
        </div>
    );
}

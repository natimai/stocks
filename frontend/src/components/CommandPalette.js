import React, { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';

export default function CommandPalette({ onSelect }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const wrapperRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    useEffect(() => {
        const fetchResults = async () => {
            if (query.trim().length === 0) {
                setResults([]);
                return;
            }
            setLoading(true);
            try {
                const res = await fetch(`https://quantai-backend-316459358121.europe-west1.run.app/api/search?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    setResults(data);
                }
            } catch (error) {
                console.error("Search failed", error);
            } finally {
                setLoading(false);
            }
        };

        const timeoutId = setTimeout(() => {
            fetchResults();
        }, 300); // 300ms debounce

        return () => clearTimeout(timeoutId);
    }, [query]);

    const handleSelect = (ticker) => {
        setQuery('');
        setIsOpen(false);
        onSelect(ticker);
    };

    return (
        <div ref={wrapperRef} className="relative w-full md:max-w-md">
            <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 group-focus-within:text-blue-500 transition-colors" />
                <input
                    type="text"
                    placeholder="Search any US Stock (e.g. AAPL, NVDA)..."
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm placeholder-slate-400"
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
                                handleSelect(results[0].symbol);
                            } else {
                                handleSelect(query.toUpperCase().trim());
                            }
                        }
                    }}
                />
                {loading && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 animate-spin" />
                )}
            </div>

            {isOpen && (query.trim().length > 0 || results.length > 0) && (
                <div className="absolute z-50 w-full mt-2 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in slide-in-from-top-2">
                    {results.length > 0 ? (
                        <ul>
                            {results.map((item) => (
                                <li key={item.symbol}>
                                    <button
                                        type="button"
                                        onClick={() => handleSelect(item.symbol)}
                                        className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center justify-between transition-colors border-b border-slate-100 dark:border-slate-700/50 last:border-0"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center overflow-hidden shrink-0">
                                                <img
                                                    src={`https://img.logokit.com/ticker/${item.symbol}?token=pk_frfa213068bb8ffac35321&size=64`}
                                                    alt={item.symbol}
                                                    className="w-full h-full object-contain p-1.5"
                                                    onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                                                />
                                            </div>
                                            <div>
                                                <span className="font-bold text-slate-900 dark:text-white block">
                                                    {item.symbol}
                                                </span>
                                                <span className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                                                    {item.name}
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 px-2 py-1 rounded">
                                            {item.exchange}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        !loading && query.trim().length > 0 && (
                            <div className="px-4 py-6 text-center text-slate-500 text-sm">
                                No stocks found matching "{query}"
                            </div>
                        )
                    )}
                </div>
            )}
        </div>
    );
}

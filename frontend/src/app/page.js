"use client";

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import AppErrorBoundary from '../components/AppErrorBoundary';

const HomeDashboard = dynamic(() => import('../components/HomeDashboard'), {
    ssr: false,
});

const StockDashboard = dynamic(() => import('../components/StockDashboard'), {
    ssr: false,
    loading: () => (
        <div className="min-h-[280px] flex items-center justify-center text-white/50">
            Loading stock dashboard...
        </div>
    ),
});

export default function Home() {
    const [activeTicker, setActiveTicker] = useState(null);

    // Navigate from the homepage into the detail view
    const handleSearch = (ticker) => {
        if (ticker) setActiveTicker(ticker.trim().toUpperCase());
    };

    // Return to the homepage
    const handleBack = () => {
        setActiveTicker(null);
    };

    return (
        <main>
            <AnimatePresence mode="wait">
                {!activeTicker ? (
                    <AppErrorBoundary>
                        <motion.div
                            key="home"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, y: -12 }}
                            transition={{ duration: 0.3 }}
                        >
                            <HomeDashboard onSearch={handleSearch} />
                        </motion.div>
                    </AppErrorBoundary>
                ) : (
                    <AppErrorBoundary>
                        <motion.div
                            key={`stock-${activeTicker}`}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        >
                            <StockDashboard
                                initialTicker={activeTicker}
                                onBack={handleBack}
                            />
                        </motion.div>
                    </AppErrorBoundary>
                )}
            </AnimatePresence>
        </main>
    );
}

"use client";

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import HomeDashboard from '../components/HomeDashboard';
import StockDashboard from '../components/StockDashboard';

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
                    <motion.div
                        key="home"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.3 }}
                    >
                        <HomeDashboard onSearch={handleSearch} />
                    </motion.div>
                ) : (
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
                )}
            </AnimatePresence>
        </main>
    );
}

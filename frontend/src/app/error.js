'use client';

import { useEffect } from 'react';

import { getApiBaseUrl } from '../lib/apiClient';

export default function GlobalError({ error, reset }) {
    useEffect(() => {
        fetch(`${getApiBaseUrl()}/api/client-errors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: error?.message || 'Next.js global error',
                stack: error?.stack || null,
                url: typeof window !== 'undefined' ? window.location.href : null,
                userAgent: typeof window !== 'undefined' ? window.navigator?.userAgent : null,
                context: { source: 'next-global-error' },
            }),
            keepalive: true,
        }).catch(() => {
            // ignore telemetry failures
        });
    }, [error]);

    return (
        <html>
            <body className="min-h-screen bg-black text-white flex items-center justify-center p-6">
                <div className="max-w-lg text-center space-y-4">
                    <h2 className="text-2xl font-bold">Application Error</h2>
                    <p className="text-white/70">An unexpected error occurred. Try resetting the page.</p>
                    <button
                        type="button"
                        onClick={reset}
                        className="touch-target min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00C805] text-black font-bold"
                    >
                        Try again
                    </button>
                </div>
            </body>
        </html>
    );
}

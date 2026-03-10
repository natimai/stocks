'use client';

import React from 'react';

import { getApiBaseUrl } from '../lib/apiClient';

function reportError(error, errorInfo) {
    const payload = {
        message: error?.message || 'React render error',
        stack: error?.stack || null,
        url: typeof window !== 'undefined' ? window.location.href : null,
        userAgent: typeof window !== 'undefined' ? window.navigator?.userAgent : null,
        context: {
            componentStack: errorInfo?.componentStack || null,
            source: 'react-error-boundary',
        },
    };

    fetch(`${getApiBaseUrl()}/api/client-errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
    }).catch(() => {
        // ignore telemetry failures
    });
}

export default class AppErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        reportError(error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-[240px] rounded-2xl border border-red-500/30 bg-red-500/10 px-6 py-8 text-center flex flex-col items-center justify-center gap-3">
                    <h2 className="text-lg font-bold text-white">Something went wrong</h2>
                    <p className="text-sm text-white/70 max-w-md">
                        We captured the error for investigation. Refresh the page and try again.
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            this.setState({ hasError: false });
                            if (typeof window !== 'undefined') window.location.reload();
                        }}
                        className="touch-target min-h-[44px] px-5 py-2.5 rounded-xl bg-[#00C805] text-black font-bold"
                    >
                        Reload
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

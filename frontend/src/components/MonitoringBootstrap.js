'use client';

import { useEffect } from 'react';

import { getApiBaseUrl } from '../lib/apiClient';

function reportToBackend(payload) {
    try {
        const url = `${getApiBaseUrl()}/api/client-errors`;
        const body = JSON.stringify(payload);

        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            const blob = new Blob([body], { type: 'application/json' });
            navigator.sendBeacon(url, blob);
            return;
        }

        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
        }).catch(() => {
            // ignore telemetry failures
        });
    } catch {
        // ignore telemetry failures
    }
}

function maybeInitSentry() {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn || typeof window === 'undefined') return;

    if (window.Sentry) {
        window.Sentry.init({
            dsn,
            environment: process.env.NEXT_PUBLIC_APP_ENV || 'development',
            tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.1),
        });
        return;
    }

    if (document.getElementById('sentry-browser-sdk')) return;

    const script = document.createElement('script');
    script.id = 'sentry-browser-sdk';
    script.async = true;
    script.src = 'https://browser.sentry-cdn.com/7.120.0/bundle.tracing.replay.min.js';
    script.onload = () => {
        if (window.Sentry) {
            window.Sentry.init({
                dsn,
                environment: process.env.NEXT_PUBLIC_APP_ENV || 'development',
                tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.1),
            });
        }
    };
    document.head.appendChild(script);
}

export default function MonitoringBootstrap() {
    useEffect(() => {
        maybeInitSentry();

        const onError = (event) => {
            const error = event?.error;
            reportToBackend({
                message: error?.message || event?.message || 'Unhandled error',
                stack: error?.stack || null,
                url: window.location.href,
                userAgent: window.navigator?.userAgent,
                context: {
                    source: event?.filename || null,
                    line: event?.lineno || null,
                    col: event?.colno || null,
                },
            });

            if (window.Sentry && error) {
                window.Sentry.captureException(error);
            }
        };

        const onUnhandledRejection = (event) => {
            const reason = event?.reason;
            const message =
                typeof reason === 'string'
                    ? reason
                    : reason?.message || 'Unhandled promise rejection';
            reportToBackend({
                message,
                stack: reason?.stack || null,
                url: window.location.href,
                userAgent: window.navigator?.userAgent,
                context: {
                    source: 'unhandledrejection',
                },
            });

            if (window.Sentry && reason) {
                window.Sentry.captureException(reason);
            }
        };

        window.addEventListener('error', onError);
        window.addEventListener('unhandledrejection', onUnhandledRejection);

        return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onUnhandledRejection);
        };
    }, []);

    return null;
}

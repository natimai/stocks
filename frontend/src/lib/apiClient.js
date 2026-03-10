const DEFAULT_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || 15000);
const DEFAULT_RETRIES = Number(process.env.NEXT_PUBLIC_API_RETRIES || 1);

const inflightGetRequests = new Map();

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class ApiClientError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'ApiClientError';
        this.status = options.status || 0;
        this.code = options.code || 'API_REQUEST_FAILED';
        this.details = options.details || null;
        this.requestId = options.requestId || null;
        this.retryable = Boolean(options.retryable);
        this.url = options.url || null;
    }
}

function randomHex(size = 16) {
    const chars = 'abcdef0123456789';
    let out = '';
    for (let i = 0; i < size; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

export function generateRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${randomHex(20)}`;
}

export function getApiBaseUrl() {
    const fromEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (fromEnv && fromEnv.trim()) {
        return fromEnv.replace(/\/$/, '');
    }

    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        return 'http://localhost:8000';
    }

    return '';
}

async function parseBody(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }

    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    } finally {
        clearTimeout(timeoutId);
    }
}

export function buildApiUrl(pathOrUrl) {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${getApiBaseUrl()}${path}`;
}

function shouldRetry(attempt, maxRetries, status) {
    if (attempt >= maxRetries) return false;
    return status === 0 || RETRYABLE_STATUS.has(status);
}

function backoff(attempt) {
    const base = 250;
    return base * (attempt + 1);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeApiError(payload, status, fallbackMessage, requestId, url) {
    const errorShape = payload && typeof payload === 'object' ? payload : null;
    const apiError = errorShape?.error || {};

    const message = errorShape?.detail || apiError?.message || fallbackMessage || 'Request failed';
    const code = apiError?.code || `HTTP_${status || 0}`;
    const details = apiError?.details || null;

    return new ApiClientError(message, {
        status,
        code,
        details,
        requestId: errorShape?.requestId || requestId,
        retryable: RETRYABLE_STATUS.has(status),
        url,
    });
}

export async function apiRequest(pathOrUrl, options = {}) {
    const {
        method = 'GET',
        body,
        headers = {},
        authToken,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        retries = DEFAULT_RETRIES,
        dedupe = true,
        dedupeKey,
    } = options;

    const upperMethod = method.toUpperCase();
    const url = buildApiUrl(pathOrUrl);
    const requestId = options.requestId || generateRequestId();

    const requestHeaders = {
        'X-Request-ID': requestId,
        ...headers,
    };

    if (authToken) {
        requestHeaders.Authorization = `Bearer ${authToken}`;
    }

    const hasBody = body !== undefined && body !== null;
    const payload = hasBody && typeof body !== 'string' ? JSON.stringify(body) : body;

    if (hasBody && typeof body !== 'string' && !requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = 'application/json';
    }

    const key = dedupeKey || `${upperMethod}:${url}:${payload || ''}`;

    const execute = async () => {
        for (let attempt = 0; ; attempt += 1) {
            let response;
            let responseBody = null;
            let responseRequestId = requestId;

            try {
                response = await fetchWithTimeout(
                    url,
                    {
                        method: upperMethod,
                        headers: requestHeaders,
                        body: payload,
                    },
                    timeoutMs
                );
                responseRequestId = response.headers.get('x-request-id') || requestId;
                responseBody = await parseBody(response);

                if (!response.ok) {
                    const err = normalizeApiError(responseBody, response.status, response.statusText, responseRequestId, url);
                    if (shouldRetry(attempt, retries, response.status)) {
                        await sleep(backoff(attempt));
                        continue;
                    }
                    throw err;
                }

                return {
                    data: responseBody,
                    status: response.status,
                    requestId: responseRequestId,
                    headers: response.headers,
                };
            } catch (error) {
                const isAbort = error?.name === 'AbortError';
                const status = response?.status || 0;
                const retry = shouldRetry(attempt, retries, status);

                if (retry) {
                    await sleep(backoff(attempt));
                    continue;
                }

                if (error instanceof ApiClientError) throw error;

                throw new ApiClientError(
                    isAbort ? 'Request timed out' : (error?.message || 'Network error'),
                    {
                        status,
                        code: isAbort ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
                        details: responseBody,
                        requestId: responseRequestId,
                        retryable: retry,
                        url,
                    }
                );
            }
        }
    };

    if (dedupe && upperMethod === 'GET') {
        if (inflightGetRequests.has(key)) {
            return inflightGetRequests.get(key);
        }
        const promise = execute().finally(() => inflightGetRequests.delete(key));
        inflightGetRequests.set(key, promise);
        return promise;
    }

    return execute();
}

export async function apiGet(pathOrUrl, options = {}) {
    return apiRequest(pathOrUrl, { ...options, method: 'GET' });
}

export async function apiPost(pathOrUrl, body, options = {}) {
    return apiRequest(pathOrUrl, { ...options, method: 'POST', body });
}

export async function apiPatch(pathOrUrl, body, options = {}) {
    return apiRequest(pathOrUrl, { ...options, method: 'PATCH', body });
}

export async function apiPut(pathOrUrl, body, options = {}) {
    return apiRequest(pathOrUrl, { ...options, method: 'PUT', body });
}

export async function apiDelete(pathOrUrl, options = {}) {
    return apiRequest(pathOrUrl, { ...options, method: 'DELETE' });
}

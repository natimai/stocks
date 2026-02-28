'use client';
import React, { useState, useEffect } from 'react';
import { auth, googleProvider } from '../../lib/firebase';
import { signInWithPopup, onAuthStateChanged } from 'firebase/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Users, Crown, Shield, ArrowLeft, RefreshCw, LogOut, CheckCircle2, XCircle, Clock, Zap } from 'lucide-react';

const API = 'https://quantai-backend-316459358121.europe-west1.run.app';
const ADMIN_EMAIL = 'netanel18999@gmail.com';

export default function AdminPage() {
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [updating, setUpdating] = useState(null); // uid being updated
    const [error, setError] = useState('');

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthLoading(false);
        });
        return unsub;
    }, []);

    useEffect(() => {
        if (user?.email === ADMIN_EMAIL) {
            fetchUsers();
        }
    }, [user]);

    const fetchUsers = async () => {
        setLoading(true);
        setError('');
        try {
            const token = await user.getIdToken(true);
            const res = await fetch(`${API}/api/admin/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch users');
            const data = await res.json();
            setUsers(data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const togglePro = async (uid, currentIsPro) => {
        setUpdating(uid);
        try {
            const token = await user.getIdToken(true);
            const res = await fetch(`${API}/api/admin/users/${uid}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ isPro: !currentIsPro })
            });
            if (!res.ok) throw new Error('Update failed');
            setUsers(prev => prev.map(u => u.uid === uid ? { ...u, isPro: !currentIsPro } : u));
        } catch (e) {
            setError(e.message);
        } finally {
            setUpdating(null);
        }
    };

    const proCount = users.filter(u => u.isPro).length;
    const freeCount = users.length - proCount;

    if (authLoading) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6">
                <Shield className="w-10 h-10 text-[#00C805]" />
                <h1 className="text-2xl font-bold text-white">Admin Access</h1>
                <p className="text-white/40 text-sm">Sign in with your admin Google account</p>
                <button
                    onClick={() => signInWithPopup(auth, googleProvider)}
                    className="flex items-center gap-2 px-6 py-3 bg-[#00C805] hover:bg-[#00e005] text-black font-bold rounded-xl transition-all"
                >
                    Sign in with Google
                </button>
            </div>
        );
    }

    if (user.email !== ADMIN_EMAIL) {
        return (
            <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
                <XCircle className="w-12 h-12 text-red-500" />
                <h1 className="text-xl font-bold text-white">Access Denied</h1>
                <p className="text-white/40 text-sm">{user.email} does not have admin privileges.</p>
                <button
                    onClick={() => auth.signOut()}
                    className="text-sm text-white/40 hover:text-white underline"
                >
                    Sign out
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white" style={{ fontFamily: 'Inter, sans-serif' }}>
            {/* Header */}
            <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between sticky top-0 bg-black/90 backdrop-blur-xl z-50">
                <div className="flex items-center gap-3">
                    <a href="/" className="text-white/40 hover:text-white transition-colors">
                        <ArrowLeft className="w-5 h-5" />
                    </a>
                    <Activity className="w-5 h-5 text-[#00C805]" />
                    <span className="font-bold tracking-tight">QuantAI Admin</span>
                    <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Staff Only</span>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={fetchUsers}
                        disabled={loading}
                        className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                    <button
                        onClick={() => auth.signOut()}
                        className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign out
                    </button>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-6 py-10">
                <h1 className="text-3xl font-bold tracking-tight mb-2">User Management</h1>
                <p className="text-white/40 text-sm mb-8">Manage all registered users, toggle Pro access, and monitor usage.</p>

                {/* Stats Row */}
                <div className="grid grid-cols-3 gap-4 mb-10">
                    {[
                        { label: 'Total Users', value: users.length, icon: <Users className="w-4 h-4" />, color: 'text-white' },
                        { label: 'Pro Users', value: proCount, icon: <Crown className="w-4 h-4" />, color: 'text-yellow-400' },
                        { label: 'Free Users', value: freeCount, icon: <Zap className="w-4 h-4" />, color: 'text-[#00C805]' },
                    ].map((stat) => (
                        <div key={stat.label} className="bg-[#111114] border border-white/5 rounded-2xl p-5">
                            <div className={`flex items-center gap-2 mb-2 ${stat.color}`}>
                                {stat.icon}
                                <span className="text-xs font-bold uppercase tracking-widest text-white/40">{stat.label}</span>
                            </div>
                            <p className={`text-4xl font-bold ${stat.color}`}>{loading ? '—' : stat.value}</p>
                        </div>
                    ))}
                </div>

                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-6 text-sm text-red-400">
                        {error}
                    </div>
                )}

                {/* Users Table */}
                <div className="bg-[#111114] border border-white/5 rounded-2xl overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-6 py-3 border-b border-white/5 text-xs font-bold uppercase tracking-widest text-white/30">
                        <span>User</span>
                        <span className="text-center">Analyses</span>
                        <span className="text-center">Joined</span>
                        <span className="text-center">Status</span>
                    </div>

                    <AnimatePresence>
                        {loading ? (
                            <div className="flex items-center justify-center py-16">
                                <div className="w-6 h-6 border-2 border-white/10 border-t-[#00C805] rounded-full animate-spin" />
                            </div>
                        ) : users.length === 0 ? (
                            <div className="text-center py-16 text-white/30 text-sm">No users registered yet.</div>
                        ) : (
                            users.map((u, i) => (
                                <motion.div
                                    key={u.uid}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.03 }}
                                    className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-6 py-4 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                                >
                                    {/* User info */}
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="w-9 h-9 rounded-full bg-[#1E1E24] flex items-center justify-center text-sm font-bold text-white/60 flex-shrink-0">
                                            {(u.name || u.email || '?')[0].toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-medium text-sm text-white truncate">{u.name || 'Unknown'}</p>
                                            <p className="text-xs text-white/40 truncate">{u.email || u.uid}</p>
                                        </div>
                                    </div>

                                    {/* Analysis count */}
                                    <div className="text-center">
                                        <span className="text-sm font-bold text-white/70">{u.analysisCount ?? 0}</span>
                                        <p className="text-[10px] text-white/30">scans</p>
                                    </div>

                                    {/* Join date */}
                                    <div className="text-center">
                                        <span className="text-xs text-white/40 flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                                        </span>
                                    </div>

                                    {/* Pro toggle */}
                                    <div className="flex justify-center">
                                        <button
                                            onClick={() => togglePro(u.uid, u.isPro)}
                                            disabled={updating === u.uid}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${u.isPro
                                                    ? 'bg-yellow-400/20 text-yellow-400 hover:bg-red-500/20 hover:text-red-400'
                                                    : 'bg-white/5 text-white/40 hover:bg-yellow-400/20 hover:text-yellow-400'
                                                } ${updating === u.uid ? 'opacity-50 cursor-wait' : ''}`}
                                        >
                                            {updating === u.uid ? (
                                                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                                            ) : u.isPro ? (
                                                <Crown className="w-3 h-3" />
                                            ) : (
                                                <Zap className="w-3 h-3" />
                                            )}
                                            {u.isPro ? 'Pro' : 'Free'}
                                        </button>
                                    </div>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                </div>

                <p className="text-xs text-white/20 text-center mt-6">
                    Click a user's badge to toggle their plan. Changes take effect immediately.
                </p>
            </main>
        </div>
    );
}

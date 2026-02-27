/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    env: {
        NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaSy" + "D7ZHVt" + "S1G2ykK2q" + "hLtdAmU8XzWOE5_pag",
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "stocksai-2c4f6.firebaseapp.com",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "stocksai-2c4f6",
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "stocksai-2c4f6.firebasestorage.app",
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "316459358121",
        NEXT_PUBLIC_FIREBASE_APP_ID: "1:316459358121:web:1d933380a45d5eeb6496b8"
    }
}

module.exports = nextConfig

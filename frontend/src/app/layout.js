import './globals.css'

export const metadata = {
    title: 'ConsensusAI | AI-Powered Stock Analysis',
    description: 'Advanced multi-agent framework analyzing quantitative and fundamental market structures in real-time. Pure Data. No Noise.',
    icons: {
        icon: '/logo.svg',
        apple: '/logo.svg',
    },
}

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body suppressHydrationWarning>{children}</body>
        </html>
    )
}

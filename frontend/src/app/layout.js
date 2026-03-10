import './globals.css'
import MonitoringBootstrap from '../components/MonitoringBootstrap'

export const metadata = {
    title: 'ConsensusAI | AI-Powered Stock Analysis',
    description: 'Advanced multi-agent framework analyzing quantitative and fundamental market structures in real-time. Pure Data. No Noise.',
    icons: {
        icon: '/logo.svg',
        apple: '/logo.svg',
    },
}

export const viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
}

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body suppressHydrationWarning>
                <MonitoringBootstrap />
                {children}
            </body>
        </html>
    )
}

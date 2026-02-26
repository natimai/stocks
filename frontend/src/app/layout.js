import './globals.css'

export const metadata = {
    title: 'AI Stock Analysis Dashboard',
    description: 'Real-time algorithmic scoring & analysis for standard US stocks.',
}

export default function RootLayout({ children }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body suppressHydrationWarning>{children}</body>
        </html>
    )
}

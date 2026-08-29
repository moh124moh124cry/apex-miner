import './globals.css'

export const metadata = {
  title: 'ApexMiner Mini App',
  description: 'Mine APEX directly inside Telegram',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white select-none">
        {children}
      </body>
    </html>
  )
}

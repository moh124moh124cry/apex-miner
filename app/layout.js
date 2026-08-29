import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'ApexMiner',
  description: 'Mine APEX directly inside Telegram',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white select-none">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}

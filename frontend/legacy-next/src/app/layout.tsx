import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Sero Guld CRM',
  description: 'Sero Guld CRM envanter ve müşteri yönetim sistemi',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}

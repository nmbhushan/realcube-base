import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Enterprise Platform',
  description: 'Central identity and access control administration',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

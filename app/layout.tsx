import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZELDO — A little world. A grand adventure.',
  description: 'An original, pocket-sized 3D adventure. Wander the valley, brave the Lantern Vault, and bring the last ember home.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

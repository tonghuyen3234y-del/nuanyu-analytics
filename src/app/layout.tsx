import type { Metadata } from 'next';
import './globals.css';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: '暖屿 · Case 集后台',
  description: '埋点数据 · 质量分析 · Bad Case 复盘',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0 }}>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <Nav />
          <main style={{ flex: 1, minWidth: 0 }}>
            <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 28px 60px' }}>
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: '概览', icon: '◔' },
  { href: '/behavior', label: '用户行为分析', icon: '◈' },
  { href: '/runs', label: '运行列表', icon: '☰' },
  { href: '/sessions', label: '会话', icon: '◌' },
  { href: '/cases', label: 'Case 集', icon: '⚑' },
  { href: '/health', label: '埋点自检', icon: '✓' },
];

export const SIDEBAR_WIDTH = 200;

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        borderRight: '1px solid var(--line)',
        background: '#fff',
        height: '100vh',
        position: 'sticky',
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 0',
      }}
    >
      {/* 品牌 */}
      <div style={{ padding: '0 20px 22px' }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: 1,
            color: 'var(--clay)',
            lineHeight: 1.3,
          }}
        >
          暖屿
        </div>
        <div style={{ fontSize: 12, color: 'var(--quiet)', marginTop: 2 }}>Case 集后台</div>
      </div>

      {/* 菜单 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 10px' }}>
        {LINKS.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 13.5,
                color: active ? 'var(--clay)' : 'var(--quiet)',
                background: active ? '#f6f1ea' : 'transparent',
                fontWeight: active ? 600 : 400,
                textDecoration: 'none',
                transition: 'background .15s, color .15s',
              }}
            >
              <span
                style={{
                  width: 14,
                  textAlign: 'center',
                  fontSize: 13,
                  opacity: active ? 1 : 0.65,
                }}
              >
                {l.icon}
              </span>
              {l.label}
            </Link>
          );
        })}
      </div>

      {/* 底部说明 */}
      <div
        style={{
          marginTop: 'auto',
          padding: '0 20px',
          fontSize: 11,
          color: '#bdb7ab',
          lineHeight: 1.6,
        }}
      >
        埋点口径见
        <br />
        需求文档 05.1
      </div>
    </nav>
  );
}

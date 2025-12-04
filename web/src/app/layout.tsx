import './globals.css'
import type { Metadata } from 'next'
import dynamic from 'next/dynamic'

export const metadata: Metadata = {
  title: '디하클 카카오봇',
  description: '디하클 카카오봇 대시보드 (FastAPI SSE)',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const StatusBar = dynamic(() => import('../components/StatusBar'), { ssr: false });
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
      </head>
      <body>
        <header className="global-header">
          <div className="header-inner">
            <div className="header-top">
              <a href="/" className="brand-link">디하클 카카오봇</a>
              <div><StatusBar /></div>
            </div>

            <nav className="nav-bar">
              <a href="/" className="nav-link">대시보드</a>
              <a href="/templates" className="nav-link">템플릿</a>
              <a href="/settings" className="nav-link">기능별 관리</a>
              <a href="/announcement" className="nav-link">공지 관리</a>
              <a href="/kb" className="nav-link">카페 지식베이스</a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  )
}

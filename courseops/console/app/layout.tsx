import "./globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CourseOps v2",
  description: "강의 운영 v2 웹 콘솔",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}


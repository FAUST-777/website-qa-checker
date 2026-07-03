import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '網站自動 QA 檢查器',
  description: '貼上網址，自動檢查死按鈕、失效連結、LINE 加好友連結、破圖等常見問題',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}

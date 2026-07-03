'use client';

import { useState, useRef } from 'react';

interface Finding {
  severity: 'error' | 'warning';
  category: string;
  message: string;
  detail?: string;
  pageUrl: string;
}

interface Report {
  url: string;
  scannedAt: string;
  durationMs: number;
  pagesScanned: string[];
  findings: Finding[];
  screenshots: { label: string; data: string }[];
  stats: { linksChecked: number; buttonsTested: number; errors: number; warnings: number };
  partial: boolean;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [depth, setDepth] = useState<'single' | 'site'>('single');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const progressRef = useRef<HTMLDivElement>(null);

  async function startScan() {
    if (!url.trim() || running) return;
    setRunning(true);
    setProgress([]);
    setReport(null);
    setError('');
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), depth }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || `伺服器錯誤（HTTP ${res.status}）`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: any;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'progress') {
            setProgress((p) => [...p.slice(-30), ev.message]);
            progressRef.current?.scrollTo(0, 99999);
          } else if (ev.type === 'done') {
            setReport(ev.report);
          } else if (ev.type === 'error') {
            setError(ev.message);
          }
        }
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRunning(false);
    }
  }

  function downloadReport() {
    if (!report) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const errs = report.findings.filter((f) => f.severity === 'error');
    const warns = report.findings.filter((f) => f.severity === 'warning');
    const renderF = (f: Finding, color: string, bg: string) => `
      <div style="background:#fff;border-left:5px solid ${color};border-radius:8px;padding:12px 16px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
        <span style="display:inline-block;font-size:12px;font-weight:700;background:${bg};color:${color};border-radius:999px;padding:1px 10px">${esc(f.category)}</span>
        <div style="font-weight:600;margin-top:4px">${esc(f.message)}</div>
        ${f.detail ? `<div style="margin-top:5px;font-size:13px;color:#6b7280;white-space:pre-wrap;word-break:break-all">${esc(f.detail)}</div>` : ''}
        <div style="margin-top:4px;font-size:12px;color:#9ca3af;word-break:break-all">頁面：${esc(f.pageUrl)}</div>
      </div>`;
    const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>QA 報告 - ${esc(report.url)}</title></head>
<body style="font-family:'Microsoft JhengHei',sans-serif;background:#f4f6f8;margin:0;padding:24px;color:#1f2937">
<div style="max-width:820px;margin:0 auto">
<h1 style="font-size:22px">網站 QA 檢查報告</h1>
<p style="color:#6b7280">檢查對象：<a href="${esc(report.url)}">${esc(report.url)}</a><br>
檢查時間：${new Date(report.scannedAt).toLocaleString('zh-TW')}｜共檢查 ${report.pagesScanned.length} 頁、${report.stats.linksChecked} 個連結、${report.stats.buttonsTested} 個按鈕</p>
<h2 style="font-size:17px;color:#dc2626">🔴 必修錯誤（${errs.length}）</h2>
${errs.length ? errs.map((f) => renderF(f, '#dc2626', '#fee2e2')).join('') : '<p style="color:#16a34a;font-weight:600">沒有發現必修錯誤 🎉</p>'}
<h2 style="font-size:17px;color:#d97706">🟡 建議修正（${warns.length}）</h2>
${warns.length ? warns.map((f) => renderF(f, '#d97706', '#fef3c7')).join('') : '<p style="color:#16a34a;font-weight:600">沒有建議修正項目</p>'}
<h2 style="font-size:17px">📸 頁面截圖</h2>
<div style="display:flex;gap:12px;flex-wrap:wrap">
${report.screenshots.map((s) => `<div style="flex:1;min-width:250px"><div style="font-size:13px;color:#6b7280;font-weight:600;margin-bottom:4px">${esc(s.label)}</div><img style="width:100%;border:1px solid #e5e7eb;border-radius:6px" src="data:image/jpeg;base64,${s.data}"></div>`).join('')}
</div>
<p style="margin-top:32px;color:#9ca3af;font-size:13px">此報告由網站自動 QA 檢查器產生</p>
</div></body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `QA報告_${new URL(report.url).hostname}_${report.scannedAt.slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const errs = report?.findings.filter((f) => f.severity === 'error') || [];
  const warns = report?.findings.filter((f) => f.severity === 'warning') || [];

  return (
    <div className="container">
      <div className="hero">
        <h1>🔍 網站自動 QA 檢查器</h1>
        <p>貼上網址，自動檢查：死按鈕、失效連結、LINE 加好友連結、破圖、手機版跑版</p>
      </div>

      <div className="scan-form">
        <div className="url-row">
          <input
            className="url-input"
            type="text"
            placeholder="貼上要檢查的網址，例如 https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startScan()}
            disabled={running}
          />
          <button className="scan-btn" onClick={startScan} disabled={running || !url.trim()}>
            {running ? '檢查中…' : '開始檢查'}
          </button>
        </div>
        <div className="depth-row">
          <label>
            <input type="radio" name="depth" checked={depth === 'single'} onChange={() => setDepth('single')} disabled={running} />
            只檢查這一頁（快，約 1 分鐘）
          </label>
          <label>
            <input type="radio" name="depth" checked={depth === 'site'} onChange={() => setDepth('site')} disabled={running} />
            連同站內子頁面（最多 7 頁，約 2~4 分鐘）
          </label>
        </div>
      </div>

      {(running || progress.length > 0) && !report && !error && (
        <div className="progress-box" ref={progressRef}>
          {progress.map((p, i) => (
            <div className="line" key={i}>
              {i === progress.length - 1 && running ? <span className="spinner" /> : '✓ '}
              {p}
            </div>
          ))}
        </div>
      )}

      {error && <div className="err-banner">❌ 檢查失敗：{error}</div>}

      {report && (
        <div className="report">
          <div className="summary">
            <div className="stat"><div className={`num ${errs.length ? 'red' : 'green'}`}>{errs.length}</div><div className="lbl">必修錯誤</div></div>
            <div className="stat"><div className={`num ${warns.length ? 'yellow' : 'green'}`}>{warns.length}</div><div className="lbl">建議修正</div></div>
            <div className="stat"><div className="num">{report.pagesScanned.length}</div><div className="lbl">檢查頁數</div></div>
            <div className="stat"><div className="num">{report.stats.linksChecked}</div><div className="lbl">連結</div></div>
            <div className="stat"><div className="num">{report.stats.buttonsTested}</div><div className="lbl">按鈕</div></div>
            <div className="actions">
              <button className="dl-btn" onClick={downloadReport}>⬇ 下載報告（傳給美編）</button>
            </div>
          </div>

          {errs.length === 0 && warns.length === 0 && (
            <div className="pass-box">🎉 恭喜！沒有發現任何問題，網站基本功能正常。</div>
          )}

          {errs.length > 0 && (
            <div className="finding-group">
              <h2>🔴 必修錯誤（{errs.length}）— 一定要請美編修正</h2>
              {errs.map((f, i) => (
                <div className="finding" key={i}>
                  <span className="cat">{f.category}</span>
                  <div className="msg">{f.message}</div>
                  {f.detail && <div className="detail">{f.detail}</div>}
                  <div className="page">頁面：{f.pageUrl}</div>
                </div>
              ))}
            </div>
          )}

          {warns.length > 0 && (
            <div className="finding-group">
              <h2>🟡 建議修正（{warns.length}）— 不影響主要功能但建議處理</h2>
              {warns.map((f, i) => (
                <div className="finding warning" key={i}>
                  <span className="cat">{f.category}</span>
                  <div className="msg">{f.message}</div>
                  {f.detail && <div className="detail">{f.detail}</div>}
                  <div className="page">頁面：{f.pageUrl}</div>
                </div>
              ))}
            </div>
          )}

          {report.screenshots.length > 0 && (
            <div className="shots">
              {report.screenshots.map((s, i) => (
                <div className="shot" key={i}>
                  <div className="lbl">{s.label}</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/jpeg;base64,${s.data}`} alt={s.label} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="footer">網站自動 QA 檢查器｜檢查耗時視網站大小約 1~4 分鐘</div>
    </div>
  );
}

import { runScan } from '@/lib/scanner';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { url?: string; depth?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: '請提供要檢查的網址' }, { status: 400 });
  }
  const url = (body.url || '').trim();
  if (!url) return Response.json({ error: '請提供要檢查的網址' }, { status: 400 });
  const depth = body.depth === 'site' ? 'site' : 'single';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };
      try {
        const report = await runScan(url, depth, emit);
        emit({ type: 'done', report });
      } catch (e: any) {
        emit({ type: 'error', message: e?.message || String(e) });
      }
      try { controller.close(); } catch {}
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

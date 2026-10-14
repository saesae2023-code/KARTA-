/**
 * AMap security proxy (/_AMapService) for Vercel Edge.
 * Implements the "serviceHost" mode from the AMap JS API 2.0 security documentation: the browser never sees the
 * 安全密钥; it is appended here from the AMAP_SECURITY_CODE environment variable.
 */
export const config = { runtime: 'edge' };

declare const process: { env: Record<string, string | undefined> };

export default async function handler(req: Request): Promise<Response> {
  const code = process.env.AMAP_SECURITY_CODE;
  if (!code) return new Response('AMAP_SECURITY_CODE is not configured', { status: 500 });
  const url = new URL(req.url);
  const path = '/' + (url.searchParams.get('path') ?? '').replace(/^\/+/, '');
  url.searchParams.delete('path');
  const upstream = path.startsWith('/v4/map/styles')
    ? 'https://webapi.amap.com'
    : path.startsWith('/v3/vectormap')
      ? 'https://fmap01.amap.com'
      : 'https://restapi.amap.com';
  const target = new URL(upstream + path);
  url.searchParams.forEach((v, k) => target.searchParams.set(k, v));
  target.searchParams.set('jscode', code);
  const r = await fetch(target.toString(), { method: req.method, headers: { 'user-agent': req.headers.get('user-agent') ?? 'altiora' } });
  return new Response(r.body, {
    status: r.status,
    headers: { 'content-type': r.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

'use strict';
/* MusiCLI 随行播放器 Service Worker
 *
 * 策略：
 *   - 页面导航（/listen）：网络优先，离线回落缓存
 *   - /listen/ 静态资源（图标/manifest）：缓存优先
 *   - API（/search /metadata /playlists /lyrics …）：网络优先 + 缓存兜底（离线可浏览上次数据）
 *   - /stream*（音频流/SSE）：不拦截、不缓存 —— 直连网络，保留 Range 请求的拖动定位能力
 *
 * 更新 WebUI 文件后请递增 CACHE 版本号，强制客户端刷新缓存。
 */
const CACHE = 'mcli-webui-v1';
const SHELL = './'; // 即 /listen/（页面 HTML）

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll([SHELL, './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 音频流 / SSE：直连，不经过 SW（保证 Range 分段请求正常）
  if (url.pathname === '/stream' || url.pathname.startsWith('/stream/')) return;

  if (req.mode === 'navigate') {
    e.respondWith(navigate(req));
    return;
  }
  if (url.pathname === '/listen' || url.pathname.startsWith('/listen/')) {
    e.respondWith(cacheFirst(req));
    return;
  }
  // 其余同源 GET（API）：网络优先，缓存兜底
  e.respondWith(networkFirst(req));
});

async function navigate(req) {
  try {
    const fresh = await fetch(req);
    const c = await caches.open(CACHE);
    c.put(SHELL, fresh.clone()).catch(() => {});
    return fresh;
  } catch (e) { /* 离线 */ }
  const c = await caches.open(CACHE);
  return (await c.match(req, { ignoreSearch: true })) || (await c.match(SHELL)) || Response.error();
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const fresh = await fetch(req);
    c.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (e) {
    return Response.error();
  }
}

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) c.put(req, fresh.clone()).catch(() => {});
    return fresh;
  } catch (e) { /* 离线 */ }
  const hit = await c.match(req);
  if (hit) return hit;
  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

'use strict';
/* MusiCLI Pocket Service Worker（作用域 /pocket/）
 *
 * 策略：
 *   - 页面导航（/pocket）：网络优先，离线回落缓存
 *   - /pocket/ 静态资源（图标/manifest）：缓存优先
 *   - API（/search /metadata /playlists /lyrics …）：网络优先 + 缓存兜底（离线可浏览上次数据）
 *   - /stream*（音频流/SSE）：不拦截、不缓存 —— 直连网络，保留 Range 请求的拖动定位能力
 *
 * 密码保护：未认证请求返回 401，一律不写入缓存（避免密码页被缓存后
 * 在已认证设备上错误命中）。只有 res.ok 的响应才会进缓存。
 *
 * 更新 WebUI 文件后请递增 CACHE 版本号，强制客户端刷新缓存。
 */
const CACHE = 'mcli-pocket-v2';
const SHELL = '/pocket';
const ASSETS = [
  '/pocket',
  '/pocket/manifest.webmanifest',
  '/pocket/icon-180.png',
  '/pocket/icon-192.png',
  '/pocket/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    // 逐个缓存：addAll 在任一请求 401（未认证）时会整体 reject 导致 SW 安装失败，
    // 逐个 put + 容错可以让部分资源（如已带 cookie 的 shell）缓存成功。
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(u => fetch(u).then(r => {
        if (r.ok) return c.put(u, r.clone());
      }).catch(() => {}))))
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
  if (url.pathname === '/pocket' || url.pathname.startsWith('/pocket/')) {
    e.respondWith(cacheFirst(req));
    return;
  }
  // 其余同源 GET（API）：网络优先，缓存兜底
  e.respondWith(networkFirst(req));
});

async function navigate(req) {
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const c = await caches.open(CACHE);
      c.put(SHELL, fresh.clone()).catch(() => {});
    }
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
    if (fresh.ok) c.put(req, fresh.clone()).catch(() => {});
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

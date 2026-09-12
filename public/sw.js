// 最小化 Service Worker,只是為了讓瀏覽器判定「可安裝」(加到主畫面/桌面)。
// 這個網站每次操作都需要即時連到伺服器(上傳、列印、查印表機清單),
// 完全不做離線快取,避免拿到過期的印表機清單或列印紀錄。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

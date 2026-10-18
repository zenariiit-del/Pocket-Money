// 個人の記録・認証情報はキャッシュしません。常に最新の画面を取得します。
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

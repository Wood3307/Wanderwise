import 'dotenv/config';
import { createApp } from './app.js';
import { loadSnapshot, ZhihuService } from './zhihu.js';

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
const service = new ZhihuService({ secret: process.env.ZHIHU_ACCESS_SECRET, snapshot: await loadSnapshot() });
const server = createApp(service).listen(port, '0.0.0.0', () => {
  console.info(`Wanderwise API ready on http://localhost:${port} · Zhihu ${service.configured ? 'configured' : 'credentials missing'}`);
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

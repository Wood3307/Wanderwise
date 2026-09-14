import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createApp } from './galaxy/app.js';
import { loadSnapshot, ZhihuService } from './galaxy/zhihu.js';
import { ContentStore } from './content/store.js';
import { ContentService } from './content/service.js';
import { AccessService, loadAccessConfig } from './content/access.js';
import { SynthesisService } from './content/synthesis.js';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const port = Number(process.env.PORT || 4187);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
const host = process.env.HOST || '127.0.0.1';
function budget(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) throw new Error(`${name} must be an integer from 0 to 100000`);
  return value;
}
const contentDir = resolve(process.env.CONTENT_DATA_DIR || fileURLToPath(new URL('../artifacts/content-service', import.meta.url)));
const store = new ContentStore(resolve(contentDir, 'content.sqlite3'));
const content = new ContentService({ store, globalLimit: budget('CONTENT_DAILY_GLOBAL', 200), visitorLimit: budget('CONTENT_DAILY_VISITOR', 20) });
content.registerCurated(JSON.parse(readFileSync(new URL('../src/features/journeys/curatedSources.json', import.meta.url), 'utf8')));
// The .env prefix also falls under Vite's default fs.deny rules during local development.
const access = new AccessService(loadAccessConfig(resolve(contentDir, '.env.access.local')));
const synthesis = new SynthesisService(content, { global: budget('AI_DAILY_GLOBAL', 50), perVisitor: budget('AI_DAILY_VISITOR', budget('AI_DAILY_CODE', 10)) });
if (process.env.LEGACY_ZHIHU_DB) content.importLegacy(process.env.LEGACY_ZHIHU_DB);
const service = new ZhihuService({ secret: process.env.ZHIHU_ACCESS_SECRET, snapshot: await loadSnapshot(), content });
const app = createApp(service, { distDir: fileURLToPath(new URL('../dist', import.meta.url)), access, synthesis });
const server = app.listen(port, host, () => {
  console.info(`Wanderwise · cabin, observatory and galaxy: http://${host}:${port}/observatory`);
  console.info(`Galaxy content: ${service.configured ? 'Zhihu search configured' : 'public knowledge mode'} (${service.publicCount} source works)`);
  // Public source refresh is requested explicitly; the initial sky uses hot topics.
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
function shutdown() {
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

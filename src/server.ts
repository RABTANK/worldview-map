import { buildApp, listen } from './http/app.js';
import { createRuntime } from './runtime.js';

const runtime = createRuntime();
const app = await buildApp({ runtime });
await listen(app, runtime);
console.log(`世界观地图  http://127.0.0.1:${runtime.config.port}`);
console.log(`OpenAPI     http://127.0.0.1:${runtime.config.port}/docs`);
console.log(`健康检查    http://127.0.0.1:${runtime.config.port}/health`);

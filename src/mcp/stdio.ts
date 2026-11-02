import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppError } from '../domain/errors.js';
import { RateLimiter } from '../domain/rate-limit.js';
import { createRuntime } from '../runtime.js';
import { createMcpServer } from './server.js';

const token = process.env.WORLDVIEW_API_KEY?.trim();
if (!token) {
  console.error('缺少环境变量 WORLDVIEW_API_KEY。明文不要写入仓库，只在启动 MCP 时注入。');
  process.exit(1);
}

const runtime = createRuntime();
const limiter = new RateLimiter(runtime.config.rateLimitPerMin, 60_000);
const server = createMcpServer(
  runtime,
  () => {
    const actor = runtime.keys.authenticate(token);
    if (!actor) throw new AppError(401, 'UNAUTHORIZED', 'MCP API Key 无效或已吊销');
    return actor;
  },
  limiter,
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('worldview-map MCP 已连接（stdio）');

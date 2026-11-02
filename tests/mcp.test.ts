import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/domain/rate-limit.js';
import { createMcpServer, MCP_TOOL_NAMES } from '../src/mcp/server.js';
import { createRuntime } from '../src/runtime.js';
import { square } from './helpers.js';

describe('MCP', () => {
  it('performs a real tool call on the shared services and refuses unconfirmed deletes', async () => {
    const runtime = createRuntime({ dbPath: ':memory:' });
    const admin = runtime.keys.create({ name: 'admin', scopes: ['read', 'write', 'delete', 'admin'] });
    const actor = () => {
      const found = runtime.keys.authenticate(admin.token);
      if (!found) throw new Error('missing actor');
      return found;
    };
    const server = createMcpServer(runtime, actor, new RateLimiter(100, 60_000));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'vitest', version: '3.0.0' });
    await client.connect(clientTransport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());

    const created = await client.callTool({
      name: 'map_create_region',
      arguments: { id: 'continent_mcp', level: 'continent', name: '翠幕群岛', geometry: square(0, 0, 200) },
    });
    expect(created.isError).toBeFalsy();
    const text = JSON.stringify(created.content);
    expect(text).toContain('翠幕群岛');

    const denied = await client.callTool({
      name: 'map_delete_region',
      arguments: { id: 'continent_mcp', confirm: false, cascade: false },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('CONFIRMATION_REQUIRED');
    expect(runtime.world.getRegion('continent_mcp').name).toBe('翠幕群岛');

    const context = await client.callTool({ name: 'map_get_context', arguments: { regionId: null } });
    expect(JSON.stringify(context.content)).toContain('翠幕群岛');

    await client.close();
    runtime.sqlite.close();
  });
});

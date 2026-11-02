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
    expect(JSON.stringify(created.content)).toContain('翠幕群岛');

    const read = await client.callTool({ name: 'map_get_region', arguments: { id: 'continent_mcp' } });
    expect(JSON.stringify(read.content)).toContain('翠幕群岛');

    const updated = await client.callTool({
      name: 'map_update_region',
      arguments: { id: 'continent_mcp', name: '翠幕群岛·改' },
    });
    expect(updated.isError).toBeFalsy();
    expect(runtime.world.getRegion('continent_mcp').name).toBe('翠幕群岛·改');

    const place = await client.callTool({
      name: 'map_upsert_location',
      arguments: { id: 'place_mcp', regionId: 'continent_mcp', name: '珍珠码头', x: 20, y: 30 },
    });
    expect(place.isError).toBeFalsy();
    const renamed = await client.callTool({
      name: 'map_update_location',
      arguments: { id: 'place_mcp', description: 'Agent 改过的码头' },
    });
    expect(renamed.isError).toBeFalsy();
    const fetched = await client.callTool({ name: 'map_get_location', arguments: { id: 'place_mcp' } });
    expect(JSON.stringify(fetched.content)).toContain('Agent 改过的码头');

    const unconfirmed = await client.callTool({
      name: 'map_delete_location',
      arguments: { id: 'place_mcp', confirm: false },
    });
    expect(unconfirmed.isError).toBe(true);
    expect(runtime.world.getPlace('place_mcp').name).toBe('珍珠码头');

    const removedPlace = await client.callTool({
      name: 'map_delete_location',
      arguments: { id: 'place_mcp', confirm: true },
    });
    expect(removedPlace.isError).toBeFalsy();
    const missing = await client.callTool({ name: 'map_get_location', arguments: { id: 'place_mcp' } });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain('NOT_FOUND');

    const denied = await client.callTool({
      name: 'map_delete_region',
      arguments: { id: 'continent_mcp', confirm: false, cascade: false },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('CONFIRMATION_REQUIRED');

    const removed = await client.callTool({
      name: 'map_delete_region',
      arguments: { id: 'continent_mcp', confirm: true, cascade: false },
    });
    expect(removed.isError).toBeFalsy();
    const gone = await client.callTool({ name: 'map_get_region', arguments: { id: 'continent_mcp' } });
    expect(gone.isError).toBe(true);

    await client.close();
    runtime.sqlite.close();
  });

  it('lets a read-write-delete key CRUD while a read-only key cannot write or delete', async () => {
    const runtime = createRuntime({ dbPath: ':memory:' });
    const editor = runtime.keys.create({ name: 'editor', scopes: ['read', 'write', 'delete'] });
    const viewer = runtime.keys.create({ name: 'viewer', scopes: ['read'] });
    const use = (token: string) => {
      const server = createMcpServer(
        runtime,
        () => {
          const found = runtime.keys.authenticate(token);
          if (!found) throw new Error('missing actor');
          return found;
        },
        new RateLimiter(100, 60_000),
      );
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      return { server, clientTransport, serverTransport };
    };

    const editorSide = use(editor.token);
    await editorSide.server.connect(editorSide.serverTransport);
    const editorClient = new Client({ name: 'editor', version: '3.0.0' });
    await editorClient.connect(editorSide.clientTransport);
    expect((await editorClient.callTool({
      name: 'map_create_region',
      arguments: { id: 'c', level: 'continent', name: '霜歌', geometry: square() },
    })).isError).toBeFalsy();
    expect((await editorClient.listTools()).tools.some((tool) => tool.name === 'map_delete_region')).toBe(true);

    const viewerSide = use(viewer.token);
    await viewerSide.server.connect(viewerSide.serverTransport);
    const viewerClient = new Client({ name: 'viewer', version: '3.0.0' });
    await viewerClient.connect(viewerSide.clientTransport);
    const listed = await viewerClient.callTool({ name: 'map_get_region', arguments: { id: 'c' } });
    expect(JSON.stringify(listed.content)).toContain('霜歌');
    const forbidden = await viewerClient.callTool({
      name: 'map_update_region',
      arguments: { id: 'c', name: '不能改' },
    });
    expect(forbidden.isError).toBe(true);
    expect(JSON.stringify(forbidden.content)).toContain('FORBIDDEN');
    expect(runtime.world.getRegion('c').name).toBe('霜歌');

    await editorClient.close();
    await viewerClient.close();
    runtime.sqlite.close();
  });
});

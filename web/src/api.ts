import type { Floor, MapView, Place, Region, Scope } from '../../src/shared/types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

export class Api {
  constructor(private getKey: () => string) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const key = this.getKey();
    if (key) headers.authorization = `Bearer ${key}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new ApiError(data?.error?.message ?? response.statusText, data?.error?.code ?? 'HTTP', response.status);
    }
    return data as T;
  }

  me(): Promise<{ id: string; name: string; scopes: Scope[] }> {
    return this.request('GET', '/api/me');
  }

  view(regionId: string | null, floorId: string | null): Promise<MapView> {
    const params = new URLSearchParams();
    if (regionId) params.set('regionId', regionId);
    if (floorId) params.set('floorId', floorId);
    const query = params.toString();
    return this.request('GET', `/api/map/view${query ? `?${query}` : ''}`);
  }

  patchRegion(id: string, body: Partial<Pick<Region, 'name' | 'description' | 'tags' | 'geometry'>>): Promise<Region> {
    return this.request('PATCH', `/api/regions/${id}`, body);
  }

  patchPlace(id: string, body: Partial<Pick<Place, 'name' | 'description' | 'tags' | 'kind' | 'x' | 'y'>>): Promise<Place> {
    return this.request('PATCH', `/api/places/${id}`, body);
  }

  createFloor(buildingId: string, body: { name: string; floorIndex: number; width: number; height: number }): Promise<Floor> {
    return this.request('POST', `/api/buildings/${buildingId}/floors`, body);
  }

  setTiles(floorId: string, tiles: { x: number; y: number; tileType: string }[]): Promise<Floor & { tiles: unknown[] }> {
    return this.request('PUT', `/api/floors/${floorId}/tiles`, { tiles });
  }
}

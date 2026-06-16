/**
 * Shared HTTP helpers for API integration tests.
 *
 * Server lifecycle is managed by globalSetup.ts — these helpers
 * only provide request functions. Do NOT start/stop the server here.
 */

// Bypass HTTP proxy for localhost connections
process.env.no_proxy = '127.0.0.1,localhost';
process.env.NO_PROXY = '127.0.0.1,localhost';

export const BASE = 'http://127.0.0.1:3100';

export async function getJSON(
  path: string, headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, { headers });
  const body = await res.json();
  return { status: res.status, body };
}

export async function postJSON(
  path: string, data: Record<string, unknown>, headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function putJSON(
  path: string, data: Record<string, unknown>, headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export async function delJSON(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

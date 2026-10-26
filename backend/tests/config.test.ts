import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('RUNTIME_MODE', 'local');
  vi.stubEnv('HOST', '127.0.0.1');
  vi.stubEnv('DATABASE_URL', 'postgresql://bnect:test@127.0.0.1:55432/bnect_demo');
});

afterEach(() => vi.unstubAllEnvs());

describe('local and Docker network configuration', () => {
  it('accepts loopback in local mode', async () => {
    const { config } = await import('../src/config.js');
    expect(config.runtimeMode).toBe('local');
  });

  it('rejects a public listener outside Docker mode', async () => {
    vi.stubEnv('HOST', '0.0.0.0');
    await expect(import('../src/config.js')).rejects.toThrow('loopback');
  });

  it('rejects the Docker database hostname outside Docker mode', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://bnect:test@db:5432/bnect_demo');
    await expect(import('../src/config.js')).rejects.toThrow('PostgreSQL');
  });

  it('accepts the container listener and Compose database in Docker mode', async () => {
    vi.stubEnv('RUNTIME_MODE', 'docker');
    vi.stubEnv('HOST', '0.0.0.0');
    vi.stubEnv('DATABASE_URL', 'postgresql://bnect:test@db:5432/bnect_demo');
    const { config } = await import('../src/config.js');
    expect(config.host).toBe('0.0.0.0');
    expect(new URL(config.databaseUrl).hostname).toBe('db');
  });

  it('still rejects an external database in Docker mode', async () => {
    vi.stubEnv('RUNTIME_MODE', 'docker');
    vi.stubEnv('DATABASE_URL', 'postgresql://bnect:test@example.com:5432/bnect_demo');
    await expect(import('../src/config.js')).rejects.toThrow('PostgreSQL');
  });

  it('rejects an unknown runtime mode', async () => {
    vi.stubEnv('RUNTIME_MODE', 'other');
    await expect(import('../src/config.js')).rejects.toThrow('RUNTIME_MODE');
  });
});

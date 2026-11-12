import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ModelInfo } from '@bnect/shared';
import { config } from '../config.js';
import { embeddingProvider } from '../embedding.js';

async function modelFiles(directory: string, prefix = ''): Promise<ModelInfo['files']> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const name = path.posix.join(prefix, entry.name);
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return modelFiles(fullPath, name);
      if (!entry.isFile()) return [];
      return [{ name, bytes: (await stat(fullPath)).size }];
    }),
  );
  return groups.flat().sort((a, b) => a.name.localeCompare(b.name));
}

export async function getModelInfo(): Promise<ModelInfo> {
  const modelDirectory = path.join(config.cacheDir, config.modelId, config.modelRevision);
  const files = await modelFiles(modelDirectory);
  const cpus = os.cpus();
  return {
    id: config.modelId,
    revision: config.modelRevision,
    embeddingVersion: config.embeddingVersion,
    dimensions: config.dimensions,
    state: embeddingProvider.getStatus().state,
    runtime: config.runtimeMode as ModelInfo['runtime'],
    device: 'cpu',
    dtype: 'q8',
    batchSize: config.batchSize,
    cacheDirectory: config.cacheDir,
    modelDirectory,
    files,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    remoteDownloads: false,
    environment: {
      platform: os.platform(),
      architecture: os.arch(),
      cpu: cpus[0]?.model ?? 'Не определён',
      logicalCores: cpus.length,
      memoryBytes: os.totalmem(),
      node: process.version,
    },
  };
}

import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { watchTenderFile } from './tender-file.js';

const app = buildApp();
const stopTenderFile = watchTenderFile((message) => app.log.info(message));
const shutdown = async () => {
  stopTenderFile();
  await app.close();
  await pool.end();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exitCode = 1;
}

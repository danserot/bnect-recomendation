import { ModelBenchmarkService } from './model/benchmark.js';

// CLI and application page share the same dataset, metrics and report format.
const benchmark = new ModelBenchmarkService();
try {
  await benchmark.start();
  const status = await benchmark.wait();
  if (status.state === 'error') throw new Error(status.error);
  console.log(JSON.stringify(status.report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Ошибка бенчмарка.');
  process.exitCode = 1;
}

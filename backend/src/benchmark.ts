import { performance } from 'node:perf_hooks';
import { embeddingProvider } from './embedding.js';

// Small, public, hand-labelled smoke set. It is not a production accuracy estimate.
const cases = [
  {
    query: 'Монтаж электропроводки в офисе',
    match: 'Установка электрических сетей в офисном здании',
  },
  { query: 'Ремонт кровли здания', match: 'Капитальный ремонт крыши административного корпуса' },
  {
    query: 'Разработка корпоративного веб портала',
    match: 'Создание внутреннего портала для сотрудников',
  },
  {
    query: 'Перевозка грузов автомобильным транспортом',
    match: 'Услуги автомобильной доставки товаров',
  },
  { query: 'Поставка медицинских перчаток', match: 'Закупка одноразовых перчаток для больницы' },
] as const;
const distractors = [
  'Поставка офисных кресел',
  'Уборка помещений школы',
  'Закупка молочных продуктов',
  'Печать рекламных буклетов',
  'Обслуживание серверного оборудования',
];
const documents = [...cases.map((item) => item.match), ...distractors];
const milliseconds = (start: number) => Math.round((performance.now() - start) * 100) / 100;
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);

try {
  const started = performance.now();
  const documentVectors = await embeddingProvider.embedDocuments(documents);
  const indexingMs = milliseconds(started);
  const queryTimes: number[] = [];
  const ranks: number[] = [];
  for (let i = 0; i < cases.length; i++) {
    const start = performance.now();
    const vector = await embeddingProvider.embedQuery(cases[i]!.query);
    queryTimes.push(milliseconds(start));
    const ranked = documentVectors
      .map((candidate, index) => ({ index, score: dot(vector, candidate) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    ranks.push(ranked.findIndex((row) => row.index === i) + 1);
  }
  const warmStart = performance.now();
  await embeddingProvider.embedQuery(cases[0]!.query);
  const cachedQueryMs = milliseconds(warmStart);
  console.log(
    JSON.stringify(
      {
        model: embeddingProvider.getStatus(),
        corpus: '10 hand-labelled synthetic titles; one relevant title per query',
        documentCount: documents.length,
        queryCount: cases.length,
        indexingMs,
        indexingMsPerTitle: Math.round((indexingMs / documents.length) * 100) / 100,
        queryTimesMs: queryTimes,
        queryMedianMs: [...queryTimes].sort((a, b) => a - b)[Math.floor(queryTimes.length / 2)],
        cachedQueryMs,
        top1: ranks.filter((rank) => rank === 1).length / ranks.length,
        meanReciprocalRank: ranks.reduce((sum, rank) => sum + 1 / rank, 0) / ranks.length,
        ranks,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

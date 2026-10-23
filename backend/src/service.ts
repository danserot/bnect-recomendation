import { createHash } from 'node:crypto';
import type {
  Recommendation,
  RecommendationRequest,
  RecommendationResponse,
  ResolvedFilters,
  Tender,
  VectorSpaceResponse,
} from '@bnect/shared';
import { config } from './config.js';
import { embeddingProvider, type EmbeddingProvider } from './embedding.js';
import { availability, isEligible, regionalDescription, resolveFilters } from './filters.js';
import { PcaCache, projectPca } from './pca.js';
import { TenderRepository } from './repository.js';
import { supplierText, tenderText } from './text.js';

export class RecommendationService {
  private pca = new PcaCache();
  constructor(
    private repository = new TenderRepository(),
    private embeddings: EmbeddingProvider = embeddingProvider,
  ) {}

  private async compute(
    request: RecommendationRequest | undefined,
    tenderId?: string,
    repository = this.repository,
  ) {
    const filters: ResolvedFilters = request
      ? resolveFilters(request.profile, request.filters)
      : {
          regionMode: 'all',
          selectedRegionIds: [],
          regionIds: [],
          regionNames: [],
        };
    await repository.assertIndexReady();
    const source = tenderId ? ('tender' as const) : ('profile' as const);
    const selectedTender = tenderId ? await repository.get(tenderId) : undefined;
    const text = selectedTender ? tenderText(selectedTender) : supplierText(request!.profile);
    // Similar-tender queries must use query:, never reuse a saved passage: vector.
    const vector = await this.embeddings.embedQuery(text);
    const matches = await repository.search(
      vector,
      request?.profile,
      filters,
      tenderId,
      Boolean(selectedTender),
      selectedTender?.activity,
    );
    const matchedFields = (tender: Tender) => {
      const groups = selectedTender
        ? [selectedTender.industryGroup]
        : request!.profile.industryGroups;
      const activities = selectedTender ? [selectedTender.activity] : request!.profile.activities;
      const types = selectedTender
        ? [selectedTender.procurementType]
        : request!.profile.procurementTypes;
      return [
        groups.includes(tender.industryGroup) ? `Сфера: ${tender.industryGroup}` : '',
        activities.includes(tender.activity) ? `Деятельность: ${tender.activity}` : '',
        types.includes(tender.procurementType) ? `Вид закупки: ${tender.procurementType}` : '',
      ].filter(Boolean);
    };
    const results: Recommendation[] = matches.rows.map(({ tender, similarity }) => ({
      tender,
      similarity,
      explanation: {
        querySource: source,
        matchedFields: matchedFields(tender),
        regionalFilter: regionalDescription(filters),
        specialization: `${tender.activity}${tender.description ? `. ${tender.description}` : ''}`,
        availability: availability(tender),
        rankingReason:
          'Кандидаты ограничены видом деятельности из источника, если он указан. Порядок определяется косинусным сходством 384-мерных векторов предмета работ. Явно выделенное название объекта исключено из смыслового текста; одинаковые предметы и повторные объекты пропускаются. Это не проверка допуска к участию.',
      },
    }));
    const response: RecommendationResponse = {
      results,
      candidateCount: matches.candidateCount,
      totalCount: matches.totalCount,
      query: {
        source,
        text,
        modelId: config.modelId,
        dimensions: config.dimensions,
        ...(tenderId ? { tenderId } : {}),
      },
      filters,
      demoNow: config.demoNow,
    };
    return { response, vector };
  }

  async recommend(
    request: RecommendationRequest,
    tenderId?: string,
  ): Promise<RecommendationResponse> {
    return this.repository.readSnapshot(
      async (repository) => (await this.compute(request, tenderId, repository)).response,
    );
  }

  /** The basic tender-to-tender flow does not require a supplier profile or database. */
  async recommendSimilar(tenderId: string): Promise<RecommendationResponse> {
    return this.repository.readSnapshot(
      async (repository) => (await this.compute(undefined, tenderId, repository)).response,
    );
  }

  async tenderVectorSpace(tenderId?: string): Promise<VectorSpaceResponse> {
    return this.repository.readSnapshot(async (repository) => {
      await repository.assertIndexReady();
      const rows = await repository.vectors();
      const anchor = tenderId ?? rows[0]!.id;
      const { response, vector } = await this.compute(undefined, anchor, repository);
      const transform = this.pca.get(rows);
      const recommended = new Set(response.results.map((item) => item.tender.id));
      const [x, y] = projectPca(vector, transform);
      return {
        points: rows.map((row) => {
          const [x, y] = projectPca(row.vector, transform);
          return { tender: row.tender, x, y, eligible: true, recommended: recommended.has(row.id) };
        }),
        query: { x, y, source: 'tender' },
        explainedVariance: transform.explainedVarianceRatio,
        recommendations: response,
        fingerprint: createHash('sha256')
          .update(rows.map((row) => `${row.id}:${row.contentHash}:${row.embeddedAt}`).join('|'))
          .digest('hex'),
      };
    });
  }

  async vectorSpace(request: RecommendationRequest): Promise<VectorSpaceResponse> {
    return this.repository.readSnapshot(async (repository) => {
      const { response, vector } = await this.compute(request, undefined, repository);
      const rows = await repository.vectors();
      const transform = this.pca.get(rows);
      const recommended = new Set(response.results.map((result) => result.tender.id));
      const [x, y] = projectPca(vector, transform);
      return {
        points: rows.map((row) => {
          const [px, py] = projectPca(row.vector, transform);
          return {
            tender: row.tender,
            x: px,
            y: py,
            eligible: isEligible(row.tender, request.profile, response.filters),
            recommended: recommended.has(row.id),
          };
        }),
        query: { x, y, source: 'profile' },
        explainedVariance: transform.explainedVarianceRatio,
        recommendations: response,
        fingerprint: createHash('sha256')
          .update(rows.map((row) => `${row.id}:${row.contentHash}:${row.embeddedAt}`).join('|'))
          .digest('hex'),
      };
    });
  }
}

import { createHash } from 'node:crypto';
import type {
  Recommendation,
  RecommendationRequest,
  RecommendationResponse,
  ResolvedFilters,
  SimilarTenderFilters,
  SupplierProfile,
  Tender,
  VectorSpaceResponse,
} from '@bnect/shared';
import { config } from './config.js';
import { embeddingProvider, type EmbeddingProvider } from './embedding.js';
import {
  availability,
  isEligible,
  regionalDescription,
  resolveFilters,
  restrictToTenderRegion,
} from './filters.js';
import { PcaCache, projectPca } from './pca.js';
import { TenderRepository } from './repository.js';
import { supplierText, tenderText } from './text.js';

type MatchingFields = Pick<SupplierProfile, 'industryGroups' | 'activities' | 'procurementTypes'>;
type VectorCorpus = Awaited<ReturnType<TenderRepository['vectors']>>;
type QuerySource = RecommendationResponse['query']['source'];

interface ComputedRecommendation {
  response: RecommendationResponse;
  vector: number[];
}

const rankingExplanation =
  'Порядок определяется косинусным сходством названий закупок. Вид закупки, сфера, деятельность и способ закупки учитываются только выбранными фильтрами. Это не проверка допуска к участию.';

function matchedFields(tender: Tender, reference: MatchingFields): string[] {
  return [
    reference.industryGroups.includes(tender.industryGroup) ? `Сфера: ${tender.industryGroup}` : '',
    reference.activities.includes(tender.activity) ? `Деятельность: ${tender.activity}` : '',
    reference.procurementTypes.includes(tender.procurementType)
      ? `Вид закупки: ${tender.procurementType}`
      : '',
  ].filter(Boolean);
}

export class RecommendationService {
  private readonly pca = new PcaCache();
  constructor(
    private readonly repository = new TenderRepository(),
    private readonly embeddings: EmbeddingProvider = embeddingProvider,
  ) {}

  private async compute(
    request: RecommendationRequest | undefined,
    tenderId?: string,
    repository = this.repository,
    similarFilters?: SimilarTenderFilters,
  ): Promise<ComputedRecommendation> {
    let filters: ResolvedFilters = request
      ? resolveFilters(request.profile, request.filters)
      : {
          regionMode: 'all',
          selectedRegionIds: [],
          regionIds: [],
          regionNames: [],
          ...similarFilters,
        };
    await repository.assertIndexReady();
    const source = tenderId ? ('tender' as const) : ('profile' as const);
    const selectedTender = tenderId ? await repository.get(tenderId) : undefined;
    if (selectedTender) filters = restrictToTenderRegion(selectedTender, filters);
    const text = selectedTender ? tenderText(selectedTender) : supplierText(request!.profile);
    // Similar-tender queries must use query:, never reuse a saved passage: vector.
    const vector = await this.embeddings.embedQuery(text);
    const matches = await repository.search(vector, request?.profile, filters, tenderId);
    const reference: MatchingFields = selectedTender
      ? {
          industryGroups: [selectedTender.industryGroup],
          activities: [selectedTender.activity],
          procurementTypes: [selectedTender.procurementType],
        }
      : request!.profile;
    const regionalFilter = regionalDescription(filters);
    const rankingReason = selectedTender
      ? 'Подбор ограничен регионом выбранного тендера. Выбранные фильтры применяются до поиска. Пять результатов отсортированы по сходству названий; при равенстве — по ID. Это не проверка допуска к участию.'
      : 'Кандидаты ограничены включёнными фильтрами профиля. ' + rankingExplanation;
    const results: Recommendation[] = matches.rows.map(({ tender, similarity }) => ({
      tender,
      similarity,
      explanation: {
        querySource: source,
        matchedFields: matchedFields(tender, reference),
        regionalFilter,
        specialization: `${tender.activity}${tender.description ? `. ${tender.description}` : ''}`,
        availability: availability(tender),
        rankingReason,
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

  /** The basic tender-to-tender flow does not require a supplier profile. */
  async recommendSimilar(
    tenderId: string,
    filters?: SimilarTenderFilters,
  ): Promise<RecommendationResponse> {
    return this.repository.readSnapshot(
      async (repository) => (await this.compute(undefined, tenderId, repository, filters)).response,
    );
  }

  async tenderVectorSpace(tenderId?: string): Promise<VectorSpaceResponse> {
    return this.repository.readSnapshot(async (repository) => {
      await repository.assertIndexReady();
      const rows = await repository.vectors();
      const anchor = tenderId ?? rows[0]!.id;
      const computation = await this.compute(undefined, anchor, repository);
      return this.projectVectorSpace(rows, computation, 'tender', (tender) =>
        computation.response.filters.regionIds.includes(tender.regionId ?? ''),
      );
    });
  }

  async vectorSpace(request: RecommendationRequest): Promise<VectorSpaceResponse> {
    return this.repository.readSnapshot(async (repository) => {
      const computation = await this.compute(request, undefined, repository);
      const rows = await repository.vectors();
      return this.projectVectorSpace(rows, computation, 'profile', (tender) =>
        isEligible(tender, request.profile, computation.response.filters),
      );
    });
  }

  private projectVectorSpace(
    rows: VectorCorpus,
    { response, vector }: ComputedRecommendation,
    source: QuerySource,
    eligible: (tender: Tender) => boolean,
  ): VectorSpaceResponse {
    const transform = this.pca.get(rows);
    const recommended = new Set(response.results.map((result) => result.tender.id));
    const [x, y] = projectPca(vector, transform);
    return {
      points: rows.map((row) => {
        const [pointX, pointY] = projectPca(row.vector, transform);
        return {
          tender: row.tender,
          x: pointX,
          y: pointY,
          eligible: eligible(row.tender),
          recommended: recommended.has(row.id),
        };
      }),
      query: { x, y, source },
      explainedVariance: transform.explainedVarianceRatio,
      recommendations: response,
      fingerprint: createHash('sha256')
        .update(rows.map((row) => `${row.id}:${row.contentHash}:${row.embeddedAt}`).join('|'))
        .digest('hex'),
    };
  }
}

import type { Tender } from '@bnect/shared';
import { config } from '../config.js';
import { AppError } from '../errors.js';

export interface TenderRow {
  id: string;
  external_number: string;
  title: string;
  region_id: string | null;
  created_at: Date | string;
  industry_group: string;
  activity: string;
  procurement_method: string;
  procurement_type: string;
  description: string | null;
  status: Tender['status'] | null;
  application_deadline: Date | string | null;
  source: Tender['source'];
}
export interface IndexedTenderRow extends TenderRow {
  embedding: string | null;
  content_hash: string | null;
  embedded_at: Date | string | null;
}
export interface RankedTenderRow extends TenderRow {
  content_hash: string;
  distance: number | string;
}
export interface VectorRow extends TenderRow {
  vector_text: string;
  content_hash: string;
  embedded_at: Date | string;
}
export interface EmbeddingIndexState {
  model_id: string;
  embedding_version: string;
  dimensions: number;
}
export const asIso = (value: Date | string): string => new Date(value).toISOString();

export function mapTender(row: TenderRow): Tender {
  return {
    id: row.id,
    externalNumber: row.external_number,
    title: row.title,
    regionId: row.region_id,
    createdAt: asIso(row.created_at),
    industryGroup: row.industry_group,
    activity: row.activity,
    procurementMethod: row.procurement_method,
    procurementType: row.procurement_type,
    ...(row.description ? { description: row.description } : {}),
    ...(row.status ? { status: row.status } : {}),
    ...(row.application_deadline ? { applicationDeadline: asIso(row.application_deadline) } : {}),
    source: row.source,
  };
}

export const vectorLiteral = (vector: number[]): string => {
  if (vector.length !== config.dimensions || !vector.every(Number.isFinite))
    throw new AppError(400, 'INVALID_VECTOR', `Нужен конечный ${config.dimensions}-мерный вектор.`);
  return `[${vector.join(',')}]`;
};

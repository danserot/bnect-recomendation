import type {
  RecommendationFilters,
  ResolvedFilters,
  SupplierProfile,
  Tender,
} from '@bnect/shared';
import { regions } from './data/index.js';
import { config } from './config.js';
import { AppError } from './errors.js';

export function resolveFilters(
  profile: SupplierProfile,
  filters: RecommendationFilters,
): ResolvedFilters {
  const regionIds =
    filters.regionMode === 'all'
      ? []
      : filters.regionMode === 'supplier'
        ? profile.serviceRegionIds
        : filters.selectedRegionIds;
  const known = new Set(regions.map((region) => region.id));
  if (
    profile.serviceRegionIds.some((id) => !known.has(id)) ||
    filters.selectedRegionIds.some((id) => !known.has(id))
  )
    throw new AppError(
      400,
      'UNKNOWN_REGION',
      'Профиль или фильтр содержит неизвестный ID региона.',
    );
  if (filters.regionMode !== 'all' && !regionIds.length)
    throw new AppError(
      400,
      'REGION_REQUIRED',
      'В ограниченном режиме выберите хотя бы один регион.',
    );
  return {
    ...filters,
    regionIds: [...regionIds],
    regionNames: regionIds.map((id) => regions.find((region) => region.id === id)!.name),
  };
}

export function isEligible(
  tender: Tender,
  profile: SupplierProfile,
  filters: ResolvedFilters,
): boolean {
  if (
    filters.regionMode !== 'all' &&
    (!tender.regionId || !filters.regionIds.includes(tender.regionId))
  )
    return false;
  if (filters.industryGroups?.length && !filters.industryGroups.includes(tender.industryGroup))
    return false;
  if (
    filters.procurementTypes?.length &&
    !filters.procurementTypes.includes(tender.procurementType)
  )
    return false;
  if (
    filters.procurementMethods?.length &&
    !filters.procurementMethods.includes(tender.procurementMethod)
  )
    return false;
  if (filters.applySupplierIndustryGroups && !profile.industryGroups.includes(tender.industryGroup))
    return false;
  if (
    filters.applySupplierProcurementTypes &&
    !profile.procurementTypes.includes(tender.procurementType)
  )
    return false;
  if (
    filters.onlyOpen &&
    !(
      tender.status === 'open' &&
      tender.applicationDeadline &&
      new Date(tender.applicationDeadline).getTime() > new Date(config.demoNow).getTime()
    )
  )
    return false;
  return true;
}

export function availability(tender: Tender): string {
  if (!tender.status || !tender.applicationDeadline) return 'Доступность участия неизвестна';
  const expired =
    new Date(tender.applicationDeadline).getTime() <= new Date(config.demoNow).getTime();
  const prefix = tender.source === 'demo' ? 'Синтетические данные: ' : '';
  return `${prefix}${tender.status === 'closed' || expired ? 'закупка закрыта' : 'закупка открыта'} на ${config.demoNow}; срок ${tender.applicationDeadline}`;
}

export function regionalDescription(filters: ResolvedFilters): string {
  return filters.regionMode === 'all'
    ? 'Все регионы, включая неизвестные'
    : `${filters.regionMode === 'supplier' ? 'Регионы поставщика' : 'Выбранные регионы'}: ${filters.regionNames.join(', ')}`;
}

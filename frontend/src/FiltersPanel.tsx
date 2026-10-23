import { useState } from 'react';
import type { Catalog, RecommendationFilters, SupplierProfile } from '@bnect/shared';
import { Icon } from './ui';

export const defaultFilters: RecommendationFilters = {
  regionMode: 'supplier',
  selectedRegionIds: [],
  applySupplierIndustryGroups: false,
  applySupplierProcurementTypes: false,
  onlyOpen: false,
};
export function filtersError(profile: SupplierProfile, filters: RecommendationFilters) {
  if (filters.regionMode === 'supplier' && !profile.serviceRegionIds.length)
    return 'Выберите хотя бы один регион в профиле или включите «Все регионы».';
  if (filters.regionMode === 'selected' && !filters.selectedRegionIds.length)
    return 'Выберите хотя бы один регион. Пустой выбор не означает весь Казахстан.';
  if (filters.applySupplierIndustryGroups && !profile.industryGroups.length)
    return 'Для ограничения по сферам сначала укажите их в профиле.';
  if (filters.applySupplierProcurementTypes && !profile.procurementTypes.length)
    return 'Для ограничения по видам закупок укажите их в профиле.';
  return '';
}
export function FiltersPanel({
  catalog,
  profile,
  filters,
  onChange,
}: {
  catalog: Catalog;
  profile: SupplierProfile;
  filters: RecommendationFilters;
  onChange: (filters: RecommendationFilters) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const update = (patch: Partial<RecommendationFilters>) => onChange({ ...filters, ...patch });
  const regionIds =
    filters.regionMode === 'supplier' ? profile.serviceRegionIds : filters.selectedRegionIds;
  const regionNames = regionIds.map(
    (id) => catalog.regions.find((region) => region.id === id)?.name ?? id,
  );
  const select = (
    label: string,
    values: string[],
    key: 'industryGroups' | 'procurementTypes' | 'procurementMethods',
  ) => (
    <label className="field">
      <span>{label}</span>
      <select
        className="control"
        value={filters[key]?.[0] ?? ''}
        onChange={(event) => update({ [key]: event.target.value ? [event.target.value] : [] })}
      >
        <option value="">Все</option>
        {values.map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="panel filter-panel" aria-labelledby="filter-heading">
      <div className="filter-heading">
        <h2 id="filter-heading">
          <Icon name="filters" size={14} />
          Ограничения векторного поиска
        </h2>
        <button className="text-button" onClick={() => onChange({ ...defaultFilters })}>
          Сбросить
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Режим географии">
        {(
          [
            ['supplier', 'Регионы поставщика'],
            ['selected', 'Выбранные регионы'],
            ['all', 'Все регионы'],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            className={filters.regionMode === mode ? 'selected' : ''}
            aria-pressed={filters.regionMode === mode}
            onClick={() => update({ regionMode: mode })}
          >
            {label}
          </button>
        ))}
      </div>
      {filters.regionMode === 'selected' && (
        <div className="region-options">
          {catalog.regions.map((region) => (
            <label className="check-label" key={region.id}>
              <input
                type="checkbox"
                checked={filters.selectedRegionIds.includes(region.id)}
                onChange={() =>
                  update({
                    selectedRegionIds: filters.selectedRegionIds.includes(region.id)
                      ? filters.selectedRegionIds.filter((id) => id !== region.id)
                      : [...filters.selectedRegionIds, region.id],
                  })
                }
              />
              {region.name}
            </label>
          ))}
        </div>
      )}
      <p className="filter-summary">
        {filters.regionMode === 'all'
          ? 'Весь Казахстан, включая записи с неизвестным регионом.'
          : regionNames.length
            ? regionNames.join(' · ')
            : 'Регионы пока не выбраны.'}
      </p>
      <div className="filter-bottom">
        <label className="check-label">
          <input
            type="checkbox"
            checked={!!filters.onlyOpen}
            onChange={(event) => update({ onlyOpen: event.target.checked })}
          />
          Только открытые на демо-дату
        </label>
        <button
          className="text-button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? 'Скрыть фильтры' : 'Ещё фильтры'} <span aria-hidden="true">⌄</span>
        </button>
      </div>
      {advanced && (
        <div className="advanced-filters">
          {select('Сфера', catalog.industryGroups, 'industryGroups')}
          {select('Вид закупки', catalog.procurementTypes, 'procurementTypes')}
          {select('Способ закупки', catalog.procurementMethods, 'procurementMethods')}
          <div className="field">
            <span>Ограничения профиля</span>
            <label className="check-label">
              <input
                type="checkbox"
                checked={!!filters.applySupplierIndustryGroups}
                onChange={(event) => update({ applySupplierIndustryGroups: event.target.checked })}
              />
              Учитывать сферы профиля
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={!!filters.applySupplierProcurementTypes}
                onChange={(event) =>
                  update({ applySupplierProcurementTypes: event.target.checked })
                }
              />
              Учитывать виды закупок профиля
            </label>
          </div>
        </div>
      )}
      {filtersError(profile, filters) && (
        <p className="region-error" role="status">
          {filtersError(profile, filters)}
        </p>
      )}
    </section>
  );
}

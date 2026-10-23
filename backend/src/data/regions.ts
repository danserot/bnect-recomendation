import type { Region } from '@bnect/shared';

/** Demo geography dictionary. Matching is by a whole normalized alias, never substring. */
export const regions: Region[] = [
  {
    id: 'astana',
    name: 'Астана',
    aliases: ['г. Астана', 'г.Астана', 'город Астана', 'Нур-Султан', 'Нур Султан'],
  },
  { id: 'almaty', name: 'Алматы', aliases: ['г. Алматы', 'г.Алматы', 'город Алматы', 'Алма-Ата'] },
  {
    id: 'almaty-region',
    name: 'Алматинская область',
    aliases: ['Алматинская обл.', 'Алматинская обл'],
  },
  { id: 'shymkent', name: 'Шымкент', aliases: ['г. Шымкент', 'г.Шымкент', 'город Шымкент'] },
  {
    id: 'karaganda',
    name: 'Карагандинская область',
    aliases: ['Карагандинская обл.', 'Карагандинская обл', 'Караганда', 'г. Караганда'],
  },
  {
    id: 'akmola',
    name: 'Акмолинская область',
    aliases: ['Акмолинская обл.', 'Акмолинская обл', 'Кокшетау'],
  },
  {
    id: 'pavlodar',
    name: 'Павлодарская область',
    aliases: ['Павлодарская обл.', 'Павлодарская обл', 'Павлодар'],
  },
  {
    id: 'atyrau',
    name: 'Атырауская область',
    aliases: ['Атырауская обл.', 'Атырауская обл', 'Атырау'],
  },
  {
    id: 'aktobe',
    name: 'Актюбинская область',
    aliases: ['Актюбинская обл.', 'Актюбинская обл', 'Актобе'],
  },
  {
    id: 'kostanay',
    name: 'Костанайская область',
    aliases: ['Костанайская обл.', 'Костанайская обл', 'Костанай'],
  },
  {
    id: 'kyzylorda',
    name: 'Кызылординская область',
    aliases: ['Кызылординская обл.', 'Кызылординская обл', 'Кызылорда'],
  },
  {
    id: 'turkistan',
    name: 'Туркестанская область',
    aliases: ['Туркестанская обл.', 'Туркестанская обл', 'Туркестан'],
  },
  {
    id: 'mangystau',
    name: 'Мангистауская область',
    aliases: ['Мангистауская обл.', 'Мангистауская обл', 'Актау'],
  },
  {
    id: 'east-kazakhstan',
    name: 'Восточно-Казахстанская область',
    aliases: ['ВКО', 'Восточно-Казахстанская обл.', 'Усть-Каменогорск'],
  },
  {
    id: 'north-kazakhstan',
    name: 'Северо-Казахстанская область',
    aliases: ['СКО', 'Северо-Казахстанская обл.', 'Петропавловск'],
  },
  {
    id: 'west-kazakhstan',
    name: 'Западно-Казахстанская область',
    aliases: ['ЗКО', 'Западно-Казахстанская обл.', 'Уральск'],
  },
  {
    id: 'zhambyl',
    name: 'Жамбылская область',
    aliases: ['Жамбылская обл.', 'Жамбылская обл', 'Тараз'],
  },
  { id: 'abay', name: 'Область Абай', aliases: ['Абайская область', 'Абай', 'Семей'] },
  {
    id: 'zhetysu',
    name: 'Область Жетысу',
    aliases: ['Жетысуская область', 'Жетісу', 'Жетысу', 'Талдыкорган'],
  },
  { id: 'ulytau', name: 'Область Улытау', aliases: ['Улытауская область', 'Улытау', 'Жезказган'] },
];

const aliasKey = (value: string): string =>
  value.trim().normalize('NFKC').toLocaleLowerCase('ru').replace(/\s+/g, ' ');
const regionByAlias = new Map(
  regions.flatMap((region) =>
    [region.id, region.name, ...region.aliases].map((alias) => [aliasKey(alias), region] as const),
  ),
);

export function normalizeRegion(value: string): Region | undefined {
  return regionByAlias.get(aliasKey(value));
}

export function resolveRegionId(value: string): string | null {
  return normalizeRegion(value)?.id ?? null;
}

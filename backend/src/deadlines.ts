import type { DeadlineFilters, Tender } from '@bnect/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Inclusive calendar dates in UTC+5, represented by an exclusive upper bound. */
export function deadlineBounds(filters: DeadlineFilters) {
  return {
    from: filters.deadlineFrom
      ? new Date(`${filters.deadlineFrom}T00:00:00+05:00`).toISOString()
      : undefined,
    to: filters.deadlineTo
      ? new Date(Date.parse(`${filters.deadlineTo}T00:00:00+05:00`) + DAY_MS).toISOString()
      : undefined,
  };
}

export function matchesDeadline(tender: Tender, filters: DeadlineFilters): boolean {
  if (!filters.deadlineFrom && !filters.deadlineTo) return true;
  if (!tender.applicationDeadline) return false;
  const deadline = Date.parse(tender.applicationDeadline);
  const { from, to } = deadlineBounds(filters);
  return (
    Number.isFinite(deadline) &&
    (!from || deadline >= Date.parse(from)) &&
    (!to || deadline < Date.parse(to))
  );
}

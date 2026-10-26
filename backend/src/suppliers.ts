import type { SupplierProfile } from '@bnect/shared';
import { dbQuery } from './db.js';
import { AppError } from './errors.js';

export interface SupplierSourceAdapter {
  list(): Promise<SupplierProfile[]>;
  save(profile: SupplierProfile): Promise<SupplierProfile>;
}

/** Local demo profiles only. A real supplier database integration is intentionally an adapter boundary. */
export class DemoSupplierSourceAdapter implements SupplierSourceAdapter {
  async list(): Promise<SupplierProfile[]> {
    const { rows } = await dbQuery<{ profile: SupplierProfile }>(
      'SELECT profile FROM supplier_profiles ORDER BY id',
    );
    return rows.map((row) => row.profile);
  }
  async save(profile: SupplierProfile): Promise<SupplierProfile> {
    const result = await dbQuery<{ profile: SupplierProfile }>(
      'UPDATE supplier_profiles SET profile=$2::jsonb, updated_at=now() WHERE id=$1 RETURNING profile',
      [profile.id, JSON.stringify(profile)],
    );
    if (!result.rowCount)
      throw new AppError(404, 'SUPPLIER_NOT_FOUND', 'Демонстрационный профиль не найден.');
    return result.rows[0]!.profile;
  }
}

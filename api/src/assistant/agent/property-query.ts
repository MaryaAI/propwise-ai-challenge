import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { MAX_INT } from '../../common/validation';
import { PropertyFacts } from '../types';

export const SearchFilters = z.object({
  areas: z.array(z.string().min(1).max(100)).max(5).optional(),
  type: z.enum(['apartment', 'villa', 'townhouse', 'penthouse']).optional(),
  bedroomsMin: z.number().int().min(0).max(20).optional(),
  bedroomsMax: z.number().int().min(0).max(20).optional(),
  priceMinAed: z.number().int().min(0).max(MAX_INT).optional(),
  priceMaxAed: z.number().int().min(0).max(MAX_INT).optional(),
  minGrossYield: z.number().min(0).max(1).optional(),
  status: z.enum(['available', 'reserved', 'sold']).default('available'),
  sortBy: z.enum(['price', 'yield', 'size', 'pricePerSqft']).default('price'),
  excludeIds: z.array(z.uuid()).max(50).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});
export type SearchFiltersInput = z.input<typeof SearchFilters>;

export interface PropertyRow {
  id: string;
  reference: string;
  title: string;
  area: string;
  building: string | null;
  type: string;
  bedrooms: number;
  sizeSqft: number;
  priceAed: number;
  annualRentAed: number | null;
  grossYield: number | null;
  pricePerSqft: number;
  status: 'available' | 'reserved' | 'sold';
}

export interface PropertyDetail extends PropertyRow {
  bathrooms: number;
  serviceChargeAedPerSqft: number | null;
  listedAt: string;
  description: string;
}

interface PropertyRowRaw {
  id: string;
  reference: string;
  title: string;
  area: string;
  building: string | null;
  type: string;
  bedrooms: number;
  size_sqft: number;
  price_aed: number;
  annual_rent_aed: number | null;
  status: 'available' | 'reserved' | 'sold';
}

interface PropertyDetailRowRaw extends PropertyRowRaw {
  bathrooms: number;
  service_charge_aed_per_sqft: number | null;
  listed_at: Date;
  description: string;
}

const SELECT_COLUMNS = 'id, reference, title, area, building, type, bedrooms, size_sqft, price_aed, annual_rent_aed, status';

function toPropertyRow(row: PropertyRowRaw): PropertyRow {
  const grossYield = row.annual_rent_aed === null ? null : Math.round((row.annual_rent_aed / row.price_aed) * 10_000) / 10_000;
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    area: row.area,
    building: row.building,
    type: row.type,
    bedrooms: row.bedrooms,
    sizeSqft: row.size_sqft,
    priceAed: row.price_aed,
    annualRentAed: row.annual_rent_aed,
    grossYield,
    pricePerSqft: Math.round(row.price_aed / row.size_sqft),
    status: row.status,
  };
}

/** Reads properties scoped to one agency. Every query is parameterized; no SQL is built from user strings. */
@Injectable()
export class PropertyQuery {
  constructor(private readonly em: EntityManager) {}

  async search(agencyId: string, filters: SearchFiltersInput): Promise<{ items: PropertyRow[]; total: number }> {
    const f = SearchFilters.parse(filters);

    const conditions: string[] = ['agency_id = ?'];
    const params: unknown[] = [agencyId];

    if (f.areas && f.areas.length > 0) {
      conditions.push('lower(area) in (?)');
      params.push(f.areas.map((area) => area.toLowerCase()));
    }
    if (f.type) {
      conditions.push('type = ?');
      params.push(f.type);
    }
    if (f.bedroomsMin !== undefined) {
      conditions.push('bedrooms >= ?');
      params.push(f.bedroomsMin);
    }
    if (f.bedroomsMax !== undefined) {
      conditions.push('bedrooms <= ?');
      params.push(f.bedroomsMax);
    }
    if (f.priceMinAed !== undefined) {
      conditions.push('price_aed >= ?');
      params.push(f.priceMinAed);
    }
    if (f.priceMaxAed !== undefined) {
      conditions.push('price_aed <= ?');
      params.push(f.priceMaxAed);
    }
    conditions.push('status = ?');
    params.push(f.status);
    if (f.minGrossYield !== undefined) {
      conditions.push('annual_rent_aed is not null and (annual_rent_aed::float / price_aed) >= ?');
      params.push(f.minGrossYield);
    }
    if (f.excludeIds && f.excludeIds.length > 0) {
      conditions.push('id not in (?)');
      params.push(f.excludeIds);
    }

    const where = conditions.join(' and ');

    let orderBy: string;
    switch (f.sortBy) {
      case 'yield':
        orderBy = '(annual_rent_aed::float / price_aed) desc nulls last';
        break;
      case 'size':
        orderBy = 'size_sqft desc';
        break;
      case 'pricePerSqft':
        orderBy = '(price_aed::float / size_sqft) asc';
        break;
      default:
        orderBy = 'price_aed asc';
        break;
    }

    const [rows, countRows] = await Promise.all([
      this.em
        .getConnection()
        .execute<PropertyRowRaw[]>(`select ${SELECT_COLUMNS} from properties where ${where} order by ${orderBy}, reference asc limit ?`, [
          ...params,
          f.limit,
        ]),
      this.em.getConnection().execute<{ count: string }[]>(`select count(*) as count from properties where ${where}`, params),
    ]);

    return { items: rows.map(toPropertyRow), total: Number(countRows[0].count) };
  }

  async getByIdOrReference(agencyId: string, { id, reference }: { id?: string; reference?: string }): Promise<PropertyDetail | null> {
    const conditions = ['agency_id = ?'];
    const params: unknown[] = [agencyId];

    if (id !== undefined) {
      conditions.push('id = ?');
      params.push(id);
    } else if (reference !== undefined) {
      conditions.push('lower(reference) = lower(?)');
      params.push(reference);
    } else {
      return null;
    }

    const rows = await this.em.getConnection().execute<PropertyDetailRowRaw[]>(
      `select ${SELECT_COLUMNS}, bathrooms, service_charge_aed_per_sqft, listed_at, description
         from properties where ${conditions.join(' and ')} limit 1`,
      params,
    );
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      ...toPropertyRow(row),
      bathrooms: row.bathrooms,
      serviceChargeAedPerSqft: row.service_charge_aed_per_sqft,
      listedAt: new Date(row.listed_at).toISOString(),
      description: row.description,
    };
  }

  async factsByIds(agencyId: string, ids: string[]): Promise<Map<string, PropertyFacts>> {
    const facts = new Map<string, PropertyFacts>();
    if (ids.length === 0) return facts;

    const rows = await this.em
      .getConnection()
      .execute<PropertyRowRaw[]>(`select ${SELECT_COLUMNS} from properties where agency_id = ? and id in (?)`, [agencyId, ids]);

    for (const row of rows) {
      facts.set(row.id, {
        id: row.id,
        agencyId,
        reference: row.reference,
        area: row.area,
        type: row.type,
        bedrooms: row.bedrooms,
        priceAed: row.price_aed,
        annualRentAed: row.annual_rent_aed,
        status: row.status,
      });
    }
    return facts;
  }
}

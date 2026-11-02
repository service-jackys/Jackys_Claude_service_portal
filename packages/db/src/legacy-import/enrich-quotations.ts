import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { computeQuotationTotals } from '../../../contracts/src/index.js';
import { insertAuditEvent } from '../audit.js';
import { type Plan, SOURCE_NAME } from './plan.js';

// Brings quotations that an earlier import created into the new shape (units with
// location/complaint/brand, charges linked to units, VAT) using the same sheet
// rows the importer reads. It only touches products, parts, labour, VAT and total.
// A quotation is left alone when someone edited it in the portal, so no work is lost.

export type EnrichStatus =
  | 'enriched'
  | 'would-enrich'
  | 'up-to-date'
  | 'skipped-edited'
  | 'skipped-not-imported'
  | 'skipped-total-mismatch';

export type EnrichRow = {
  legacyRef: string;
  quotationReference: string;
  status: EnrichStatus;
  note: string;
  totalBefore: number | null;
  totalAfter: number | null;
  sheetTotal: number;
  units: number;
  charges: number;
};

type Row = {
  id: string;
  quotation_reference: string;
  created_at: Date;
  updated_at: Date;
  products: unknown;
  parts: unknown;
  labour_amount: string;
  grand_total: string;
  vat_rate: string;
  edits: string;
};

// jsonb stores object keys in its own order, so compare values, not text.
const same = (a: unknown, b: unknown) => isDeepStrictEqual(a, b);

export async function enrichQuotations(
  client: PoolClient,
  plan: Plan,
  options: { apply: boolean; profileId?: string },
): Promise<EnrichRow[]> {
  const rows: EnrichRow[] = [];
  const ordered = [...plan.quotations].sort((a, b) =>
    a.legacyRef.localeCompare(b.legacyRef, 'en', { numeric: true }),
  );
  for (const q of ordered) {
    const base = {
      legacyRef: q.legacyRef,
      sheetTotal: q.grandTotal,
      units: q.products.length,
      charges: q.parts.length,
    };
    const found = await client.query<Row>(
      `SELECT q.id::text, q.quotation_reference, q.created_at, q.updated_at, q.products, q.parts,
              q.labour_amount::text, q.grand_total::text, q.vat_rate::text,
              (SELECT count(*) FROM audit_events a
                WHERE a.target_type = 'quotation' AND a.target_id::text = q.id::text
                  AND a.action = 'quotation.updated')::text AS edits
         FROM legacy_references l
         JOIN quotations q ON q.id = l.entity_id
        WHERE l.source_name = $1 AND l.entity_type = 'quotation' AND l.legacy_reference = $2
          FOR UPDATE OF q`,
      [SOURCE_NAME, q.legacyRef],
    );
    const cur = found.rows[0];
    if (!cur) {
      rows.push({
        ...base,
        quotationReference: '',
        status: 'skipped-not-imported',
        note: 'Not in the portal yet. Run the import first.',
        totalBefore: null,
        totalAfter: null,
      });
      continue;
    }
    const common = {
      ...base,
      quotationReference: cur.quotation_reference,
      totalBefore: Number(cur.grand_total),
    };

    // Edited in the portal: the save stamps updated_at and writes an audit event.
    if (cur.updated_at.getTime() !== cur.created_at.getTime() || Number(cur.edits) > 0) {
      rows.push({
        ...common,
        status: 'skipped-edited',
        note: 'Changed in the portal after the import, so it was not touched.',
        totalAfter: null,
      });
      continue;
    }

    const totals = computeQuotationTotals({
      products: q.products,
      parts: q.parts,
      labourAmount: q.labourAmount,
      vatRate: q.vatRate,
    });
    if (Math.abs(totals.grandTotal - q.grandTotal) > 0.01) {
      rows.push({
        ...common,
        status: 'skipped-total-mismatch',
        note: `Rebuilt total ${totals.grandTotal.toFixed(2)} does not match the sheet total ${q.grandTotal.toFixed(2)}.`,
        totalAfter: totals.grandTotal,
      });
      continue;
    }

    const asStored = (value: unknown) => JSON.parse(JSON.stringify(value));
    const unchanged =
      same(cur.products, asStored(q.products)) &&
      same(cur.parts, asStored(q.parts)) &&
      Number(cur.vat_rate) === q.vatRate &&
      Math.abs(Number(cur.grand_total) - q.grandTotal) < 0.005;
    if (unchanged) {
      rows.push({
        ...common,
        status: 'up-to-date',
        note: 'Already in the new format.',
        totalAfter: totals.grandTotal,
      });
      continue;
    }

    if (options.apply) {
      await client.query(
        `UPDATE quotations
            SET products = $2::jsonb, parts = $3::jsonb, labour_amount = $4,
                vat_rate = $5, subtotal_amount = $6, vat_amount = $7, grand_total = $8
          WHERE id = $1`,
        [
          cur.id,
          JSON.stringify(q.products),
          JSON.stringify(q.parts),
          q.labourAmount,
          q.vatRate,
          totals.subtotal,
          totals.vat,
          totals.grandTotal,
        ],
      );
      await insertAuditEvent(client, {
        actorProfileId: options.profileId,
        action: 'quotation.enriched',
        targetType: 'quotation',
        targetId: cur.id,
        metadata: {
          quotationReference: cur.quotation_reference,
          legacyReference: q.legacyRef,
          before: {
            products: cur.products,
            parts: cur.parts,
            labourAmount: Number(cur.labour_amount),
            vatRate: Number(cur.vat_rate),
            grandTotal: Number(cur.grand_total),
          },
        },
      });
    }
    rows.push({
      ...common,
      status: options.apply ? 'enriched' : 'would-enrich',
      note: `${q.products.length} unit(s), ${q.parts.length} charge line(s), VAT ${q.vatRate * 100}%.`,
      totalAfter: totals.grandTotal,
    });
  }
  return rows;
}

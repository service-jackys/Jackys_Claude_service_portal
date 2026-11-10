import type { PoolClient } from 'pg';

export type StoredSheet = {
  name: string;
  rows: Record<string, string | number | boolean>[];
};

const CHUNK = 1000;

/** Stores the rows of the extra workbook sheets for one revenue batch (modification #247). */
export async function insertSheetRows(
  client: Pick<PoolClient, 'query'>,
  batchId: string | number,
  sheets: StoredSheet[],
): Promise<void> {
  for (const sheet of sheets) {
    for (let start = 0; start < sheet.rows.length; start += CHUNK) {
      const chunk = sheet.rows.slice(start, start + CHUNK);
      await client.query(
        `INSERT INTO workbook_sheet_rows (batch_id, sheet, row_no, data)
         SELECT $1::bigint, $2, n, d::jsonb
           FROM unnest($3::int[], $4::text[]) AS t(n, d)`,
        [
          batchId,
          sheet.name,
          chunk.map((_, i) => start + i + 1),
          chunk.map((row) => JSON.stringify(row)),
        ],
      );
    }
  }
}

/** Rows of one stored workbook sheet for a batch, in sheet order (modification #249). */
export async function listSheetRows(
  client: Pick<PoolClient, 'query'>,
  batchId: string | number,
  sheet: string,
): Promise<{ rowNo: number; data: Record<string, unknown> }[]> {
  const result = await client.query<{ row_no: number; data: Record<string, unknown> }>(
    `SELECT row_no, data FROM workbook_sheet_rows WHERE batch_id = $1 AND sheet = $2 ORDER BY row_no`,
    [batchId, sheet],
  );
  return result.rows.map((r) => ({ rowNo: r.row_no, data: r.data }));
}

import type { PoolClient } from 'pg';

/** Main groups that the item search offers first (service-relevant items). */
export const STOCK_SEARCH_GROUPS = ['MDA', 'SDA'] as const;

/** One row of the ERP Item Listing (Item Code, Item Desc, Maingrp Name, Grp Name,
 *  SUBGRPNAME, BRANDNAME). */
export type StockItem = {
  itemCode: string;
  itemDesc: string;
  mainGroup: string | null;
  groupName: string | null;
  subGroup: string | null;
  brand: string | null;
};

export type StockItemChange = {
  itemCode: string;
  fields: { field: string; from: string | null; to: string | null }[];
};

export type StockUploadSummary = {
  id: string;
  fileName: string;
  rowCount: number;
  itemCount: number;
  newItems: number;
  changedItems: number;
  report: Record<string, unknown>;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedAt: Date;
  /** The original file is still held and can be downloaded as uploaded. */
  hasFile: boolean;
};

const DESCRIPTIVE_FIELDS: { key: keyof StockItem; label: string }[] = [
  { key: 'itemDesc', label: 'Item Desc' },
  { key: 'mainGroup', label: 'Maingrp Name' },
  { key: 'groupName', label: 'Grp Name' },
  { key: 'subGroup', label: 'SUBGRPNAME' },
  { key: 'brand', label: 'BRANDNAME' },
];

const CHUNK = 1000;

export type ReplaceStockResult = {
  uploadId: string;
  newItems: number;
  changedItems: number;
  unchangedItems: number;
  changes: StockItemChange[];
};

const itemColumns = `
  item_code AS "itemCode",
  item_desc AS "itemDesc",
  main_group AS "mainGroup",
  group_name AS "groupName",
  sub_group AS "subGroup",
  brand
`;

type Queryable = Pick<PoolClient, 'query'>;

/**
 * Fold an uploaded Item Listing into the stock master: new item codes are added,
 * known ones are updated to what the file says. Items that are no longer in the
 * file are kept; they simply stop being refreshed (stock_master.last_seen_at is
 * older than the latest upload, shown as "not in the latest file").
 * `items` is keyed by upper-cased item code.
 */
export async function upsertStockMaster(
  client: PoolClient,
  input: {
    fileName: string;
    fileSha256: string;
    rowCount: number;
    items: Map<string, StockItem>;
    uploadedBy: string | null;
  },
): Promise<ReplaceStockResult> {
  const upload = await client.query<{ id: string }>(
    `INSERT INTO stock_uploads (file_name, file_sha256, row_count, item_count, uploaded_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
    [input.fileName, input.fileSha256, input.rowCount, input.items.size, input.uploadedBy],
  );
  const uploadId = upload.rows[0].id;

  const entries = [...input.items.entries()];
  let newItems = 0;
  let changedItems = 0;
  let unchangedItems = 0;
  const changes: StockItemChange[] = [];

  for (let start = 0; start < entries.length; start += CHUNK) {
    const chunk = entries.slice(start, start + CHUNK);
    const existing = new Map<string, StockItem>();
    const found = await client.query<StockItem>(
      `SELECT ${itemColumns} FROM stock_master WHERE upper(item_code) = ANY($1::text[])`,
      [chunk.map(([upper]) => upper)],
    );
    for (const row of found.rows) existing.set(row.itemCode.toUpperCase(), row);

    const codes: string[] = [];
    const descs: string[] = [];
    const mains: (string | null)[] = [];
    const groups: (string | null)[] = [];
    const subs: (string | null)[] = [];
    const brands: (string | null)[] = [];
    for (const [upper, item] of chunk) {
      const before = existing.get(upper);
      if (!before) {
        newItems += 1;
      } else {
        const fields = DESCRIPTIVE_FIELDS.filter(
          ({ key }) => (before[key] ?? null) !== (item[key] ?? null),
        ).map(({ key, label }) => ({
          field: label,
          from: before[key] ?? null,
          to: item[key] ?? null,
        }));
        if (fields.length === 0) {
          unchangedItems += 1;
        } else {
          changedItems += 1;
          changes.push({ itemCode: before.itemCode, fields });
        }
      }
      // A code already stored keeps its stored spelling (lookups ignore case).
      codes.push(before?.itemCode ?? item.itemCode);
      descs.push(item.itemDesc);
      mains.push(item.mainGroup);
      groups.push(item.groupName);
      subs.push(item.subGroup);
      brands.push(item.brand);
    }
    await client.query(
      `INSERT INTO stock_master (item_code, item_desc, main_group, group_name, sub_group, brand, last_seen_at)
       SELECT code, descr, main, grp, sub, brand, now()
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
              AS t(code, descr, main, grp, sub, brand)
       ON CONFLICT (item_code) DO UPDATE SET
         item_desc = EXCLUDED.item_desc,
         main_group = EXCLUDED.main_group,
         group_name = EXCLUDED.group_name,
         sub_group = EXCLUDED.sub_group,
         brand = EXCLUDED.brand,
         last_seen_at = EXCLUDED.last_seen_at,
         updated_at = CASE
           WHEN (stock_master.item_desc, stock_master.main_group, stock_master.group_name,
                 stock_master.sub_group, stock_master.brand)
                IS NOT DISTINCT FROM
                (EXCLUDED.item_desc, EXCLUDED.main_group, EXCLUDED.group_name,
                 EXCLUDED.sub_group, EXCLUDED.brand)
           THEN stock_master.updated_at ELSE now() END`,
      [codes, descs, mains, groups, subs, brands],
    );
  }

  await client.query(
    `UPDATE stock_uploads SET new_items = $2, changed_items = $3 WHERE id = $1::bigint`,
    [uploadId, newItems, changedItems],
  );

  return { uploadId, newItems, changedItems, unchangedItems, changes };
}

export async function saveStockUploadReport(
  client: PoolClient,
  uploadId: string,
  report: Record<string, unknown>,
): Promise<void> {
  await client.query(`UPDATE stock_uploads SET report = $2::jsonb WHERE id = $1::bigint`, [
    uploadId,
    JSON.stringify(report),
  ]);
}

export type StockSearchHit = StockItem;

/** Main groups that are not repairable products (charges, 3PL, vouchers). */
export const STOCK_NON_PRODUCT_GROUPS = [
  'VOUCHERS & OTHER CHARGES',
  '3PL-NON ELECTRONICS',
] as const;

/**
 * Item search: exact code first, then code prefix, then appliances (MDA, SDA)
 * ahead of the other groups. Matches item code or description. Optional brand
 * and main-group filters give the brand-then-model cascade. Non-product groups
 * are never offered.
 */
export async function searchStockItems(
  db: Queryable,
  options: { query: string; limit: number; brand?: string; group?: string },
): Promise<StockSearchHit[]> {
  const term = options.query.trim();
  const brand = options.brand?.trim() ?? '';
  const group = options.group?.trim() ?? '';
  if (!term && !brand && !group) return [];
  const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
  const result = await db.query<StockSearchHit>(
    `SELECT ${itemColumns}
       FROM stock_master
      WHERE ($1 = '' OR item_code ILIKE $2 ESCAPE '\\' OR item_desc ILIKE $3 ESCAPE '\\')
        AND ($4 = '' OR upper(brand) = upper($4))
        AND ($5 = '' OR upper(main_group) = upper($5))
        AND COALESCE(main_group, '') <> ALL($6::text[])
      ORDER BY (upper(item_code) = upper($1)) DESC,
               (item_code ILIKE $2 ESCAPE '\\') DESC,
               (COALESCE(brand, '') NOT ILIKE '%SPARES%') DESC,
               (main_group = ANY($7::text[])) DESC,
               item_code
      LIMIT $8`,
    [
      term,
      `${escaped}%`,
      `%${escaped}%`,
      brand,
      group,
      [...STOCK_NON_PRODUCT_GROUPS],
      [...STOCK_SEARCH_GROUPS],
      options.limit,
    ],
  );
  return result.rows;
}

/** Brands and main groups on offer, with item counts -- feeds the brand
 *  type-ahead and the group filter. */
export async function stockFacets(db: Queryable): Promise<{
  brands: { brand: string; count: number }[];
  groups: { group: string; count: number }[];
}> {
  const exclude = [...STOCK_NON_PRODUCT_GROUPS];
  const brands = await db.query<{ brand: string; count: number }>(
    `SELECT brand, count(*)::int AS count FROM stock_master
      WHERE brand IS NOT NULL AND COALESCE(main_group, '') <> ALL($1::text[])
      GROUP BY brand ORDER BY count(*) DESC, brand`,
    [exclude],
  );
  const groups = await db.query<{ group: string; count: number }>(
    `SELECT main_group AS "group", count(*)::int AS count FROM stock_master
      WHERE main_group IS NOT NULL AND main_group <> ALL($1::text[])
      GROUP BY main_group ORDER BY (main_group = ANY($2::text[])) DESC, count(*) DESC`,
    [exclude, [...STOCK_SEARCH_GROUPS]],
  );
  return { brands: brands.rows, groups: groups.rows };
}

export async function stockStatus(db: Queryable): Promise<{
  lastUpload: StockUploadSummary | null;
  totalItems: number;
  searchableItems: number;
  notInFileCount: number;
  recentUploads: StockUploadSummary[];
}> {
  const uploads = await db.query<StockUploadSummary>(
    `SELECT u.id::text AS id, u.file_name AS "fileName", u.row_count AS "rowCount",
            u.item_count AS "itemCount", u.new_items AS "newItems", u.changed_items AS "changedItems",
            u.report, u.uploaded_by::text AS "uploadedBy", p.display_name AS "uploadedByName",
            u.uploaded_at AS "uploadedAt", (u.file_bytes IS NOT NULL) AS "hasFile"
       FROM stock_uploads u
       LEFT JOIN profiles p ON p.id = u.uploaded_by
      ORDER BY u.uploaded_at DESC, u.id DESC
      LIMIT 30`,
  );
  const totals = await db.query<{ total: string; searchable: string; notInFile: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE main_group = ANY($1::text[]))::text AS searchable,
            count(*) FILTER (
              WHERE last_seen_at < (SELECT max(u.uploaded_at) FROM stock_uploads u)
            )::text AS "notInFile"
       FROM stock_master`,
    [[...STOCK_SEARCH_GROUPS]],
  );
  return {
    lastUpload: uploads.rows[0] ?? null,
    totalItems: Number(totals.rows[0]?.total ?? 0),
    searchableItems: Number(totals.rows[0]?.searchable ?? 0),
    notInFileCount: Number(totals.rows[0]?.notInFile ?? 0),
    recentUploads: uploads.rows,
  };
}

/** Exact item-code lookup in the stock master (case-insensitive). */
export async function findStockItemByCode(
  db: Queryable,
  itemCode: string,
): Promise<StockItem | null> {
  const code = itemCode.trim();
  if (!code) return null;
  const result = await db.query<StockItem>(
    `SELECT ${itemColumns} FROM stock_master WHERE upper(item_code) = upper($1) LIMIT 1`,
    [code],
  );
  return result.rows[0] ?? null;
}

/**
 * Keep the original bytes of the newest upload and drop them from older uploads
 * (their rows and reports stay).
 */
export async function saveStockUploadFile(
  client: PoolClient,
  uploadId: string,
  bytes: Buffer,
): Promise<void> {
  await client.query(`UPDATE stock_uploads SET file_bytes = $2 WHERE id = $1::bigint`, [
    uploadId,
    bytes,
  ]);
  await client.query(
    `UPDATE stock_uploads SET file_bytes = NULL WHERE id <> $1::bigint AND file_bytes IS NOT NULL`,
    [uploadId],
  );
}

export type StockUploadFile = {
  id: string;
  fileName: string;
  uploadedAt: Date;
  bytes: Buffer | null;
};

/** The newest upload with its original bytes (null when not kept). */
export async function latestStockUploadFile(db: Queryable): Promise<StockUploadFile | null> {
  const result = await db.query<StockUploadFile>(
    `SELECT id::text AS id, file_name AS "fileName", uploaded_at AS "uploadedAt", file_bytes AS bytes
       FROM stock_uploads ORDER BY uploaded_at DESC, id DESC LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

export type StockMasterRow = StockItem & { lastSeenAt: Date; inLatestFile: boolean };

/** The whole stock master, for the rebuilt download. */
export async function stockMasterRows(db: Queryable): Promise<StockMasterRow[]> {
  const result = await db.query<StockMasterRow>(
    `SELECT ${itemColumns}, last_seen_at AS "lastSeenAt",
            last_seen_at >= COALESCE((SELECT max(u.uploaded_at) FROM stock_uploads u), '-infinity') AS "inLatestFile"
       FROM stock_master ORDER BY item_code`,
  );
  return result.rows;
}

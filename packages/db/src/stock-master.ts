import type { PoolClient } from 'pg';

export const STOCK_CHANNELS = ['JDI', 'JMS', 'TGE'] as const;
export type StockChannel = (typeof STOCK_CHANNELS)[number];

/** Main groups that the item search offers (service-relevant items only). */
export const STOCK_SEARCH_GROUPS = ['MDA', 'SDA'] as const;

export type StockRow = {
  location: string | null;
  locnDesc: string | null;
  itemCode: string;
  itemDesc: string;
  grade: string | null;
  stock: number | null;
  wac: number | null;
  value: number | null;
  transit: number | null;
  reserved: number | null;
  mainGroup: string | null;
  groupName: string | null;
  subGroup: string | null;
  brand: string | null;
  itemType: string | null;
  lastGrn: number | null;
  lastGrnDate: string | null;
  landedCost: number | null;
};

export type StockItem = {
  itemCode: string;
  itemDesc: string;
  grade: string | null;
  mainGroup: string | null;
  groupName: string | null;
  subGroup: string | null;
  brand: string | null;
  itemType: string | null;
  lastChannel: StockChannel;
};

export type StockItemChange = {
  itemCode: string;
  fields: { field: string; from: string | null; to: string | null }[];
  previousChannel: StockChannel;
};

export type StockUploadSummary = {
  id: string;
  channel: StockChannel;
  fileName: string;
  rowCount: number;
  itemCount: number;
  newItems: number;
  changedItems: number;
  report: Record<string, unknown>;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedAt: Date;
};

const DESCRIPTIVE_FIELDS: { key: keyof StockItem; label: string }[] = [
  { key: 'itemDesc', label: 'ItemDesc' },
  { key: 'grade', label: 'Grade' },
  { key: 'mainGroup', label: 'MainGroup' },
  { key: 'groupName', label: 'Group' },
  { key: 'subGroup', label: 'SubGroup' },
  { key: 'brand', label: 'Brand' },
  { key: 'itemType', label: 'TYPE' },
];

const CHUNK = 500;

export type ReplaceStockResult = {
  uploadId: string;
  newItems: number;
  changedItems: number;
  unchangedItems: number;
  changes: StockItemChange[];
};

/**
 * Replace one channel's positions with the uploaded rows and fold the unique
 * items into stock_items. Items that vanished from the channel are kept; they
 * simply stop being refreshed (see stock_item_channels.last_seen_at).
 */
export async function replaceChannelStock(
  client: PoolClient,
  input: {
    channel: StockChannel;
    fileName: string;
    fileSha256: string;
    rows: StockRow[];
    items: Map<string, StockRow>;
    uploadedBy: string | null;
  },
): Promise<ReplaceStockResult> {
  const upload = await client.query<{ id: string }>(
    `INSERT INTO stock_uploads (channel, file_name, file_sha256, row_count, item_count, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`,
    [
      input.channel,
      input.fileName,
      input.fileSha256,
      input.rows.length,
      input.items.size,
      input.uploadedBy,
    ],
  );
  const uploadId = upload.rows[0].id;

  await client.query('DELETE FROM stock_positions WHERE channel = $1', [input.channel]);
  for (let start = 0; start < input.rows.length; start += CHUNK) {
    const chunk = input.rows.slice(start, start + CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const base = params.length;
      params.push(
        input.channel,
        uploadId,
        row.location,
        row.locnDesc,
        row.itemCode,
        row.itemDesc,
        row.grade,
        row.stock,
        row.wac,
        row.value,
        row.transit,
        row.reserved,
        row.mainGroup,
        row.groupName,
        row.subGroup,
        row.brand,
        row.itemType,
        row.lastGrn,
        row.lastGrnDate,
        row.landedCost,
      );
      return `(${Array.from({ length: 20 }, (_, i) => `$${base + i + 1}`).join(', ')})`;
    });
    await client.query(
      `INSERT INTO stock_positions (
         channel, upload_id, location, locn_desc, item_code, item_desc, grade, stock, wac, value,
         transit, reserved, main_group, group_name, sub_group, brand, item_type, last_grn,
         last_grn_date, landed_cost
       ) VALUES ${tuples.join(', ')}`,
      params,
    );
  }

  const codes = [...input.items.keys()];
  const existing = new Map<string, StockItem>();
  for (let start = 0; start < codes.length; start += CHUNK) {
    const result = await client.query<StockItem>(
      `SELECT ${itemColumns} FROM stock_items WHERE item_code = ANY($1::text[])`,
      [codes.slice(start, start + CHUNK)],
    );
    for (const row of result.rows) existing.set(row.itemCode, row);
  }

  let newItems = 0;
  let changedItems = 0;
  let unchangedItems = 0;
  const changes: StockItemChange[] = [];
  for (const [code, row] of input.items) {
    const next: StockItem = {
      itemCode: code,
      itemDesc: row.itemDesc,
      grade: row.grade,
      mainGroup: row.mainGroup,
      groupName: row.groupName,
      subGroup: row.subGroup,
      brand: row.brand,
      itemType: row.itemType,
      lastChannel: input.channel,
    };
    const before = existing.get(code);
    if (!before) {
      newItems += 1;
    } else {
      const fields = DESCRIPTIVE_FIELDS.filter(
        ({ key }) => (before[key] ?? null) !== (next[key] ?? null),
      ).map(({ key, label }) => ({
        field: label,
        from: (before[key] as string | null) ?? null,
        to: (next[key] as string | null) ?? null,
      }));
      if (fields.length === 0) {
        unchangedItems += 1;
      } else {
        changedItems += 1;
        changes.push({ itemCode: code, fields, previousChannel: before.lastChannel });
      }
    }
    await client.query(
      `INSERT INTO stock_items (
         item_code, item_desc, grade, main_group, group_name, sub_group, brand, item_type, last_channel
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (item_code) DO UPDATE SET
         item_desc = EXCLUDED.item_desc,
         grade = EXCLUDED.grade,
         main_group = EXCLUDED.main_group,
         group_name = EXCLUDED.group_name,
         sub_group = EXCLUDED.sub_group,
         brand = EXCLUDED.brand,
         item_type = EXCLUDED.item_type,
         last_channel = EXCLUDED.last_channel,
         updated_at = now()`,
      [
        code,
        next.itemDesc,
        next.grade,
        next.mainGroup,
        next.groupName,
        next.subGroup,
        next.brand,
        next.itemType,
        input.channel,
      ],
    );
  }

  for (let start = 0; start < codes.length; start += CHUNK) {
    await client.query(
      `INSERT INTO stock_item_channels (item_code, channel, last_seen_at)
       SELECT code, $2, now() FROM unnest($1::text[]) AS code
       ON CONFLICT (item_code, channel) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [codes.slice(start, start + CHUNK), input.channel],
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

const itemColumns = `
  item_code AS "itemCode",
  item_desc AS "itemDesc",
  grade,
  main_group AS "mainGroup",
  group_name AS "groupName",
  sub_group AS "subGroup",
  brand,
  item_type AS "itemType",
  last_channel AS "lastChannel"
`;

type Queryable = Pick<PoolClient, 'query'>;

export type StockSearchHit = StockItem & {
  channels: { channel: StockChannel; seen: boolean }[];
};

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
    `SELECT ${itemColumns},
            COALESCE((
              SELECT json_agg(json_build_object(
                       'channel', sic.channel,
                       'seen', sic.last_seen_at >= (
                         SELECT max(u.uploaded_at) FROM stock_uploads u WHERE u.channel = sic.channel
                       )
                     ) ORDER BY sic.channel)
              FROM stock_item_channels sic WHERE sic.item_code = stock_items.item_code
            ), '[]'::json) AS channels
       FROM stock_items
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
    `SELECT brand, count(*)::int AS count FROM stock_items
      WHERE brand IS NOT NULL AND COALESCE(main_group, '') <> ALL($1::text[])
      GROUP BY brand ORDER BY count(*) DESC, brand`,
    [exclude],
  );
  const groups = await db.query<{ group: string; count: number }>(
    `SELECT main_group AS "group", count(*)::int AS count FROM stock_items
      WHERE main_group IS NOT NULL AND main_group <> ALL($1::text[])
      GROUP BY main_group ORDER BY (main_group = ANY($2::text[])) DESC, count(*) DESC`,
    [exclude, [...STOCK_SEARCH_GROUPS]],
  );
  return { brands: brands.rows, groups: groups.rows };
}

export type StockChannelStatus = {
  channel: StockChannel;
  lastUpload: StockUploadSummary | null;
  itemCount: number;
  notSeenCount: number;
  positionRows: number;
};

export async function stockStatus(db: Queryable): Promise<{
  channels: StockChannelStatus[];
  totalItems: number;
  searchableItems: number;
  recentUploads: StockUploadSummary[];
}> {
  const uploads = await db.query<StockUploadSummary>(
    `SELECT u.id::text AS id, u.channel, u.file_name AS "fileName", u.row_count AS "rowCount",
            u.item_count AS "itemCount", u.new_items AS "newItems", u.changed_items AS "changedItems",
            u.report, u.uploaded_by::text AS "uploadedBy", p.display_name AS "uploadedByName",
            u.uploaded_at AS "uploadedAt"
       FROM stock_uploads u
       LEFT JOIN profiles p ON p.id = u.uploaded_by
      ORDER BY u.uploaded_at DESC, u.id DESC
      LIMIT 30`,
  );
  const counts = await db.query<{
    channel: StockChannel;
    items: string;
    notSeen: string;
  }>(
    `SELECT sic.channel,
            count(*)::text AS items,
            count(*) FILTER (
              WHERE sic.last_seen_at < (SELECT max(u.uploaded_at) FROM stock_uploads u WHERE u.channel = sic.channel)
            )::text AS "notSeen"
       FROM stock_item_channels sic
      GROUP BY sic.channel`,
  );
  const positions = await db.query<{ channel: StockChannel; n: string }>(
    `SELECT channel, count(*)::text AS n FROM stock_positions GROUP BY channel`,
  );
  const totals = await db.query<{ total: string; searchable: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE main_group = ANY($1::text[]))::text AS searchable
       FROM stock_items`,
    [[...STOCK_SEARCH_GROUPS]],
  );
  return {
    channels: STOCK_CHANNELS.map((channel) => {
      const count = counts.rows.find((row) => row.channel === channel);
      const position = positions.rows.find((row) => row.channel === channel);
      return {
        channel,
        lastUpload: uploads.rows.find((row) => row.channel === channel) ?? null,
        itemCount: Number(count?.items ?? 0),
        notSeenCount: Number(count?.notSeen ?? 0),
        positionRows: Number(position?.n ?? 0),
      };
    }),
    totalItems: Number(totals.rows[0]?.total ?? 0),
    searchableItems: Number(totals.rows[0]?.searchable ?? 0),
    recentUploads: uploads.rows,
  };
}

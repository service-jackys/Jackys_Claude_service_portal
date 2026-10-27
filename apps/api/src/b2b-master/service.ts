import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { insertAuditEvent } from '../../../../packages/db/src/audit.js';
import {
  b2bKnownSalesmen,
  b2bMasterRows,
  b2bStatus,
  latestB2bUploadFile,
  saveB2bUploadFile,
  saveB2bUploadReport,
  upsertB2bCustomers,
} from '../../../../packages/db/src/b2b-master.js';
import { withTransaction } from '../../../../packages/db/src/transaction.js';
import { buildB2bMasterWorkbook } from './download.js';
import { B2bParseError, parseB2bWorkbook } from './parser.js';

export class B2bMasterServiceError extends Error {
  constructor(
    public readonly code: 'invalid-file' | 'no-data',
    message: string,
  ) {
    super(message);
  }
}

export type UploadedB2bFile = { originalname: string; size: number; buffer: Buffer };

export const MAX_B2B_FILE_BYTES = 15 * 1024 * 1024;

const REPORT_CHANGE_LIMIT = 100;
const NAME_WARNING_LIMIT = 30;

export function createB2bMasterService(pool: Pool) {
  async function upload(
    file: UploadedB2bFile,
    profileId: string,
    requestId: string = randomUUID(),
  ) {
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new B2bMasterServiceError('invalid-file', 'Upload the customer list as .xlsx.');
    }
    let parsed;
    try {
      parsed = await parseB2bWorkbook(file.buffer);
    } catch (error) {
      if (error instanceof B2bParseError) {
        throw new B2bMasterServiceError('invalid-file', error.message);
      }
      throw error;
    }
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    return withTransaction(pool, async (client) => {
      // Salesmen the master does not know are reported, not rejected: the customer is
      // still stored, but a job for it needs a salesman linked to a sales channel.
      const knownSalesmen = await b2bKnownSalesmen(client);
      const unknownSalesmen = new Map<string, number>();
      let withoutSalesman = 0;
      for (const customer of parsed.customers.values()) {
        if (!customer.salesman) withoutSalesman += 1;
        else if (!knownSalesmen.has(customer.salesman.trim().toLowerCase())) {
          unknownSalesmen.set(customer.salesman, (unknownSalesmen.get(customer.salesman) ?? 0) + 1);
        }
      }
      const warnings = [...parsed.warnings];
      if (withoutSalesman > 0) {
        warnings.push(
          `${withoutSalesman} customer(s) in the file have no salesman (a stored salesman is kept).`,
        );
      }
      for (const [name, count] of [...unknownSalesmen].slice(0, NAME_WARNING_LIMIT)) {
        warnings.push(
          `Salesman "${name}" (${count} customer${count === 1 ? '' : 's'}) is not in Salesmen & channels. Add it, or add it as another spelling of a salesman.`,
        );
      }

      const result = await upsertB2bCustomers(client, {
        fileName: file.originalname,
        fileSha256: sha,
        rowCount: parsed.rowCount,
        customers: parsed.customers,
        uploadedBy: profileId,
      });
      const report = {
        sheet: parsed.sheetName,
        headerRow: parsed.headerRow,
        unchangedCustomers: result.unchangedCustomers,
        changeCount: result.changes.length,
        changes: result.changes.slice(0, REPORT_CHANGE_LIMIT),
        warnings,
        warningCount: warnings.length,
      };
      await saveB2bUploadReport(client, result.uploadId, report);
      await saveB2bUploadFile(client, result.uploadId, file.buffer);
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'b2b_master.uploaded',
        targetType: 'b2b_upload',
        targetId: result.uploadId,
        metadata: {
          fileName: file.originalname,
          rows: parsed.rowCount,
          customers: parsed.customers.size,
          newCustomers: result.newCustomers,
          changedCustomers: result.changedCustomers,
        },
        requestId,
      });
      return {
        id: result.uploadId,
        fileName: file.originalname,
        rowCount: parsed.rowCount,
        customerCount: parsed.customers.size,
        newCustomers: result.newCustomers,
        changedCustomers: result.changedCustomers,
        report,
      };
    });
  }

  /**
   * Download for checking and editing. By default the current customer master, built
   * in the upload's own columns (so it can be edited and uploaded again). With
   * `original`, the newest uploaded file exactly as uploaded, when the portal still
   * holds it.
   */
  async function download(
    profileId: string,
    options: { original?: boolean } = {},
    requestId: string = randomUUID(),
  ) {
    const stamp = new Date().toISOString().slice(0, 10);
    const client = await pool.connect();
    try {
      const latest = await latestB2bUploadFile(client);
      let result: { fileName: string; buffer: Buffer; source: 'original' | 'rebuilt' };
      if (latest?.bytes && options.original) {
        result = { fileName: latest.fileName, buffer: latest.bytes, source: 'original' };
      } else {
        const rows = await b2bMasterRows(client);
        if (rows.length === 0) {
          throw new B2bMasterServiceError('no-data', 'The customer master is empty.');
        }
        result = {
          fileName: `B2B_customers_${stamp}.xlsx`,
          buffer: await buildB2bMasterWorkbook(rows),
          source: 'rebuilt',
        };
      }
      await insertAuditEvent(client, {
        actorProfileId: profileId,
        action: 'b2b_master.downloaded',
        targetType: 'b2b_download',
        metadata: { source: result.source, fileName: result.fileName },
        requestId,
      });
      return result;
    } finally {
      client.release();
    }
  }

  return { upload, download, status: () => b2bStatus(pool) };
}

export type B2bMasterService = ReturnType<typeof createB2bMasterService>;

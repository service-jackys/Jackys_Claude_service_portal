import type { PoolClient } from 'pg';

export type JobCardAttachmentRecord = {
  id: string;
  jobCardId: string;
  fileName: string;
  contentType: string;
  sizeBytes: string;
  storageKey: string;
  uploadedAt: Date;
  uploadedBy: string | null;
};

const columns = `
  id,
  job_card_id AS "jobCardId",
  file_name AS "fileName",
  content_type AS "contentType",
  size_bytes AS "sizeBytes",
  storage_key AS "storageKey",
  uploaded_at AS "uploadedAt",
  uploaded_by AS "uploadedBy"
`;

export async function insertJobCardAttachment(
  client: PoolClient,
  input: {
    jobCardId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    storageKey: string;
    uploadedBy: string;
  },
): Promise<JobCardAttachmentRecord> {
  const result = await client.query<JobCardAttachmentRecord>(
    `INSERT INTO job_card_attachments
       (job_card_id, file_name, content_type, size_bytes, storage_key, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${columns}`,
    [
      input.jobCardId,
      input.fileName,
      input.contentType,
      input.sizeBytes,
      input.storageKey,
      input.uploadedBy,
    ],
  );
  return result.rows[0];
}

export async function findJobCardAttachmentById(
  client: PoolClient,
  id: string,
): Promise<JobCardAttachmentRecord | null> {
  const result = await client.query<JobCardAttachmentRecord>(
    `SELECT ${columns} FROM job_card_attachments WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listJobCardAttachments(
  client: PoolClient,
  jobCardId: string,
): Promise<JobCardAttachmentRecord[]> {
  const result = await client.query<JobCardAttachmentRecord>(
    `SELECT ${columns} FROM job_card_attachments WHERE job_card_id = $1 ORDER BY uploaded_at ASC, id ASC`,
    [jobCardId],
  );
  return result.rows;
}

export async function deleteJobCardAttachment(client: PoolClient, id: string): Promise<boolean> {
  const result = await client.query('DELETE FROM job_card_attachments WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

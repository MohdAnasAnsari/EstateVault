import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let r2Client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (r2Client) return r2Client;

  const accountId = process.env['R2_ACCOUNT_ID'];
  const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) are required');
  }

  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return r2Client;
}

function getBucket(): string {
  const bucket = process.env['R2_BUCKET'];
  if (!bucket) throw new Error('R2_BUCKET environment variable is not set');
  return bucket;
}

export async function uploadToR2(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const client = getR2Client();
  const bucket = getBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await client.send(command);
}

export async function deleteFromR2(key: string): Promise<void> {
  const client = getR2Client();
  const bucket = getBucket();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await client.send(command);
}

export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const client = getR2Client();
  const bucket = getBucket();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(client, command, { expiresIn });
}

export function buildPublicUrl(key: string): string {
  const publicUrl = process.env['R2_PUBLIC_URL'];
  if (!publicUrl) throw new Error('R2_PUBLIC_URL environment variable is not set');
  return `${publicUrl}/${key}`;
}

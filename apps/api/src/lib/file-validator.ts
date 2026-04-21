import { fileTypeFromBuffer } from 'file-type';

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const ALLOWED_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const ALLOWED_ALL = new Set([...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export interface FileValidationResult {
  valid: boolean;
  mimeType?: string;
  error?: string;
}

export async function validateFileType(
  buffer: Buffer,
  category: 'image' | 'document' | 'any' = 'any',
): Promise<FileValidationResult> {
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File exceeds maximum size of 50MB' };
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    return { valid: false, error: 'Unable to determine file type' };
  }

  const allowed =
    category === 'image'
      ? ALLOWED_IMAGE_TYPES
      : category === 'document'
        ? ALLOWED_DOCUMENT_TYPES
        : ALLOWED_ALL;

  if (!allowed.has(detected.mime)) {
    return {
      valid: false,
      error: `File type '${detected.mime}' is not allowed`,
    };
  }

  return { valid: true, mimeType: detected.mime };
}

export async function triggerClamAVScan(buffer: Buffer): Promise<{ clean: boolean; threat?: string }> {
  const host = process.env['CLAMAV_HOST'] ?? 'localhost';
  const port = Number(process.env['CLAMAV_PORT'] ?? 3310);

  try {
    const { createConnection } = await import('node:net');
    return await new Promise((resolve) => {
      const socket = createConnection({ host, port }, () => {
        socket.write('zINSTREAM\0');

        const sizeBuffer = Buffer.alloc(4);
        sizeBuffer.writeUInt32BE(buffer.length, 0);
        socket.write(sizeBuffer);
        socket.write(buffer);

        const terminator = Buffer.alloc(4);
        socket.write(terminator);
      });

      let response = '';
      socket.on('data', (data) => {
        response += data.toString();
      });

      socket.on('end', () => {
        if (response.includes('OK')) {
          resolve({ clean: true });
        } else {
          const match = response.match(/FOUND (.+)$/);
          resolve({ clean: false, threat: match?.[1] ?? 'unknown threat' });
        }
      });

      socket.on('error', () => {
        // If ClamAV is unavailable, log and allow (don't block uploads in dev)
        if (process.env['NODE_ENV'] === 'production') {
          resolve({ clean: false, threat: 'ClamAV scan service unavailable' });
        } else {
          resolve({ clean: true });
        }
      });

      socket.setTimeout(10_000, () => {
        socket.destroy();
        resolve({ clean: process.env['NODE_ENV'] !== 'production' });
      });
    });
  } catch {
    return { clean: process.env['NODE_ENV'] !== 'production' };
  }
}

import { fileTypeFromBuffer } from 'file-type';
import path from 'node:path';

export class FileValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'FileValidationError';
  }
}

/**
 * Validate that the buffer's detected MIME type is in the allowed list.
 * Uses file-type for magic-byte detection (not trusting the client-provided content-type).
 */
export async function validateFileType(
  buffer: Buffer,
  allowedTypes: string[],
): Promise<{ mimeType: string; extension: string }> {
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) {
    throw new FileValidationError(
      'Unable to detect file type. The file may be corrupt or unsupported.',
      'UNKNOWN_FILE_TYPE',
    );
  }

  if (!allowedTypes.includes(detected.mime)) {
    throw new FileValidationError(
      `File type "${detected.mime}" is not allowed. Allowed types: ${allowedTypes.join(', ')}`,
      'DISALLOWED_FILE_TYPE',
    );
  }

  return { mimeType: detected.mime, extension: detected.ext };
}

/**
 * Validate the file size does not exceed the maximum allowed MB.
 */
export function validateFileSize(sizeBytes: number, maxMb: number): void {
  const maxBytes = maxMb * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw new FileValidationError(
      `File size ${(sizeBytes / 1024 / 1024).toFixed(2)} MB exceeds the maximum allowed size of ${maxMb} MB`,
      'FILE_TOO_LARGE',
    );
  }
}

/**
 * Sanitize a filename to prevent path traversal and strip special characters.
 * Returns a safe, lowercase alphanumeric filename with hyphens.
 */
export function sanitizeFilename(name: string): string {
  // Get only the basename (strip any directory parts)
  const basename = path.basename(name);

  // Extract extension
  const ext = path.extname(basename).toLowerCase();
  const nameWithoutExt = path.basename(basename, ext);

  // Strip dangerous characters, replace spaces/underscores with hyphens
  const safe = nameWithoutExt
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 100); // cap length

  // Sanitize extension too
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);

  return safe ? `${safe}${safeExt}` : `file${safeExt}`;
}

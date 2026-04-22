import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb, listingMedia } from '@vault/db';
import { encryptFile } from '@vault/crypto';
import { uploadToR2, deleteFromR2, getPresignedUrl, buildPublicUrl } from '../lib/r2.js';
import { processListingImage, addWatermark, generateThumbnail } from '../lib/image.js';
import { validateFileType, validateFileSize, sanitizeFilename, FileValidationError } from '../lib/file-validator.js';
import { eq, asc } from 'drizzle-orm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAllowedImageTypes(): string[] {
  return (process.env['ALLOWED_IMAGE_TYPES'] ?? 'image/jpeg,image/png,image/webp').split(',');
}

function getAllowedDocumentTypes(): string[] {
  return (process.env['ALLOWED_DOCUMENT_TYPES'] ?? 'application/pdf').split(',');
}

function getMaxFileSizeMb(): number {
  return parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '50', 10);
}

function getWatermarkText(): string {
  return process.env['WATERMARK_TEXT'] ?? 'VAULT CONFIDENTIAL';
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const reorderSchema = z.object({
  order: z.array(z.object({ id: z.string().uuid(), displayOrder: z.number().int().min(0) })),
});

const coverSchema = z.object({
  mediaId: z.string().uuid(),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /media/upload
   * Upload a file (image or document) for a listing.
   * Images are resized, watermarked, and a thumbnail is generated.
   */
  fastify.post('/upload', {
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ success: false, error: { code: 'NO_FILE', message: 'No file provided' } });
    }

    const listingId = (request.query as Record<string, string>)['listingId'];
    if (!listingId) {
      return reply.code(400).send({ success: false, error: { code: 'MISSING_LISTING_ID', message: 'listingId query parameter is required' } });
    }

    try {
      const buffer = await data.toBuffer();
      const maxMb = getMaxFileSizeMb();

      validateFileSize(buffer.length, maxMb);

      const allowedTypes = [...getAllowedImageTypes(), ...getAllowedDocumentTypes()];
      const { mimeType, extension } = await validateFileType(buffer, allowedTypes);

      const sanitized = sanitizeFilename(data.filename ?? 'upload');
      const uniqueKey = `listings/${listingId}/${randomUUID()}-${sanitized.replace(/\.[^.]+$/, '')}.${extension}`;

      let uploadBuffer = buffer;
      let thumbnailUrl: string | undefined;

      if (isImageMime(mimeType)) {
        // Process and watermark
        const processed = await processListingImage(buffer);
        uploadBuffer = await addWatermark(processed, getWatermarkText());

        // Generate and upload thumbnail
        const thumb = await generateThumbnail(buffer);
        const thumbKey = `listings/${listingId}/thumbs/${randomUUID()}.webp`;
        await uploadToR2(thumbKey, thumb, 'image/webp');
        thumbnailUrl = buildPublicUrl(thumbKey);
      }

      await uploadToR2(uniqueKey, uploadBuffer, isImageMime(mimeType) ? 'image/webp' : mimeType);
      const publicUrl = buildPublicUrl(uniqueKey);

      const db = getDb();
      const mediaType = isImageMime(mimeType) ? 'photo' : 'document';

      const [record] = await db
        .insert(listingMedia)
        .values({
          listingId,
          type: mediaType as 'photo' | 'document',
          url: publicUrl,
          thumbnailUrl: thumbnailUrl ?? null,
          orderIndex: 0,
        })
        .returning();

      return reply.code(201).send({
        success: true,
        data: {
          id: record?.id,
          url: publicUrl,
          thumbnailUrl,
          mimeType: isImageMime(mimeType) ? 'image/webp' : mimeType,
          key: uniqueKey,
        },
      });
    } catch (err) {
      if (err instanceof FileValidationError) {
        return reply.code(422).send({ success: false, error: { code: err.code, message: err.message } });
      }
      request.log.error(err, 'Upload failed');
      return reply.code(500).send({ success: false, error: { code: 'UPLOAD_FAILED', message: 'File upload failed' } });
    }
  });

  /**
   * POST /media/upload-encrypted
   * Upload an encrypted file for deal room documents.
   */
  fastify.post('/upload-encrypted', {
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ success: false, error: { code: 'NO_FILE', message: 'No file provided' } });
    }

    try {
      const buffer = await data.toBuffer();
      const maxMb = getMaxFileSizeMb();

      validateFileSize(buffer.length, maxMb);

      const allowedTypes = getAllowedDocumentTypes();
      const { mimeType, extension } = await validateFileType(buffer, allowedTypes);

      // Generate an ephemeral AES-256 key and encrypt the file
      const { encryptedBuffer: encryptedArrayBuffer, key: fileKey, nonce } = await encryptFile(buffer.buffer as ArrayBuffer);

      const encryptedBuffer = Buffer.from(encryptedArrayBuffer);

      const uniqueKey = `deal-docs/${randomUUID()}.enc.${extension}`;
      await uploadToR2(uniqueKey, encryptedBuffer, 'application/octet-stream');

      const publicUrl = buildPublicUrl(uniqueKey);

      return reply.code(201).send({
        success: true,
        data: {
          url: publicUrl,
          key: uniqueKey,
          nonce,
          fileKey,
          mimeType,
          sizeBytes: buffer.length,
        },
      });
    } catch (err) {
      if (err instanceof FileValidationError) {
        return reply.code(422).send({ success: false, error: { code: err.code, message: err.message } });
      }
      request.log.error(err, 'Encrypted upload failed');
      return reply.code(500).send({ success: false, error: { code: 'UPLOAD_FAILED', message: 'Encrypted file upload failed' } });
    }
  });

  /**
   * GET /media/presigned/:key
   * Generate a presigned download URL (1-hour expiry).
   */
  fastify.get('/presigned/:key', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { key } = request.params as { key: string };

    try {
      const url = await getPresignedUrl(decodeURIComponent(key), 3600);
      return reply.send({ success: true, data: { url, expiresInSeconds: 3600 } });
    } catch (err) {
      request.log.error(err, 'Presigned URL generation failed');
      return reply.code(500).send({ success: false, error: { code: 'PRESIGN_FAILED', message: 'Failed to generate presigned URL' } });
    }
  });

  /**
   * DELETE /media/:mediaId
   * Delete a media record — owner or admin only.
   */
  fastify.delete('/:mediaId', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { mediaId } = request.params as { mediaId: string };
    const db = getDb();

    const [record] = await db
      .select()
      .from(listingMedia)
      .where(eq(listingMedia.id, mediaId))
      .limit(1);

    if (!record) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Media not found' } });
    }

    // Only admin can delete any media; others cannot delete (ownership tracked via listing)
    if (user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions to delete this media' } });
    }

    try {
      // Extract R2 key from public URL
      const publicUrlBase = process.env['R2_PUBLIC_URL'] ?? '';
      const r2Key = record.url.replace(`${publicUrlBase}/`, '');
      await deleteFromR2(r2Key);

      // Delete thumbnail if present
      if (record.thumbnailUrl) {
        const thumbKey = record.thumbnailUrl.replace(`${publicUrlBase}/`, '');
        await deleteFromR2(thumbKey).catch(() => { /* ignore if already gone */ });
      }
    } catch (err) {
      request.log.warn(err, 'R2 deletion failed; proceeding with DB removal');
    }

    await db.delete(listingMedia).where(eq(listingMedia.id, mediaId));

    return reply.send({ success: true, data: { deleted: true, id: mediaId } });
  });

  /**
   * GET /media/listing/:listingId
   * List all media for a listing, sorted by orderIndex ascending.
   */
  fastify.get('/listing/:listingId', async (request, reply) => {
    const { listingId } = request.params as { listingId: string };
    const db = getDb();

    const media = await db
      .select()
      .from(listingMedia)
      .where(eq(listingMedia.listingId, listingId))
      .orderBy(asc(listingMedia.orderIndex));

    return reply.send({ success: true, data: media });
  });

  /**
   * PATCH /media/listing/:listingId/reorder
   * Update displayOrder for listing media items.
   */
  fastify.patch('/listing/:listingId/reorder', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { listingId } = request.params as { listingId: string };
    const parsed = reorderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const db = getDb();

    // Update each media item's order index
    await Promise.all(
      parsed.data.order.map(({ id, displayOrder }) =>
        db
          .update(listingMedia)
          .set({ orderIndex: displayOrder })
          .where(eq(listingMedia.id, id)),
      ),
    );

    const updated = await db
      .select()
      .from(listingMedia)
      .where(eq(listingMedia.listingId, listingId))
      .orderBy(asc(listingMedia.orderIndex));

    return reply.send({ success: true, data: updated });
  });

  /**
   * POST /media/listing/:listingId/cover
   * Set a specific media item as the cover image (orderIndex = 0, demotes all others).
   */
  fastify.post('/listing/:listingId/cover', async (request, reply) => {
    const user = request.user as { sub: string; role: string } | undefined;
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const { listingId } = request.params as { listingId: string };
    const parsed = coverSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    }

    const { mediaId } = parsed.data;
    const db = getDb();

    // Verify the media belongs to this listing
    const [coverRecord] = await db
      .select()
      .from(listingMedia)
      .where(eq(listingMedia.id, mediaId))
      .limit(1);

    if (!coverRecord || coverRecord.listingId !== listingId) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Media not found for this listing' } });
    }

    // Get all media for the listing except the cover
    const allMedia = await db
      .select()
      .from(listingMedia)
      .where(eq(listingMedia.listingId, listingId))
      .orderBy(asc(listingMedia.orderIndex));

    // Reassign orderIndex: cover gets 0, rest get sequential
    const updates: Array<{ id: string; order: number }> = [{ id: mediaId, order: 0 }];
    let idx = 1;
    for (const m of allMedia) {
      if (m.id !== mediaId) {
        updates.push({ id: m.id, order: idx++ });
      }
    }

    await Promise.all(
      updates.map(({ id, order }) =>
        db.update(listingMedia).set({ orderIndex: order }).where(eq(listingMedia.id, id)),
      ),
    );

    return reply.send({ success: true, data: { coverId: mediaId, listingId } });
  });
};

export default mediaRoutes;

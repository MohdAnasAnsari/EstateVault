// Server-safe DOMPurify wrapper — uses isomorphic-dompurify on server, dompurify on client
let _sanitize: ((dirty: string) => string) | null = null;

async function getSanitize() {
  if (_sanitize) return _sanitize;

  if (typeof window !== 'undefined') {
    const DOMPurify = (await import('dompurify')).default;
    _sanitize = (dirty: string) =>
      DOMPurify.sanitize(dirty, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'a'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
        FORCE_BODY: false,
      });
  } else {
    const createDOMPurify = (await import('isomorphic-dompurify')).default;
    _sanitize = (dirty: string) =>
      createDOMPurify.sanitize(dirty, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'a'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
      });
  }

  return _sanitize;
}

export async function sanitizeHtml(dirty: string): Promise<string> {
  const sanitize = await getSanitize();
  return sanitize(dirty);
}

/** Synchronous version (client-only). Falls back to empty string on server. */
export function sanitizeHtmlSync(dirty: string): string {
  if (typeof window === 'undefined') return '';
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import already resolved
  const DOMPurify = (window as any).__dompurify__;
  if (!DOMPurify) return dirty;
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
  });
}

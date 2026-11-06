import { useEffect, useState } from 'react';
import type { ReaderApi } from '../../api/client.ts';

/**
 * Loads an avatar URL through the API (Authorization header) into an object URL.
 * Falls back to null when there is no avatar, no API, or the fetch fails.
 */
export function useAvatar(api: Pick<ReaderApi, 'coverBytes'> | undefined, avatarUrl: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!api || !avatarUrl) {
      setSrc(null);
      return;
    }
    let live = true;
    let objectUrl: string | null = null;
    void api.coverBytes(avatarUrl).then(bytes => {
      objectUrl = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]));
      if (live) setSrc(objectUrl);
    }).catch(() => { if (live) setSrc(null); });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, avatarUrl]);
  return src;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "../lib/utils";
import type { ImageThumbnail } from "../types";

// A single backend call decodes every path it receives at once, so the queue is
// drained one bounded chunk at a time — an unbounded batch (e.g. a fast scroll
// through a 1000-image grid) would otherwise spike memory.
const THUMB_CHUNK_SIZE = 50;

/**
 * On-demand thumbnail resolver for large grids. Instead of generating every
 * thumbnail up front, it only fetches the paths the caller
 * asks for — wire it to an IntersectionObserver so off-screen tiles never trigger
 * a decode. Newly requested paths are coalesced into one debounced backend call,
 * and the map updates as each batch returns (progressive feedback).
 *
 * Returns a map keyed by path: a `data:` URI once ready, `null` when the file
 * could not be rasterized (caller falls back to the original), or absent while
 * pending / not yet requested.
 *
 * @param resetKey changes whenever the underlying result set changes (e.g. a
 *   per-run timestamp). When it changes, the cache is dropped so a re-run that
 *   overwrites the same output path regenerates.
 */
export function useLazyThumbnails(resetKey: unknown): {
  thumbs: Map<string, string | null>;
  request: (paths: string[]) => void;
} {
  const cacheRef = useRef<Map<string, string | null>>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drainingRef = useRef(false);
  const [thumbs, setThumbs] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    cacheRef.current = new Map();
    requestedRef.current = new Set();
    queueRef.current = [];
    drainingRef.current = false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setThumbs(new Map());
  }, [resetKey]);

  useEffect(() => () => void (timerRef.current && clearTimeout(timerRef.current)), []);

  // Drain at most THUMB_CHUNK_SIZE paths per backend call; when the call
  // returns, immediately start the next chunk if more were queued meanwhile.
  // This keeps peak memory flat and the grid responsive on large libraries.
  const flush = useCallback(() => {
    timerRef.current = null;
    const batch = queueRef.current.splice(0, THUMB_CHUNK_SIZE);
    if (batch.length === 0) {
      drainingRef.current = false;
      return;
    }
    drainingRef.current = true;
    invoke<ImageThumbnail[]>("generate_image_thumbnails", { inputPaths: batch })
      .then((results) => {
        for (const r of results) {
          cacheRef.current.set(r.path, r.thumbnail_b64 ? `data:image/jpeg;base64,${r.thumbnail_b64}` : null);
        }
        setThumbs(new Map(cacheRef.current));
      })
      .catch((err) => logError("thumbnails:lazy", err))
      .finally(() => {
        if (queueRef.current.length > 0) {
          flush();
        } else {
          drainingRef.current = false;
        }
      });
  }, []);

  const request = useCallback(
    (paths: string[]) => {
      let added = false;
      for (const p of paths) {
        if (!requestedRef.current.has(p)) {
          requestedRef.current.add(p);
          queueRef.current.push(p);
          added = true;
        }
      }
      // If a drain is already running, the new paths are picked up by the next
      // chunk. Otherwise debounce a fresh cycle (coalesces a burst of observer
      // callbacks into one initial batch).
      if (added && !drainingRef.current && !timerRef.current) {
        timerRef.current = setTimeout(flush, 80);
      }
    },
    [flush],
  );

  return { thumbs, request };
}

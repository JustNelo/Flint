import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "../lib/utils";
import type { ImageThumbnail } from "../types";

/**
 * Resolve small backend-generated thumbnails for a list of image paths so the
 * grids decode a bounded-size bitmap (~256px) instead of the full-resolution
 * original. This is the core defense against the multi-GB decode memory that
 * grows with the number of selected/converted images.
 *
 * Returns a map keyed by path: a `data:` URI string once ready, `null` when the
 * file could not be rasterized (caller should fall back to the original, e.g.
 * for SVG), or absent while the thumbnail is still being generated.
 *
 * @param paths       image paths to resolve. Must be a stable reference across
 *   renders (component state or a `useMemo`) — a freshly built array every
 *   render would retrigger generation in a loop.
 * @param alwaysFresh when true, the whole set is regenerated whenever `paths`
 *   changes identity (conversion outputs: their bytes can change even when the
 *   path is reused). When false, thumbnails are cached per path and only missing
 *   ones are fetched (the input selection grid: a path's bytes never change).
 */
export function useThumbnails(paths: string[], alwaysFresh = false): Map<string, string | null> {
  const cacheRef = useRef<Map<string, string | null>>(new Map());
  const requestRef = useRef(0);
  const [thumbs, setThumbs] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    const token = ++requestRef.current;

    if (alwaysFresh) {
      cacheRef.current = new Map();
    } else {
      // Drop entries no longer selected so the cache can't grow unbounded.
      const pruned = new Map<string, string | null>();
      for (const p of paths) {
        if (cacheRef.current.has(p)) pruned.set(p, cacheRef.current.get(p) ?? null);
      }
      cacheRef.current = pruned;
    }

    const missing = paths.filter((p) => !cacheRef.current.has(p));

    // Publish whatever is already cached (pending entries stay absent).
    setThumbs(new Map(cacheRef.current));

    if (missing.length === 0) return;

    invoke<ImageThumbnail[]>("generate_image_thumbnails", { inputPaths: missing })
      .then((results) => {
        if (token !== requestRef.current) return; // a newer request superseded this one
        for (const r of results) {
          cacheRef.current.set(r.path, r.thumbnail_b64 ? `data:image/jpeg;base64,${r.thumbnail_b64}` : null);
        }
        setThumbs(new Map(cacheRef.current));
      })
      .catch((err) => {
        if (token !== requestRef.current) return;
        logError("thumbnails:generate", err);
      });
  }, [paths, alwaysFresh]);

  return thumbs;
}

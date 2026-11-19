import { Directory, File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useEffect, useMemo, useState } from "react";
import { PixelRatio, Platform } from "react-native";

/**
 * SVG art baked into PNG files, so it paints as a plain bitmap.
 *
 * expo-image keeps an SVG as vectors: Android replays a PictureDrawable on
 * every draw and iOS holds a vector UIImage. Thousands of splatter paths
 * behind a scrolling list were re-rasterized every frame that way. A bake is
 * named by its markup and pixel size, so a restart reuses the file.
 */
const BAKE_DIRECTORY = "t3-baked-svg";
/** Room for the backdrop plus a few pages of pattern thumbnails. */
const MAX_BAKED_FILES = 64;

const inFlight = new Map<string, Promise<string>>();

/**
 * Base64, never percent-encoding: expo-image's Android loader base64-decodes
 * everything after the comma whatever the URI declares, so a percent-encoded
 * SVG decodes to garbage and renders nothing. The markup is ASCII, which
 * btoa requires.
 */
const svgUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/** FNV-1a over the markup; with its length and the pixel size it names the file. */
function bakeFile(svg: string, width: number, height: number): File {
  let hash = 0x811c9dc5;
  for (let i = 0; i < svg.length; i += 1) {
    hash = Math.imul(hash ^ svg.charCodeAt(i), 0x01000193);
  }
  const name = `${(hash >>> 0).toString(36)}-${svg.length.toString(36)}-${width}x${height}.png`;
  return new File(Paths.cache, BAKE_DIRECTORY, name);
}

async function rasterize(svg: string, width: number, height: number, target: File) {
  const image = await Image.loadAsync(svgUri(svg), { maxWidth: width, maxHeight: height });
  try {
    target.parentDirectory.create({ idempotent: true, intermediates: true });
    if (Platform.OS === "android") {
      // Android loads an SVG as a PictureDrawable, which the manipulator
      // refuses; expo-image's cache write draws it into a PNG instead.
      await Image.writeToCacheAsync(image, target.name);
      const path = await Image.getCachePathAsync(target.name);
      if (path === null) throw new Error("Baked SVG is missing from the image cache");
      new File(`file://${path}`).copy(target);
    } else {
      const rendered = await ImageManipulator.manipulate(image).renderAsync();
      try {
        const saved = await rendered.saveAsync({ format: SaveFormat.PNG });
        new File(saved.uri).move(target);
      } finally {
        rendered.release();
      }
    }
  } finally {
    image.release();
  }
}

/** Drops the oldest bakes once settings changes and new days pile them up. */
function prune(directory: Directory) {
  const files = directory.list().filter((entry) => entry instanceof File);
  if (files.length <= MAX_BAKED_FILES) return;
  files
    .sort((a, b) => (a.modificationTime ?? 0) - (b.modificationTime ?? 0))
    .slice(0, files.length - MAX_BAKED_FILES)
    .forEach((file) => file.delete());
}

function bake(svg: string, width: number, height: number, target: File): Promise<string> {
  if (target.exists) return Promise.resolve(target.uri);
  let pending = inFlight.get(target.uri);
  if (!pending) {
    pending = rasterize(svg, width, height, target)
      .then(() => {
        prune(target.parentDirectory);
        return target.uri;
      })
      .finally(() => inFlight.delete(target.uri));
    inFlight.set(target.uri, pending);
  }
  return pending;
}

/**
 * A PNG file URI for `svg` drawn at `width` x `height` points, or null until
 * its first bake lands. While a changed `svg` bakes, the previous one stays.
 */
export function useBakedSvg(svg: string | null, width: number, height: number): string | null {
  const scale = PixelRatio.get();
  const pixelWidth = Math.round(width * scale);
  const pixelHeight = Math.round(height * scale);
  const target = useMemo(
    () => (svg === null ? null : bakeFile(svg, pixelWidth, pixelHeight)),
    [svg, pixelWidth, pixelHeight],
  );
  const [baked, setBaked] = useState(() => (target?.exists ? target.uri : null));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- bakes the SVG to a cached file on disk and drops the result after unmount
  useEffect(() => {
    if (svg === null || target === null) return;
    let live = true;
    bake(svg, pixelWidth, pixelHeight, target).then(
      (uri) => {
        if (live) setBaked(uri);
      },
      (error: unknown) => console.warn("[bakedSvg] failed to bake SVG", error),
    );
    return () => {
      live = false;
    };
  }, [svg, target, pixelWidth, pixelHeight]);

  return svg === null ? null : baked;
}

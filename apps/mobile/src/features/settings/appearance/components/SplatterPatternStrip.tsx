import { MAX_THEME_BACKDROP_SEED } from "@t3tools/contracts";
import {
  renderSplatterPreview,
  type SplatterRenderOptions,
} from "@t3tools/shared/splatterBackdrop";
import { Image } from "expo-image";
import { memo, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { AppText as Text } from "../../../../components/ui/AppText";
import { useBakedSvg } from "../../../../lib/bakedSvg";
import { cn } from "../../../../lib/cn";

/** Patterns added each time the strip is scrolled to its end. */
const PAGE = 24;
/** A phone canvas's shape, laid out the way the thread screen paints it. */
const [SCENE_WIDTH, SCENE_HEIGHT] = [390, 780];
const [THUMB_WIDTH, THUMB_HEIGHT] = [84, 168];
/** Shrunk to a thumbnail, paint tuned to sit behind text fades to nothing;
 *  stronger paint keeps each pattern's shape readable. */
const PREVIEW_INTENSITY_BOOST = 4;

type PreviewOptions = Omit<SplatterRenderOptions, "seed">;

/**
 * A horizontally scrolling strip of pattern thumbnails in the current paint.
 * FlatList windowing keeps only the thumbnails near the viewport rendered,
 * and more patterns load as the strip reaches its end.
 */
export function SplatterPatternStrip(props: {
  readonly options: PreviewOptions;
  readonly selectedSeed: number;
  readonly onSelect: (seed: number) => void;
  readonly disabled?: boolean;
}) {
  const [count, setCount] = useState(PAGE);
  // A shuffled seed is far past the strip, so it leads it until the next visit.
  const [pinned] = useState(props.selectedSeed >= PAGE ? props.selectedSeed : null);
  const seeds = useMemo(() => {
    const list = Array.from({ length: count }, (_, seed) => seed);
    if (pinned !== null) list.unshift(pinned);
    return list;
  }, [count, pinned]);

  return (
    <FlatList
      horizontal
      data={seeds}
      keyExtractor={(seed) => String(seed)}
      extraData={props}
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-4 py-2"
      initialNumToRender={5}
      windowSize={5}
      onEndReachedThreshold={1}
      onEndReached={() =>
        setCount((current) => Math.min(MAX_THEME_BACKDROP_SEED + 1, current + PAGE))
      }
      renderItem={({ item: seed }) => (
        <PatternThumbnail
          seed={seed}
          options={props.options}
          selected={seed === props.selectedSeed}
          disabled={props.disabled}
          onSelect={props.onSelect}
        />
      )}
    />
  );
}

const PatternThumbnail = memo(function PatternThumbnail(props: {
  readonly seed: number;
  readonly options: PreviewOptions;
  readonly selected: boolean;
  readonly disabled: boolean | undefined;
  readonly onSelect: (seed: number) => void;
}) {
  const { seed, options } = props;
  const [lead, second, third] = options.colors;
  const svg = useMemo(
    () =>
      renderSplatterPreview(
        {
          colors: [lead, second, third],
          appearance: options.appearance,
          intensity: options.intensity * PREVIEW_INTENSITY_BOOST,
          glow: options.glow,
          amount: options.amount,
          seed,
        },
        SCENE_WIDTH,
        SCENE_HEIGHT,
        { compact: true },
      ),
    [
      seed,
      lead,
      second,
      third,
      options.appearance,
      options.intensity,
      options.glow,
      options.amount,
    ],
  );
  // The scene and the thumbnail share an aspect, so it bakes at thumbnail size.
  const uri = useBakedSvg(svg, THUMB_WIDTH, THUMB_HEIGHT);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected, disabled: props.disabled }}
      accessibilityLabel={seed === 0 ? "Original splatter pattern" : `Splatter pattern ${seed}`}
      disabled={props.disabled}
      onPress={() => props.onSelect(seed)}
      className={cn(
        "overflow-hidden rounded-xl border-2 bg-screen",
        props.selected ? "border-primary" : "border-border",
      )}
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
    >
      {uri === null ? null : (
        <Image source={{ uri }} cachePolicy="memory" style={{ flex: 1 }} contentFit="cover" />
      )}
      <View className="absolute bottom-1 left-1 rounded bg-screen/80 px-1">
        <Text className="text-[10px] text-foreground-muted">
          {seed === 0 ? "Original" : `#${seed}`}
        </Text>
      </View>
    </Pressable>
  );
});

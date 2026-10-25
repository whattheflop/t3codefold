const FULL_SCREEN_MAX_CONTENT_WIDTH = 720;

export interface PendingUserInputFullScreenLayout {
  readonly contentMaxWidth: number;
  readonly horizontalPadding: number;
}

/**
 * Measure for the full-screen questionnaire. Wide viewports (an unfolded
 * foldable, a tablet) spend the extra width on margin instead of line length,
 * so a long question still reads as a column rather than edge to edge.
 */
export function derivePendingUserInputFullScreenLayout(input: {
  readonly windowWidth: number;
}): PendingUserInputFullScreenLayout {
  const horizontalPadding = input.windowWidth >= 840 ? 32 : input.windowWidth >= 600 ? 24 : 16;
  return {
    horizontalPadding,
    contentMaxWidth: Math.min(
      FULL_SCREEN_MAX_CONTENT_WIDTH,
      Math.max(0, input.windowWidth - horizontalPadding * 2),
    ),
  };
}

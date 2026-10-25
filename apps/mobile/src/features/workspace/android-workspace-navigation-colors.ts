import {
  flattenThemeColor,
  themeColorWithAlpha,
  themeColorWithContrast,
  type MobileThemeVariables,
} from "../../lib/mobileTheme";

/** The bottom navigation bar keeps a visible tonal selection against its actual surface. */
export function androidWorkspaceNavigationColors(colors: MobileThemeVariables) {
  const header = flattenThemeColor(colors["--color-header"], colors["--color-screen"]);
  const containerColor = flattenThemeColor(
    themeColorWithAlpha(colors["--color-header-foreground"], 0.05),
    header,
  );
  const indicatorColor = themeColorWithContrast(
    flattenThemeColor(colors["--color-secondary"], containerColor),
    containerColor,
    1.5,
  );
  return {
    containerColor,
    indicatorColor,
    selectedColor: themeColorWithContrast(
      flattenThemeColor(colors["--color-secondary-foreground"], indicatorColor),
      [indicatorColor, containerColor],
    ),
    unselectedColor: flattenThemeColor(colors["--color-header-foreground"], containerColor),
  };
}

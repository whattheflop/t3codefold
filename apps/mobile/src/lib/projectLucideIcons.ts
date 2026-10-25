/**
 * The Lucide names mobile draws, a curated set rather than the whole library so the
 * Hermes bundle carries only these glyphs. ProjectLucideGlyph maps each to an icon.
 */
export const MOBILE_LUCIDE_ICON_NAMES = [
  "alarm-clock",
  "book",
  "book-open",
  "bot",
  "box",
  "braces",
  "brain",
  "bug",
  "chart-bar",
  "circuit-board",
  "cloud",
  "cloud-cog",
  "code",
  "code-2",
  "code-xml",
  "cpu",
  "database",
  "file-text",
  "flask-conical",
  "folder",
  "folder-code",
  "gamepad-2",
  "git-branch",
  "globe",
  "globe-2",
  "heart",
  "house",
  "image",
  "layers",
  "layers-3",
  "lock",
  "mail",
  "map",
  "monitor",
  "music",
  "package",
  "palette",
  "rocket",
  "server",
  "settings",
  "shield-check",
  "shopping-bag",
  "smartphone",
  "sparkles",
  "star",
  "terminal",
  "users",
  "video",
  "wrench",
  "zap",
] as const;

export type MobileLucideIconName = (typeof MOBILE_LUCIDE_ICON_NAMES)[number];

const MOBILE_LUCIDE_ICON_NAME_SET: ReadonlySet<string> = new Set(MOBILE_LUCIDE_ICON_NAMES);

export function isMobileLucideIconName(name: string): name is MobileLucideIconName {
  return MOBILE_LUCIDE_ICON_NAME_SET.has(name);
}

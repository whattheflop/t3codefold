import type { SettingsSearchItem } from "./settingsSearch";

/** Settings search entries for Fold's rows (see FoldSettingsRows). */
export const FOLD_SETTINGS_SEARCH_ITEMS = [
  {
    id: "gaming-hud",
    title: "Gaming HUD",
    to: "/settings/general",
    desktopOnly: true,
    searchTerms: ["game overlay running agents attention always on top"],
  },
  {
    id: "gaming-hud-corner",
    title: "HUD corner",
    to: "/settings/general",
    desktopOnly: true,
    searchTerms: ["gaming game overlay position screen"],
  },
  {
    id: "theme-backdrop",
    title: "Splatter backdrop",
    to: "/settings/appearance",
    searchTerms: ["splat paint neon background texture grain cyberpunk codex theme artwork"],
  },
  {
    id: "theme-backdrop-colors",
    title: "Splatter colors",
    to: "/settings/appearance",
    searchTerms: ["splat splatter colours custom paint match theme"],
  },
  {
    id: "theme-backdrop-intensity",
    title: "Splatter intensity",
    to: "/settings/appearance",
    searchTerms: ["splat splatter strength opacity subtle bold"],
  },
  {
    id: "theme-backdrop-amount",
    title: "Splatter amount",
    to: "/settings/appearance",
    searchTerms: ["splat splatter density more less spray grain specks busy"],
  },
  {
    id: "theme-backdrop-seed",
    title: "Splatter pattern",
    to: "/settings/appearance",
    searchTerms: ["splat splatter seed shuffle random pattern layout"],
  },
  {
    id: "theme-backdrop-glow",
    title: "Neon glow",
    to: "/settings/appearance",
    searchTerms: ["splat splatter glow glowing neon bloom"],
  },
  {
    id: "theme-backdrop-dynamic",
    title: "Dynamic splatter",
    to: "/settings/appearance",
    searchTerms: ["splat splatter dynamic merged merge pull request pr daily"],
  },
  {
    id: "thread-wrap",
    title: "Thread wrapping",
    to: "/settings/appearance",
    searchTerms: [
      "columns portal portals connected continuous newspaper paper multi column 4k tv ultrawide large screen wrap",
    ],
  },
  {
    id: "cite-selection",
    title: "Show Cite on text selection",
    to: "/settings/general",
    searchTerms: ["citation quote bubble popup highlight assistant text selection"],
  },
  {
    id: "vim-thread-preview",
    title: "Preview threads while navigating",
    to: "/settings/general",
    searchTerms: ["vim sidebar j k cycle selection preview open"],
  },
  {
    id: "vim-keyboard-mode",
    title: "Vim keyboard mode",
    to: "/settings/general",
    searchTerms: ["vim vimium zed keyboard modal navigation normal insert visual hjkl"],
  },
  {
    id: "live-voice",
    title: "Live voice",
    to: "/settings/general",
    searchTerms: ["codex realtime voice call speaking microphone speaker audio"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

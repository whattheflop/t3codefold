import { msg } from "gt-react";
import type { SettingsSearchItem } from "./settingsSearch";

/** Settings search entries for Fold's rows (see FoldSettingsRows). */
export const FOLD_SETTINGS_SEARCH_ITEMS = [
  {
    id: "glados",
    title: msg("GLaDOS"),
    to: "/settings/glados",
    scope: "environment",
    searchTerms: ["Linear task sources", "coordinator", "brief", "pitboss"],
  },
  {
    id: "gaming-hud",
    title: msg("Gaming HUD"),
    to: "/settings/general",
    desktopOnly: true,
    searchTerms: ["game overlay running agents attention always on top"],
  },
  {
    id: "gaming-hud-corner",
    title: msg("HUD corner"),
    to: "/settings/general",
    desktopOnly: true,
    searchTerms: ["gaming game overlay position screen"],
  },
  {
    id: "theme-backdrop",
    title: msg("Splatter backdrop"),
    to: "/settings/appearance",
    searchTerms: ["splat paint neon background texture grain cyberpunk codex theme artwork"],
  },
  {
    id: "theme-backdrop-colors",
    title: msg("Splatter colors"),
    to: "/settings/appearance",
    searchTerms: ["splat splatter colours custom paint match theme"],
  },
  {
    id: "theme-backdrop-intensity",
    title: msg("Splatter intensity"),
    to: "/settings/appearance",
    searchTerms: ["splat splatter strength opacity subtle bold"],
  },
  {
    id: "theme-backdrop-amount",
    title: msg("Splatter amount"),
    to: "/settings/appearance",
    searchTerms: ["splat splatter density more less spray grain specks busy"],
  },
  {
    id: "theme-backdrop-seed",
    title: msg("Splatter pattern"),
    to: "/settings/appearance",
    searchTerms: ["splat splatter seed shuffle random pattern layout"],
  },
  {
    id: "theme-backdrop-glow",
    title: msg("Neon glow"),
    to: "/settings/appearance",
    searchTerms: ["splat splatter glow glowing neon bloom"],
  },
  {
    id: "theme-backdrop-dynamic",
    title: msg("Dynamic splatter"),
    to: "/settings/appearance",
    searchTerms: ["splat splatter dynamic merged merge pull request pr daily"],
  },
  {
    id: "thread-wrap",
    title: msg("Thread wrapping"),
    to: "/settings/appearance",
    searchTerms: [
      "columns portal portals connected continuous newspaper paper multi column 4k tv ultrawide large screen wrap",
    ],
  },
  {
    id: "cite-selection",
    title: msg("Show Cite on text selection"),
    to: "/settings/general",
    searchTerms: ["citation quote bubble popup highlight assistant text selection"],
  },
  {
    id: "vim-thread-preview",
    title: msg("Preview threads while navigating"),
    to: "/settings/general",
    searchTerms: ["vim sidebar j k cycle selection preview open"],
  },
  {
    id: "vim-keyboard-mode",
    title: msg("Vim keyboard mode"),
    to: "/settings/general",
    searchTerms: ["vim vimium zed keyboard modal navigation normal insert visual hjkl"],
  },
  {
    id: "live-voice",
    title: msg("Live voice"),
    to: "/settings/general",
    searchTerms: ["codex realtime voice call speaking microphone speaker audio"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

import type { Icon } from "@tabler/icons-react-native/types";
import IconAlarm from "@tabler/icons-react-native/IconAlarm";
import IconBolt from "@tabler/icons-react-native/IconBolt";
import IconBook from "@tabler/icons-react-native/IconBook";
import IconBook2 from "@tabler/icons-react-native/IconBook2";
import IconBox from "@tabler/icons-react-native/IconBox";
import IconBraces from "@tabler/icons-react-native/IconBraces";
import IconBrain from "@tabler/icons-react-native/IconBrain";
import IconBug from "@tabler/icons-react-native/IconBug";
import IconChartBar from "@tabler/icons-react-native/IconChartBar";
import IconCloud from "@tabler/icons-react-native/IconCloud";
import IconCloudCog from "@tabler/icons-react-native/IconCloudCog";
import IconCode from "@tabler/icons-react-native/IconCode";
import IconCpu from "@tabler/icons-react-native/IconCpu";
import IconDatabase from "@tabler/icons-react-native/IconDatabase";
import IconDeviceDesktop from "@tabler/icons-react-native/IconDeviceDesktop";
import IconDeviceGamepad2 from "@tabler/icons-react-native/IconDeviceGamepad2";
import IconDeviceMobile from "@tabler/icons-react-native/IconDeviceMobile";
import IconFileText from "@tabler/icons-react-native/IconFileText";
import IconFlask from "@tabler/icons-react-native/IconFlask";
import IconFolder from "@tabler/icons-react-native/IconFolder";
import IconFolderCode from "@tabler/icons-react-native/IconFolderCode";
import IconGitBranch from "@tabler/icons-react-native/IconGitBranch";
import IconHeart from "@tabler/icons-react-native/IconHeart";
import IconHome from "@tabler/icons-react-native/IconHome";
import IconLock from "@tabler/icons-react-native/IconLock";
import IconMail from "@tabler/icons-react-native/IconMail";
import IconMap from "@tabler/icons-react-native/IconMap";
import IconMusic from "@tabler/icons-react-native/IconMusic";
import IconPackage from "@tabler/icons-react-native/IconPackage";
import IconPalette from "@tabler/icons-react-native/IconPalette";
import IconPhoto from "@tabler/icons-react-native/IconPhoto";
import IconRobot from "@tabler/icons-react-native/IconRobot";
import IconRocket from "@tabler/icons-react-native/IconRocket";
import IconServer from "@tabler/icons-react-native/IconServer";
import IconSettings from "@tabler/icons-react-native/IconSettings";
import IconShieldCheck from "@tabler/icons-react-native/IconShieldCheck";
import IconShoppingBag from "@tabler/icons-react-native/IconShoppingBag";
import IconSparkles from "@tabler/icons-react-native/IconSparkles";
import IconStack2 from "@tabler/icons-react-native/IconStack2";
import IconStar from "@tabler/icons-react-native/IconStar";
import IconTerminal2 from "@tabler/icons-react-native/IconTerminal2";
import IconTool from "@tabler/icons-react-native/IconTool";
import IconUsers from "@tabler/icons-react-native/IconUsers";
import IconVideo from "@tabler/icons-react-native/IconVideo";
import IconWorld from "@tabler/icons-react-native/IconWorld";
import type { ProjectIconColor } from "@t3tools/contracts";
import { View } from "react-native";

import type { MobileLucideIconName } from "../lib/projectLucideIcons";

/**
 * Lucide project icons drawn with their closest bundled Tabler glyph. Each icon is a
 * per-file import, so only these glyphs reach the Hermes bundle.
 */
const LUCIDE_GLYPHS: Record<MobileLucideIconName, Icon> = {
  "alarm-clock": IconAlarm,
  book: IconBook2,
  "book-open": IconBook,
  bot: IconRobot,
  box: IconBox,
  braces: IconBraces,
  brain: IconBrain,
  bug: IconBug,
  "chart-bar": IconChartBar,
  "circuit-board": IconCpu,
  cloud: IconCloud,
  "cloud-cog": IconCloudCog,
  code: IconCode,
  "code-2": IconCode,
  "code-xml": IconCode,
  cpu: IconCpu,
  database: IconDatabase,
  "file-text": IconFileText,
  "flask-conical": IconFlask,
  folder: IconFolder,
  "folder-code": IconFolderCode,
  "gamepad-2": IconDeviceGamepad2,
  "git-branch": IconGitBranch,
  globe: IconWorld,
  "globe-2": IconWorld,
  heart: IconHeart,
  house: IconHome,
  image: IconPhoto,
  layers: IconStack2,
  "layers-3": IconStack2,
  lock: IconLock,
  mail: IconMail,
  map: IconMap,
  monitor: IconDeviceDesktop,
  music: IconMusic,
  package: IconPackage,
  palette: IconPalette,
  rocket: IconRocket,
  server: IconServer,
  settings: IconSettings,
  "shield-check": IconShieldCheck,
  "shopping-bag": IconShoppingBag,
  smartphone: IconDeviceMobile,
  sparkles: IconSparkles,
  star: IconStar,
  terminal: IconTerminal2,
  users: IconUsers,
  video: IconVideo,
  wrench: IconTool,
  zap: IconBolt,
};

// Tailwind's 500 shades, the same tone the monogram glyph uses in both appearances.
const GLYPH_COLORS: Record<ProjectIconColor, string> = {
  gray: "#6b7280",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
};

export function ProjectLucideGlyph(props: {
  readonly name: MobileLucideIconName;
  readonly color: ProjectIconColor;
  readonly size: number;
}) {
  const Glyph = LUCIDE_GLYPHS[props.name];
  return (
    <View
      style={{
        width: props.size,
        height: props.size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Glyph size={props.size * 0.85} color={GLYPH_COLORS[props.color]} />
    </View>
  );
}

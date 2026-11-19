import { ScrollView, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { AppText } from "../../components/ui/AppText";
import { ControllerPressable } from "./ControllerPressable";

const controls = [
  ["RT / R2", "Reply input", "#ff91c8"],
  ["LT / L2", "Conversation", "#75e5e0"],
  ["LB / RB", "Previous / next thread", "#d0c7f5"],
  ["X / □", "Dictate / finish", "#83baff"],
  ["A / ×", "Activate / edit text", "#a0e1b4"],
  ["B / ○", "Cancel / back", "#ffaaa0"],
  ["Y / △", "Reply actions", "#f6d389"],
  ["UP / DOWN", "Read / move locally", "#d0c7f5"],
  ["LEFT / RIGHT", "Switch visible panes", "#d0c7f5"],
  ["RS", "Scroll", "#d0c7f5"],
  ["START", "Open commands", "#d0c7f5"],
  ["VIEW / SELECT", "Toggle this guide", "#75e5e0"],
] as const;

export function ControllerGuide({ onClose }: { readonly onClose: () => void }) {
  return (
    <View className="flex-1 items-center justify-center bg-[#070912]/90 px-5 py-10">
      <View className="max-h-full w-full max-w-[520px] overflow-hidden rounded-[28px] border border-[#67547e] bg-[#151323]">
        <View className="overflow-hidden border-b border-[#42334e] bg-[#251a38] px-5 pb-5 pt-6">
          <View pointerEvents="none" className="absolute right-0 top-0 opacity-80">
            <Svg width={170} height={166} viewBox="0 0 170 166">
              <Defs>
                <LinearGradient id="guide-sunset" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#ffc295" />
                  <Stop offset="1" stopColor="#f46bb3" />
                </LinearGradient>
              </Defs>
              <Circle cx="111" cy="65" r="47" fill="url(#guide-sunset)" />
              {[77, 87, 98, 111].map((y) => (
                <Rect key={y} x="56" y={y} width="110" height="4" fill="#251a38" />
              ))}
              <Path d="M133 166 Q123 112 130 61 L134 61 Q131 116 144 166Z" fill="#100f20" />
              <Path
                d="M132 64 Q105 28 81 49 Q108 43 132 64 Q125 18 109 17 Q120 39 132 64 Q147 24 166 32 Q144 43 132 64 Q166 37 170 63 Q150 53 132 64 Q167 65 164 87 Q150 70 132 64 Q105 61 98 85 Q100 64 132 64Z"
                fill="#100f20"
              />
            </Svg>
          </View>
          <AppText className="mb-3 text-[10px] font-t3-bold tracking-[3px] text-[#75e5e0]">
            FOLD / CONTROLLER GUIDE
          </AppText>
          <AppText className="text-[36px] font-t3-bold italic leading-[36px] tracking-[-1px] text-[#fff1e6]">
            STAY IN{"\n"}CONTROL.
          </AppText>
        </View>
        <ScrollView
          nativeID="t3-controller-region:content:controller-help"
          className="shrink"
          contentContainerStyle={{ padding: 16, gap: 14 }}
        >
          <View className="rounded-2xl border border-[#65415f] bg-[#332035] px-3.5 py-3">
            <AppText className="mb-1 text-[10px] font-t3-bold tracking-[2px] text-[#ff91c8]">
              THE QUICK REPLY
            </AppText>
            <AppText className="text-[16px] font-t3-bold text-[#fff1e6]">
              RT → X → Speak → X → Review
            </AppText>
            <AppText className="mt-1 text-[11px] text-[#dbbfd5]">
              Finish dictation, then review. Sending is always a separate action.
            </AppText>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {controls.map(([button, action, color]) => (
              <View
                key={button}
                className="min-w-0 grow rounded-xl border border-[#353047] bg-[#201c30] px-3 py-2.5"
                style={{ flexBasis: "46%" }}
              >
                <AppText
                  className="mb-1 text-[11px] font-t3-bold tracking-[0.5px]"
                  style={{ color }}
                >
                  {button}
                </AppText>
                <AppText className="text-[12px] text-[#f0e5f4]">{action}</AppText>
              </View>
            ))}
          </View>
          <AppText className="text-[11px] leading-4 text-[#bdb0ce]">
            Up/Down scrolls the chat. A selects a visible inline action; B returns to reading. In
            forms and toolbars, arrows move between controls. B cancels recording or leaves editing
            before closing a tool. Y selects reply actions; A activates. The left stick follows the
            D-pad.
          </AppText>
        </ScrollView>
        <View className="border-t border-[#353047] px-4 py-3">
          <ControllerPressable
            onActivate={onClose}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close controller guide"
            className="flex-row items-center justify-between rounded-xl bg-[#75e5e0] px-4 py-3"
          >
            <AppText className="text-[13px] font-t3-bold tracking-[1px] text-[#142c32]">
              BACK TO IT
            </AppText>
            <AppText className="text-[10px] font-t3-bold text-[#142c32]">B / VIEW</AppText>
          </ControllerPressable>
        </View>
      </View>
    </View>
  );
}

import { useId } from "react";
import Svg, { Defs, LinearGradient, Path, Stop, Text, TSpan } from "react-native-svg";

/** A compact wordmark with enough contrast to read on either header surface. */
export function FoldBrandLogo() {
  const id = useId();
  const silver = `${id}-silver`;
  const red = `${id}-red`;
  const lettering = {
    x: 44,
    y: 40,
    fontFamily: "sans-serif-condensed",
    fontSize: 36,
    fontWeight: "900",
    fontStyle: "italic" as const,
    letterSpacing: -1.2,
    textLength: 246,
    lengthAdjust: "spacingAndGlyphs" as const,
  };

  return (
    <Svg width="100%" height="100%" viewBox="0 0 300 56" accessible={false}>
      <Defs>
        <LinearGradient id={silver} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="0.46" stopColor="#f1f3f7" />
          <Stop offset="0.5" stopColor="#a3aab8" />
          <Stop offset="1" stopColor="#e4e7ee" />
        </LinearGradient>
        <LinearGradient id={red} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ff8a80" />
          <Stop offset="0.45" stopColor="#ff3b42" />
          <Stop offset="1" stopColor="#bb1028" />
        </LinearGradient>
      </Defs>
      <Path
        d="M12 8H40L34 20H22L18 27H31L25 39H14L7 49H0L8 29H2Z"
        fill="#111318"
        stroke="#111318"
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <Path d="M12 8H40L34 20H22L18 27H31L25 39H14L7 49H0L8 29H2Z" fill={`url(#${red})`} />
      <Path d="M12 8H40L37 13H16L9 27H4Z" fill="#ffb1a6" />
      <Text {...lettering} y={42} fill="#111318" stroke="#111318" strokeWidth={4}>
        t3codeFold
      </Text>
      <Text {...lettering} fill={`url(#${silver})`}>
        t3code<TSpan fill={`url(#${red})`}>Fold</TSpan>
      </Text>
      <Path d="M45 47H284L282 50H44Z" fill="#e3233b" />
    </Svg>
  );
}

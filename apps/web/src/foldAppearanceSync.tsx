import { useEffect } from "react";

import { useClientSettings } from "./hooks/useSettings";
import { ThemeBackdropSync } from "./themeBackdrop";

/** Fold's document-level appearance: the splatter backdrop and thread wrapping. */
export function FoldAppearanceSync() {
  // The column limit doubles as the on switch; CSS decides whether there is room.
  const threadWrapColumns = useClientSettings((settings) =>
    settings.threadWrapEnabled ? settings.threadWrapMaxColumns : null,
  );
  const threadWrapPortalsEnabled = useClientSettings(
    (settings) => settings.threadWrapPortalsEnabled,
  );
  useEffect(() => {
    document.documentElement.dataset.threadWrapPortals = threadWrapPortalsEnabled ? "on" : "off";
  }, [threadWrapPortalsEnabled]);
  useEffect(() => {
    if (threadWrapColumns === null) {
      delete document.documentElement.dataset.threadWrap;
    } else {
      document.documentElement.dataset.threadWrap = String(threadWrapColumns);
    }
  }, [threadWrapColumns]);

  return <ThemeBackdropSync />;
}

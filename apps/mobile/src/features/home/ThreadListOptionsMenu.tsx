import type { MenuAction } from "@react-native-menu/menu";
import type { ComponentProps } from "react";
import { View } from "react-native";

import { AndroidAnchoredMenu } from "../../components/ui/AndroidAnchoredMenu";
import { AndroidHeaderIconButton } from "../../components/ui/AndroidScreenHeader";

/**
 * Fold's Android thread-list overflow menu: thread filters and Settings. A dot marks
 * active filters. Pull requests live in upstream's workspace navigation.
 */
export function ThreadListOptionsMenu(props: {
  readonly hasConnections: boolean;
  readonly filterActions: MenuAction[];
  readonly filterCustomized: boolean;
  readonly onFilterAction: NonNullable<ComponentProps<typeof AndroidAnchoredMenu>["onPressAction"]>;
  readonly onOpenSettings: () => void;
}) {
  return (
    <AndroidAnchoredMenu
      title="Thread options"
      actions={[
        ...(props.hasConnections
          ? [
              {
                id: "thread-filters",
                title: "Filter threads",
                subactions: props.filterActions,
              },
            ]
          : []),
        { id: "settings", title: "Settings" },
      ]}
      onPressAction={(event) => {
        if (event.nativeEvent.event === "settings") props.onOpenSettings();
        else props.onFilterAction(event);
      }}
    >
      {(open) => (
        <View>
          <AndroidHeaderIconButton
            accessibilityLabel={
              props.filterCustomized ? "Thread options, filters active" : "Thread options"
            }
            icon="ellipsis"
            onPress={open}
          />
          {props.filterCustomized ? (
            <View
              pointerEvents="none"
              className="absolute right-2 top-2 size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </View>
      )}
    </AndroidAnchoredMenu>
  );
}

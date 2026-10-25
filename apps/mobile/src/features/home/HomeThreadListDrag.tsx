import { cloneElement, type ComponentProps, type ReactElement } from "react";
import { GestureDetector, type useNativeGesture } from "react-native-gesture-handler";

import { ThreadListDragSurface, type ThreadListDragListProps } from "../threads/thread-list-drag";

/**
 * Fold's press-and-drag thread moves for Home. Wraps the list element in place of the
 * scroll GestureDetector, so HomeScreen's list keeps upstream's shape: the surface's
 * per-drag list props (held-row recycling, scroll lock) are spread onto the child.
 */
export function HomeThreadListDrag(
  props: Omit<ComponentProps<typeof ThreadListDragSurface>, "children"> & {
    readonly gesture: ReturnType<typeof useNativeGesture>;
    readonly children: ReactElement<Partial<ThreadListDragListProps>>;
  },
) {
  const { gesture, children, ...surfaceProps } = props;
  return (
    <ThreadListDragSurface {...surfaceProps}>
      {(dragListProps) => (
        <GestureDetector gesture={gesture}>{cloneElement(children, dragListProps)}</GestureDetector>
      )}
    </ThreadListDragSurface>
  );
}

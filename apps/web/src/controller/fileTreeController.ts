import type { FileTree, FileTreeDirectoryHandle, FileTreeItemHandle } from "@pierre/trees";
import type { KeyboardEvent } from "react";

function isDirectory(item: FileTreeItemHandle): item is FileTreeDirectoryHandle {
  return item.isDirectory();
}

export function controllerFileTreeProps(model: FileTree) {
  return {
    "data-controller-tree": "",
    tabIndex: -1,
    onKeyDownCapture(event: KeyboardEvent<HTMLElement>) {
      if (event.nativeEvent.composedPath()[0] !== event.currentTarget) return;
      const item = model.getFocusedItem();
      if (!item) {
        model.focusFirstItem();
        return;
      }
      if (event.key === "ArrowDown") model.focusNextItem();
      else if (event.key === "ArrowUp") model.focusPreviousItem();
      else if (event.key === "ArrowLeft") {
        if (isDirectory(item) && item.isExpanded()) item.collapse();
        else model.focusParentItem();
      } else if (event.key === "ArrowRight") {
        if (isDirectory(item) && !item.isExpanded()) item.expand();
        else model.focusNextItem();
      } else if (event.key === "Enter") {
        if (isDirectory(item)) item.toggle();
        else item.select();
      } else return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

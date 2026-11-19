import { observeResize } from "~/lib/observeResize";
import { T, useGT } from "gt-react";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";

/** A focused work view; resizing its list never re-renders the conversation. */
export function WorkInspector({
  open,
  onOpenChange,
  onReturnToChat,
  scrollRef,
  header,
  list,
  selected,
  boardMode = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturnToChat: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  header: ReactNode;
  list?: ReactNode;
  selected: boolean;
  boardMode?: boolean;
  children: ReactNode;
}) {
  const gt = useGT();
  const ref = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const maxWidth = Math.max(320, Math.min(520, availableWidth ? availableWidth - 440 : 520));
  const { width, handlers, setWidth } = useResizableWidth({
    storageKey: "t3code:glados-work-width",
    defaultWidth: 360,
    minWidth: 320,
    maxWidth,
    edge: "right",
  });
  const wide = !!list && availableWidth >= 840;
  const showDetail = !list || selected || (!boardMode && wide);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Observe the mounted inspector to switch between stacked and split layouts.
  useLayoutEffect(() => {
    const surface = ref.current;
    if (!open || !surface) return;
    const measure = () => setAvailableWidth(surface.clientWidth);
    measure();
    return observeResize(surface, measure);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        keepMounted
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1600px] flex-col overflow-hidden"
        finalFocus={() => {
          onReturnToChat();
          return false;
        }}
      >
        <DialogTitle className="sr-only">
          <T>GLaDOS work</T>
        </DialogTitle>
        <DialogDescription className="sr-only">
          <T>Explore outcomes and their evidence. Return to chat to describe new work.</T>
        </DialogDescription>
        {header}
        <div
          ref={ref}
          className="relative flex min-h-0 flex-1"
          aria-label={gt("GLaDOS work inspector")}
        >
          {list && (
            <div
              aria-label={gt("Work list")}
              className={`${!wide && selected ? "hidden" : "block"} min-h-0 ${boardMode ? "min-w-0 flex-1 overflow-hidden" : "shrink-0 overflow-y-auto overscroll-contain p-4"} ${wide && showDetail ? "border-r border-border" : "w-full"}`}
              style={wide && !boardMode ? { width } : undefined}
            >
              {list}
            </div>
          )}
          {wide && !boardMode && (
            <div
              role="separator"
              tabIndex={0}
              aria-label={gt("Resize work list")}
              aria-orientation="vertical"
              aria-valuemin={320}
              aria-valuemax={maxWidth}
              aria-valuenow={Math.round(width)}
              aria-valuetext={`${Math.round(width)} pixels`}
              style={{ left: width - 4 }}
              className="absolute inset-y-0 z-10 w-2 touch-none cursor-col-resize hover:bg-primary/20 focus-visible:bg-primary/20 focus-visible:outline-2 focus-visible:outline-primary"
              {...handlers}
              onDoubleClick={() => setWidth(360)}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 64 : 16;
                const next =
                  event.key === "ArrowRight"
                    ? width + step
                    : event.key === "ArrowLeft"
                      ? width - step
                      : event.key === "Home"
                        ? 320
                        : event.key === "End"
                          ? maxWidth
                          : undefined;
                if (next === undefined) return;
                event.preventDefault();
                setWidth(next);
              }}
            />
          )}
          <div
            ref={scrollRef}
            aria-label={gt("Outcome details")}
            className={`${showDetail ? "block" : "hidden"} min-h-0 min-w-0 overflow-y-auto overscroll-contain p-5 sm:p-7 ${boardMode && wide ? "w-[420px] shrink-0" : "flex-1"}`}
          >
            {children}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

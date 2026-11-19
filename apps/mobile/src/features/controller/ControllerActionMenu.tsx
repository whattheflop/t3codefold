import { useGT } from "gt-react-native";
import type { MenuAction } from "@react-native-menu/menu";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";

export function ControllerActionMenu(props: {
  readonly title: string;
  readonly actions: readonly MenuAction[];
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const [path, setPath] = useState<readonly MenuAction[]>([]);
  const parent = path.at(-1);
  const back = () => {
    if (path.length) setPath((current) => current.slice(0, -1));
    else props.onClose();
  };
  return (
    <Sheet title={parent?.title ?? props.title} onClose={props.onClose} onControllerBack={back}>
      <ScreenScrollView contentContainerClassName="gap-2 p-4">
        {parent ? <Button label={gt("Back")} onPress={back} /> : null}
        {(parent?.subactions ?? props.actions)
          .filter((action) => !action.attributes?.hidden)
          .map((action) => (
            <Button
              key={action.id ?? action.title}
              label={action.title}
              disabled={action.attributes?.disabled || (!action.subactions?.length && !action.id)}
              tone={action.attributes?.destructive ? "danger" : "secondary"}
              fullWidth
              onPress={() => {
                if (action.subactions?.length) setPath((current) => [...current, action]);
                else if (action.id) {
                  props.onClose();
                  props.onSelect(action.id);
                }
              }}
            />
          ))}
      </ScreenScrollView>
    </Sheet>
  );
}

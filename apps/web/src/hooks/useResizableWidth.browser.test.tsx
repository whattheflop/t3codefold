import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { useResizableWidth } from "./useResizableWidth";

function Panel() {
  const { width, resizeTo } = useResizableWidth({
    storageKey: "fold-keyboard-panel-width",
    defaultWidth: 400,
    minWidth: 200,
    maxWidth: 800,
    edge: "left",
  });
  return (
    <aside>
      <output aria-label="Panel width">{width}</output>
      <button onClick={() => resizeTo(950)}>Maximum</button>
      <button onClick={() => resizeTo(10)}>Minimum</button>
      <button onClick={() => resizeTo(400)}>Reset</button>
    </aside>
  );
}

it("clamps and persists keyboard or reset widths without a pointer drag", async () => {
  localStorage.removeItem("fold-keyboard-panel-width");
  await using screen = await render(<Panel />);
  try {
    await userEvent.click(screen.getByRole("button", { name: "Maximum" }));
    await expect.element(screen.getByLabelText("Panel width")).toHaveTextContent("800");
    expect(localStorage.getItem("fold-keyboard-panel-width")).toBe("800");
    await userEvent.click(screen.getByRole("button", { name: "Minimum" }));
    await expect.element(screen.getByLabelText("Panel width")).toHaveTextContent("200");
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await expect.element(screen.getByLabelText("Panel width")).toHaveTextContent("400");
    expect(localStorage.getItem("fold-keyboard-panel-width")).toBe("400");
  } finally {
    localStorage.removeItem("fold-keyboard-panel-width");
  }
});

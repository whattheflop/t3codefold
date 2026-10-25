import { describe, expect, it } from "vite-plus/test";
import { createThreadRibbonMirror } from "./threadRibbonMirrors";

describe("interactive content in ribbon mirrors", () => {
  it("preserves the live radio selection when the other column gets a mirror", () => {
    using cleanup = new DisposableStack();
    const row = document.createElement("div");
    const selected = document.createElement("input");
    selected.type = "radio";
    selected.name = "layout";
    selected.defaultChecked = true;
    row.append(selected);
    document.body.append(row);
    cleanup.defer(() => row.remove());

    const mirror = createThreadRibbonMirror(row);
    document.body.append(mirror);
    cleanup.defer(() => mirror.remove());

    expect(selected.checked).toBe(true);
    mirror.remove();
    const secondMirror = createThreadRibbonMirror(row);
    document.body.append(secondMirror);
    cleanup.defer(() => secondMirror.remove());
    expect(selected.checked).toBe(true);
  });

  it("submits only live values when a row inside a form crosses the seam", () => {
    using cleanup = new DisposableStack();
    const form = document.createElement("form");
    const row = document.createElement("div");
    const note = document.createElement("input");
    note.name = "note";
    note.value = "Keep this once";
    row.append(note);
    form.append(row);
    document.body.append(form);
    cleanup.defer(() => form.remove());

    form.append(createThreadRibbonMirror(row));

    expect(new FormData(form).getAll("note")).toEqual(["Keep this once"]);
  });
});

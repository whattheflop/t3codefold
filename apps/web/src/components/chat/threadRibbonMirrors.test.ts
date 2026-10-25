// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createThreadRibbonMirror } from "./threadRibbonMirrors";

afterEach(() => document.body.replaceChildren());

describe("interactive content in ribbon mirrors", () => {
  it("preserves the live radio selection when the other column gets a mirror", () => {
    const row = document.createElement("div");
    const selected = document.createElement("input");
    selected.type = "radio";
    selected.name = "layout";
    selected.defaultChecked = true;
    row.append(selected);
    document.body.append(row);

    const mirror = createThreadRibbonMirror(row);
    document.body.append(mirror);

    expect(selected.checked).toBe(true);
    mirror.remove();
    document.body.append(createThreadRibbonMirror(row));
    expect(selected.checked).toBe(true);
  });

  it("submits only live values when a row inside a form crosses the seam", () => {
    const form = document.createElement("form");
    const row = document.createElement("div");
    const note = document.createElement("input");
    note.name = "note";
    note.value = "Keep this once";
    row.append(note);
    form.append(row);
    document.body.append(form);

    form.append(createThreadRibbonMirror(row));

    expect(new FormData(form).getAll("note")).toEqual(["Keep this once"]);
  });
});

/** A non-interactive rendering of the same row in another ribbon column. */
export function createThreadRibbonMirror(row: HTMLElement): HTMLElement {
  const mirror = row.cloneNode(true) as HTMLElement;
  mirror.inert = true;
  mirror.dataset.threadRibbonMirror = "";
  // Inert controls still join radio groups and form submissions. A visual
  // copy must not change the live selection or contribute duplicate values.
  for (const control of [mirror, ...mirror.querySelectorAll("input, select, textarea, button")]) {
    control.removeAttribute("name");
    control.removeAttribute("form");
  }
  // Only the live row is a citation source or an anchor target.
  for (const node of [
    mirror,
    ...mirror.querySelectorAll("[id], [data-assistant-citation-source]"),
  ]) {
    node.removeAttribute("id");
    node.removeAttribute("data-assistant-citation-source");
  }
  // Embedded documents and canvases would start over in a copy; keep their footprint only.
  const embeds = "iframe, canvas, video, audio";
  const sources = row.querySelectorAll(embeds);
  mirror.querySelectorAll(embeds).forEach((node, index) => {
    const source = sources[index];
    const stub = document.createElement("div");
    stub.dataset.threadRibbonEmbed = "";
    const label = document.createElement("span");
    label.textContent = "Interactive content · move the pointer here to use this part";
    stub.append(label);
    if (source instanceof HTMLElement) {
      stub.style.width = `${source.offsetWidth}px`;
      stub.style.height = `${source.offsetHeight}px`;
    }
    node.replaceWith(stub);
  });
  return mirror;
}

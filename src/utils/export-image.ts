import { toPng } from "html-to-image";

/**
 * Exports the current React Flow graph as a PNG image and triggers a
 * browser download. The capture targets the `.react-flow` element and
 * excludes the controls/panel overlays so the output is just the graph.
 *
 * @param filename - The download filename (without extension).
 * @param backgroundColor - Background colour for the exported image. Defaults to the app canvas colour.
 */
export async function exportGraphAsImage(
  filename: string,
  backgroundColor: string = "#F9F8F6"
): Promise<void> {
  const flowElement = document.querySelector<HTMLElement>(".react-flow");
  if (!flowElement) {
    throw new Error("Graph not found");
  }

  const dataUrl = await toPng(flowElement, {
    backgroundColor,
    filter: (node) => {
      // Exclude React Flow UI chrome (controls, panels, attribution)
      // so the exported image only contains the graph itself.
      if (!(node instanceof HTMLElement)) return true;
      return (
        !node.classList.contains("react-flow__controls") &&
        !node.classList.contains("react-flow__panel") &&
        !node.classList.contains("react-flow__attribution")
      );
    },
  });

  const link = document.createElement("a");
  link.download = `${filename}.png`;
  link.href = dataUrl;
  link.click();
}

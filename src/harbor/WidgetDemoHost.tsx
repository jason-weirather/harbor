import HarborWidget from "./HarborWidget";
import type { HarborArtifact, HarborWidgetManifest } from "./HarborWidget.types";

interface WidgetDemoHostProps {
  manifest: HarborWidgetManifest;
}

const hostArtifacts: HarborArtifact[] = [
  {
    id: "host-tide-notebook",
    title: "Tide Notebook",
    summary: "A host-supplied field note that stays inside the widget info panel.",
    displayMode: "panel",
    payload: {
      source: "widget-demo",
      kind: "field-note",
    },
  },
  {
    id: "host-signal-bulletin",
    title: "Signal Bulletin",
    summary: "A host-supplied link that behaves like a generic external artifact.",
    url: "/plain/artifacts/dock-checklist/",
    displayMode: "open",
    payload: {
      source: "widget-demo",
      kind: "reading-link",
    },
  },
];

export default function WidgetDemoHost({ manifest }: WidgetDemoHostProps) {
  return (
    <HarborWidget
      manifest={{
        ...manifest,
        artifacts: hostArtifacts,
      }}
      mode="embedded"
      onArtifactSelected={(artifact) => {
        if (artifact) {
          console.info("Harbor widget selected artifact", artifact);
        }
      }}
      onCatch={(event) => {
        console.info("Harbor widget catch", event);
      }}
      title="Embedded Harbor Widget"
    />
  );
}

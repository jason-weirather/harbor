import HarborWidget from "../../harbor/HarborWidget";
import type { HarborWidgetManifest } from "../../harbor/HarborWidget.types";

interface FishingGameShellProps {
  manifest: HarborWidgetManifest;
  title?: string;
}

export default function FishingGameShell({
  manifest,
  title = "Harbor Fishing Prototype",
}: FishingGameShellProps) {
  return <HarborWidget manifest={manifest} mode="standalone" title={title} />;
}

import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import HarborWidget from "./HarborWidget";
import type {
  HarborWidgetController,
  HarborWidgetHandle,
  HarborWidgetOptions,
} from "./HarborWidget.types";

export function mountHarborWidget(
  container: Element,
  options: HarborWidgetOptions,
): HarborWidgetController {
  const root = createRoot(container);
  const widgetRef = createRef<HarborWidgetHandle>();

  flushSync(() => {
    root.render(createElement(HarborWidget, { ...options, ref: widgetRef }));
  });

  return {
    destroy() {
      root.unmount();
    },
    getState() {
      const state = widgetRef.current?.getState();

      if (!state) {
        throw new Error("HarborWidget state is unavailable because the widget has been destroyed.");
      }

      return state;
    },
    setArtifacts(artifacts) {
      widgetRef.current?.setArtifacts(artifacts);
    },
    clearCreel() {
      widgetRef.current?.clearCreel();
    },
  };
}

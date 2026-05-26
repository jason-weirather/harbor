import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

const noop = () => {};

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: vi.fn(() => {
    const gradient = {
      addColorStop: noop,
    };

    return {
      arc: noop,
      beginPath: noop,
      clearRect: noop,
      closePath: noop,
      createLinearGradient: () => gradient,
      fill: noop,
      fillRect: noop,
      lineTo: noop,
      moveTo: noop,
      quadraticCurveTo: noop,
      restore: noop,
      save: noop,
      scale: noop,
      stroke: noop,
      strokeRect: noop,
      translate: noop,
      imageSmoothingEnabled: false,
    };
  }),
});

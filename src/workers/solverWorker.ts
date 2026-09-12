import { solveSurface, type SolverInput } from "../domain/solver/solver";
self.onmessage = (event: MessageEvent<{ id: number; input: SolverInput }>) => {
  try {
    self.postMessage({
      id: event.data.id,
      result: solveSurface(event.data.input),
    });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : "求解失败",
    });
  }
};

import { solveContinuity } from './solver';
import type { LandmarkProject } from '../landmarks/model';
self.onmessage = (e: MessageEvent<LandmarkProject>) => self.postMessage(solveContinuity(e.data));

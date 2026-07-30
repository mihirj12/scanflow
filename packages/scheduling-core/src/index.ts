export { InvalidPlacementRequestError } from './errors.js';
export { isFree, occupy, slotRange, type SlotMask } from './slot-mask.js';
export { suggestPlacements } from './suggest-placements.js';
export type {
  Candidate,
  EngineResource,
  EngineStep,
  Placement,
  PlacementRequest,
  ResourceTypeName,
} from './types.js';
export { validatePlacementRequest } from './validate-placement-request.js';

// Internal entry — for the testkit's own loaders, testkit-vitest and grest-ts tests only. Not public API; no stability guarantee.
export {GGDateShim} from "./clock/GGDateShim";
export {bootClock, installTestClock} from "./clock/GGTestClock";

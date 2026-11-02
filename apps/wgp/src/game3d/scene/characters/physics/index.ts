/**
 * The characters' presentation physics kit: damped springs, Verlet particles with distance
 * constraints, analytic two-bone IK and FABRIK, and a fixed sub-step clock. It only ever
 * moves what is drawn; the sim never reads it, so ranked replays stay exact.
 */
export { Spring, Spring3, springCoeffs, type SpringCoeffs } from "./spring";
export { Verlet, type VerletOptions } from "./verlet";
export { fabrik, solveTwoBone, type V3 } from "./ik";
export { FixedStepper, KIT_HZ } from "./stepper";

/**
 * near-api-js, re-exported for scripts/near. Scripts live outside the app, where pnpm
 * doesn't link near-api-js, so they import it through here and share the app's copy.
 */
export { Account, actions, buildDelegateAction, encodeSignedDelegate, JsonRpcProvider, KeyPair, KeyPairSigner, PublicKey, type Action } from "near-api-js";

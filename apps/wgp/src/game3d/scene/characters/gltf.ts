/**
 * One glTF loader for the bodies and clips, set up for the packed files (EXT_meshopt_compression,
 * decoded by three's MeshoptDecoder: inline WebAssembly, nothing extra to host). Loaded on first
 * use, so neither reaches a page without the 3D scene.
 */
import type { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { fetchModel, releaseModel } from "./files";

let loader: Promise<GLTFLoader> | null = null;

export function gltfLoader(): Promise<GLTFLoader> {
  loader ??= Promise.all([import("three/examples/jsm/loaders/GLTFLoader.js"), import("three/examples/jsm/libs/meshopt_decoder.module.js")]).then(
    ([{ GLTFLoader }, { MeshoptDecoder }]) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),
  );
  loader.catch(() => (loader = null));
  return loader;
}

/** Parse a model file, given its bytes (or fetched now). */
export async function loadGltf(url: string, bytes: Promise<ArrayBuffer> = fetchModel(url)): Promise<GLTF> {
  try {
    const [l, data] = await Promise.all([gltfLoader(), bytes]);
    return await l.parseAsync(data, "");
  } finally {
    releaseModel(url);
  }
}

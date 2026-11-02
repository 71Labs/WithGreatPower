# The Node: a real 3D hero

The hero for the X header, and a rigged model for the game, built from a MakeHuman body
(CC0, via the MPFB Blender extension) in a red web suit and mask. Everything here is generated
by the scripts in this folder; nothing is hand-edited and nothing is downloaded.

## Files

| File | What |
|---|---|
| `hero-swing.png` | Pose A (the header's): three-quarter swing, fist up-left on the web, knees tucked. Transparent, figure 2200 px tall. |
| `hero-swing-b.png` | Pose B: frontal three-quarters, arms flung wide. |
| `hero-swing-c.png` | Pose C: a compact horizontal dive along the web. |
| `hero-swing*.json` | Sidecars: image size and the fist's pixel (`fist_px`). Each render's web strand leaves the fist rising 1 px per 4 px to the left (the header's slope 0.25). |
| `../art/city-backdrop.png` | The moon window's city: a real game frame (see *Backdrop*). |
| `city-backdrop-alt.png` | An alternate backdrop (frame 43: water tower, fire escapes). |
| `preview-header*.png` (+ `@2x`, `.json`) | The real `x-header.html`, with the backdrop and a hero dropped in. The JSON has the CSS used for the hero `<img>` inside `.moon`. |
| `hero.glb` | The game model: rest pose, skinned to the 53-bone skeleton, 16,000 triangles, baked suit texture. |
| `build/` | Intermediates: `hero-base.blend` (the suited, rigged body), `frames/` (the captured game frames), `hero-albedo.png` (the baked texture). |
| `drafts/` | Earlier review images (draft 1 vs the old mannequin, draft 2 header stack). |

## Regenerate

```sh
launch/brand/hero/make.sh            # everything (~2 min)
launch/brand/hero/make.sh renders    # renders + previews only
```

Or step by step (from the repo root):

```sh
blender -b -P launch/brand/hero/build.py                                       # → build/hero-base.blend
blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/render.py -- --pose a --out launch/brand/hero/hero-swing.png
#   --pose a|b|c|rest|rest34|back   --height 2200 (figure px)   --quick (workbench, seconds)   --no-web
python3 launch/brand/hero/backdrop.py launch/brand/hero/build/frames/play-027.png --keep right
python3 launch/brand/hero/preview.py --hero launch/brand/hero/hero-swing.png
blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/export.py   # → hero.glb
```

Requirements:
- Blender 5.1 with MPFB 2.0.x enabled (`bl_ext.blender_org.mpfb`). The base mesh, targets, rigs and weights it ships with are all that's used.
- `python3` with numpy, Pillow and scipy for `backdrop.py` and `preview.py`.
- Chrome for `preview.py`. Like `../render.sh`, it loads the header's Google Fonts.

The build is deterministic: a fresh `build.py` + `render.py` reproduces `hero-swing.png` pixel for pixel.

## How it's made

**`build.py`: the body.**
1. **Body.** MakeHuman macros: male, age 25, muscle 0.96, weight 0.55, height 0.6, ideal proportions, mixed ethnicity. Detail targets add a V-taper, lats, delts, biceps, quads, calves and a longer neck.
2. **Rig.** The `game_engine` rig is fitted to the body's joint cubes, and MakeHuman's own weights are loaded. The joint cubes need `detailed_helpers=True`; without them the rig falls back to default positions.
3. **Bake.** Targets are baked and all helper geometry is deleted.
4. **Suit feet.** The toes are cut off on a plane behind the toe webs, and a sock toe box is lofted from that ring: superellipse profile, flat sole, a slight point toward the big toe. The new vertices are skinned to `ball_l`/`ball_r`.
5. **Suit smoothing.** The navel, nipples, lips, nails, ears and eye sockets are smoothed, as under a bodysuit and mask.
6. **Web coordinates.** Each face belongs to a web *cell*:
   - mask: radiating from between the eyes;
   - chest and back: radiating from a centre;
   - each limb: lines along it, rings around it.

   Per face corner it stores the angle, radius and ring parameters (`web_p`, `web_q`, `web_r`). They are computed in the rest pose, so the pattern sticks to the body when posed. Radial distances are geodesic (Dijkstra over the mesh).
7. **Lenses.** The hero sticker's teardrop (`../art/node.svg`) is wrapped onto the face as two raised shells: a black rim (2.9 sticker units outside the path, 1.5 inside) under a white lens. Both are skinned to `head`.

**`posing.py`: poses.**
- Bones are posed by aiming them at directions in "screen" space (the camera looks along +y) or "body" space. Each bone's armature-space matrix is built from its parent's, so there is no depsgraph round trip.
- Hands use per-joint curls about each finger bone's local X. The `FIST` / `FIST_THUMB` and `OPEN` / `OPEN_THUMB` presets are reusable in the game.
- Poses: `a`, `b`, `c` (swings) and `rest`, `rest34`, `back` (model sheets).

**`render.py`: the comic look (EEVEE).**
- **Cel bands:** a sun key from the moon's side, then Shader to RGB. AO folds into the light so muscle creases band too. A constant-band ramp (6 tones of the sticker red, `#E5392C` at mid-light) gives the bands, with halftone dots in the shadow bands.
- **Rim and web:** a warm rim light on edges facing the moon, and the ink web from the stored coordinates.
- **Ink:** a bold `#141414` inverted-hull outline (Solidify, 11 mm, transparent to shadows), plus Freestyle creases and contours.
- **Mesh and strand:** subdivision level 2. The web strand is a thin white tube with an ink hull.

**`placement.py` + `preview.py`: the header.**
- `placement.py` scales a render so the figure fits roughly within x 760–1180 and y 180–520 with the fist at (930, 240). `preview.py` writes those numbers to the JSON.
- The lead's wiring in `x-header.html` uses its own scale (1.25×, fist at (930, 185)).

## Backdrop

`backdrop.py` takes a frame from `launch/brand/capture.mjs`. The frames came from this command:

```sh
node launch/brand/capture.mjs --save launch/out/saves/night-a.json --url "/play/patrol?autopilot=1&tier=high" --count 60 --every 500 --wait 7000 --out <dir>
```

The chase camera always keeps the game's own (old) hero near the middle of the frame, so no raw frame was clean. The script finds that hero (the largest blob of suit red) and reframes the frame:
- it crops by the smallest zoom (1.70× for frame 27) that keeps the side away from the old hero;
- it pushes the old hero left of the moon window's visible region (frame CSS x < 258).

The output stays 3280 × 2000, so it drops into the existing `.moon img` CSS. The zoom is invisible at the header's 2× render (about 1.05× upscaling).

## The game model (`hero.glb`)

- **Mesh:** one skinned mesh `TheNode`: 16,000 triangles, 11,105 vertices after UV splits, up to 4 influences per vertex.
- **Skeleton:** `NodeRig`, 53 bones.
- **Material:** `TheNodeSuit`, with baseColor = 2048² baked flat colours (sticker red, ink web, white lenses, black rims). No lighting is baked.
- **Space:** glTF axes. +Y is up, the hero faces +Z, and his left (`_l`) is +X. Metres; soles at y = 0; 1.886 m tall.
- **Rest pose:** MakeHuman's A-pose, with the arms about 45° below horizontal.
- **Bones:** not connected. Each bone's local +Y runs along the bone (Blender convention), so the rest rotations are **not** identity.

### Bones

```
Root
└ pelvis
  ├ spine_01 → spine_02 → spine_03
  │   ├ neck_01 → head
  │   ├ clavicle_l → upperarm_l → lowerarm_l → hand_l
  │   │     └ thumb_01_l → thumb_02_l → thumb_03_l   (and index_, middle_, ring_, pinky_ 01–03)
  │   └ clavicle_r → … (mirror)
  ├ thigh_l → calf_l → foot_l → ball_l
  └ thigh_r → calf_r → foot_r → ball_r
```

Rest joints (glTF metres, x / y-up / z-forward):

| Joint | Position |
|---|---|
| pelvis | (0, 1.031, 0.005) |
| neck_01 | (0, 1.618, 0.014) |
| head | (0, 1.733, 0.048) |
| head top (tail) | (0, 1.895, 0.043) |
| upperarm_l | (0.238, 1.510, 0.020) |
| lowerarm_l | (0.426, 1.301, 0.021) |
| hand_l | (0.571, 1.161, 0.228) |
| thigh_l | (0.110, 1.025, −0.006) |
| calf_l | (0.154, 0.553, 0.030) |
| foot_l (ankle) | (0.212, 0.078, 0.014) |
| ball_l | (0.216, 0.009, 0.151) |

Limb lengths: upper arm 0.282, forearm 0.289, thigh 0.475, shin 0.478.

The web grip point, as `render.py` computes it: the midpoint of `index_01_r` and `pinky_01_r` heads, plus 0.022 m along the palm normal (the hand's local +Z), plus 15% of the hand_r → index_01_r vector.

### Driving it from the game's animator

Paths are under `apps/wgp/src/game3d/scene/characters/`. Today the hero is already a `THREE.SkinnedMesh` on a `THREE.Skeleton`:
- `createRig` builds the skeleton (`rig.ts:129`);
- `CORE_BONES` lists the bones (`rig.ts:70`): root, hips, spine, chest, neck, head, clav/arm/fore/hand L/R, thigh/shin/foot L/R;
- `HERO_BODY` defines the body (`rig.ts:218`), 88 units tall (about 2 cm per unit);
- +Y is up and the character faces +Z, the same as the glb.

The animator works like this:
1. `HeroAnimator` (`anim/hero.ts`) composes a `Pose` (`anim/pose.ts:12`): root position and rotation, hips offset, Eulers for spine, chest, neck and head, clavicle Eulers, world IK targets with poles for hands and feet, hand aim and rotation, foot rotation.
2. `applyPose` (`anim/pose.ts:96`) applies it, solving the limbs with `solveTwoBone` (`physics/ik.ts:28`).
3. `aimBone` (`rig.ts:270`) then aims each bone.

Name map (an alias in the rig's lookup keeps the ragdoll, debug overlay and hero code on game names):

| game | glb |
|---|---|
| root | Root |
| hips | pelvis |
| spine | spine_01 (optionally sharing with spine_02) |
| chest | spine_03 |
| neck | neck_01 |
| head | head |
| clavL / clavR | clavicle_l / clavicle_r |
| armL / armR | upperarm_l / upperarm_r |
| foreL / foreR | lowerarm_l / lowerarm_r |
| handL / handR | hand_l / hand_r |
| thighL / thighR | thigh_l / thigh_r |
| shinL / shinR | calf_l / calf_r |
| footL / footR | foot_l / foot_r |

`ball_*` and the 30 finger bones have no game equivalent. Leave them at rest, or drive the fingers from the hand state using `posing.py`'s `FIST` and `OPEN` presets: curls about each finger bone's local X, in degrees per joint. The web hand would be `FIST`, the free hand `OPEN`.

What it takes:
1. **Load.** Use `GLTFLoader` (three `^0.187`) or drei `useGLTF` (`^10.7.9`). Neither is used in `apps/wgp` yet.
2. **Build `Rig` from the glb skeleton** instead of `createRig`:
   - `hipHeight` = pelvis y;
   - `spec.ankle` = foot_l y;
   - `height` = 1.886;
   - limb `l1`/`l2` = the joint distances above;
   - store each bone's **rest quaternion** (`rig.rest` keeps positions only today).
3. **Make every rotation write rest-relative.** The game assumes identity rest rotations; these bones don't have them.
   - `aimBone`: use `swing(R0·axis → dir) · R0` instead of `setFromUnitVectors(axis, dir)`, which would drop the rest twist and roll the mesh.
   - The Euler writes for spine, chest, neck, head and clavicles: use `local = R0 · (A⁻¹ · D · A)`. Here A is the bone's rest orientation relative to Root, so a delta D stays "pitch forward / yaw left".
   - Feet: world = `footRot · F0`, where F0 is the foot's rest world rotation.
   - `handAim`: use the hand_r → middle_01_r direction as the hand axis. The fist maths in `anim/hero.ts` needs the same change.
4. **Scale into game units.** Use k = 88 / 1.886 ≈ 46.7. Bake it into the vertex positions and bone translations (rescale, then `skeleton.calculateInverses()` at rest) rather than scaling a parent. IK targets, hip offsets and the shaders' `vRest` stripe and glitch patterns all assume game units.
5. **Model.** Replace `CharacterModel` (`model.ts:66`) for the hero:
   - clone the glb `SkinnedMesh` twice, fill and ink hull, on one skeleton;
   - keep the generous `boundingSphere` (or `frustumCulled = false`) and `renderOrder = 1`;
   - make `setLod` a no-op, or export a second, lighter glb with `export.py --tris 6000`.
6. **Shading.** The body shader (`shaders.ts:74`) expects palette attributes (`aPal`, `aMask`, `aDetail`, `aHull`) that a glb doesn't have. Unbound, `aPal` reads as ink and the hull normal becomes NaN. Either:
   - fork `BODY_FRAGMENT` to sample the baked `map`, keeping the cel bands and halftone. Set `texture.colorSpace = NoColorSpace`, since the canvas is `flat linear`. Or:
   - generate the attributes: `aHull` from position-averaged normals with w = 1, `aPal` as the suit index, `aDetail` kind 0 (the web is in the texture).

   The hull shader (`HULL_VERTEX`, `shaders.ts:240`) can stay as it is once `aHull` exists.
7. **Gwei and the ragdoll** use the same rig path (`characters.ts:504`, `anim/ragdoll.ts`). The alias and the limb lengths cover them.

### In the game (done)

The plan above is built. What ships and where:

- **Files:** `apps/wgp/public/models/hero.glb` (16,000 triangles, medium and high tiers) and `hero-lo.glb` (5,000, low tier), from `export.py --game` (`make.sh` runs both). No texture, UVs or material, so they're small: 0.8 MB and 0.3 MB. Instead the shader gets:
  - `_web_p`, `_web_q`, `_web_r`: build.py's web coordinates per face corner, resampled from the full-resolution body after decimation (decimation leaves neighbouring faces disagreeing about a shared vertex, and the rings come out jagged). The lens and rim shells are kinds 8 and 9 in `_web_r.z`.
  - `_ao`: per-vertex ambient occlusion from 48 rays against the full body. Only hits on the same limb count, so a raised arm leaves no rest-pose shadow on the ribs.
- **Code:** in `apps/wgp/src/game3d/scene/characters/`:
  - `hero-asset.ts` loads a file once with GLTFLoader (itself dynamically imported).
  - `hero-rig.ts` builds the game's `Rig` from the skeleton: aliases, ×46.7 scale, rest rotations, elbow and knee hinges, finger presets and the grip point.
  - `hero-model.ts` and `hero-shaders.ts` hold the body and its cel shader.
  - `rig.ts` and `anim/pose.ts` hold the rest-relative writes; `hero-rig.test.ts` checks them against the real file.
- **Limbs** bend on hinges: the upper bone's frame is solved so the elbow or knee axis is normal to the IK's bend plane, and the lower bone only turns about it. A plain swing-from-rest would bend a real elbow sideways.
- **Decimation:** in collapse mode, a vertex group picks which vertices may collapse (weight 1 is decimated). The `decimate_protect` group in the default export therefore thins the hands, face and lenses instead of protecting them. The game export leaves it out.
- **Proof:** `game-shots/` (before and after) and `shoot.mjs`, which drives the lab and full autopilot nights over CDP.

### Motion capture (done)

The coordinator fetched Quaternius' *Universal Animation Library* (CC0) into `mocap/` (see `mocap/SOURCE.md`). `retarget.py` puts 13 of its clips onto NodeRig and writes `apps/wgp/public/models/hero-anims.glb` (0.6 MB, no mesh):

- **Clips:** idle, idle-talk, walk, jog, sprint, jump-start, jump-loop, land, jab, cross, hit-chest, hit-head and death.
- **Retarget:** the UAL rests in a T-pose and our rig in an A-pose, so rotations can't be copied raw. Each hero bone's rest direction (head to next joint) is swung onto the UAL bone's, and the offset `C = Rs⁻¹ · swing · Rt` is kept. Per frame, the hero bone's armature-space rotation is the UAL bone's times C. The pelvis translation is scaled by the hip heights (×1.10). Loops are recentred and one-shots start at the origin.
- **In the game** (`anim/motion.ts`, `anim/mocap.ts`, `anim/stand.ts`):
  - **Standing:** the UAL idle has a wide, staggered stance, so standing uses its upper body and pelvis over procedural legs planted at hip width, with a contrapposto weight shift every 5–9 s and glances.
  - **Locomotion:** loops blend on one phase aligned to the left heel strike. Each loop's natural speed is measured at load by running its frames through the rig: walk ≈ 50 units/s, jog ≈ 230, sprint ≈ 220 at a faster cadence.

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

## The rest of the cast (`build_cast.py`, `cast.py`)

Every other character is now a real human body too, made the same way as the hero and on the
same 53-bone skeleton, so the hero's clips and rig code drive them unchanged:

```sh
launch/brand/hero/make.sh cast                                       # all nine, plus cast-anims.glb (~8 min)
blender -b -P launch/brand/hero/build_cast.py -- --who sybil          # one → apps/wgp/public/models/cast-sybil{,-lo}.glb
#   --preview out.png (flat-colour sheets: body, head, light body)   --no-export   --blend (keeps build/cast-<id>.blend)
blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/retarget.py -- --cast   # → cast-anims.glb
```

**The table (`cast.py`).** Per character: MakeHuman macros (sex, age, muscle, weight, height,
proportions, a race mix) and a few detail targets (a paunch, a V-taper), a palette of up to 16
colours (index 0 is ink; some are flat or glossy), triangle budgets, and a build function.

| Character | Body | Look |
|---|---|---|
| Aunt Mainnet | woman, 70, slight, 1.49 m (her bun adds a few cm) | grey hair cap and bun, round glasses, lilac dress with a flared skirt, pearls |
| Uncle Gen | man, 70, average, paunch | bald with grey sides, rectangular glasses, brown cardigan over a blue shirt (V and collar) |
| Mary JPEG | woman, 22, slim | red pixel hair (voxels in three reds), teal tee, jeans, white sneakers |
| J. Jonah Bearson | man, 50, stocky | dark suit, white shirt and collar, red tie, fur-coloured hands; a sculpted bear head with a grey flat-top, mustache, nose and a cigar |
| Gwei | woman, 22, athletic | white suit with black shoulders and sleeves, teal shoes; a sculpted hood with a pink lining, blonde fringe, the hero's web on her face (lilac) and his lens shells |
| Doc Octochain | man, 50, paunch | brown bowl cut, round sunglasses, green coat with tails open at the front, dark shirt; a steel harness (pack, belt, four booms) whose ends are his chains' sockets |
| Sandwich Man | man, 35, fit | black suit, white shirt, red tie; a burger head (bun with seeds, lettuce, tomato, cheese with drips, bread) |
| Gas Goblin | man, 30, lean | purple suit, dark trousers and boots, gloves, a purple cowl; a sculpted goblin head (long nose, chin, pointed ears) under a hood with a curled tip; the glider on its own bone; a fuel nozzle in his fist |
| The Sybil | man, 25, very muscular | all glossy black; copies in grey |

**Steps (`build_cast.py`).**
1. *Body:* `build.make_human` with the table's macros, the game_engine rig and MakeHuman's weights.
2. *Clothed:* the toes become a shoe's toe box (`build.toe_boxes`); navel, nipples and the like
   smoothed; each eye opening spanned by a membrane anchored on the lids and bulged a little,
   so the painted eyes sit on a smooth closed lid.
3. *Painted:* each face belongs to a region by its dominant bone (head, neck, torso, upper arm,
   forearm, hand, thigh, shin, foot). A paint is a palette entry, the regions it may touch and
   a set of half-spaces (a sleeve's end across the arm, a waistline, a round neckline, a V); the
   faces are first cut along each plane (`bisect_plane`), so seams are clean lines.
4. *Dressed:* `flare` (skirt, coat tails: rings wrapping the trunk-and-legs outline, never
   narrowing, skinned from the pelvis to the thighs by side), `shell` (hair caps and cowls:
   body faces above a hairline copied, pushed out, the rim smoothed along itself and walled down
   to the scalp), `hood_mb` (a metaball hood open at the face, lined), `voxel_hair`, `glasses`,
   `tie`, `pearls`, `cigar`; head pieces from metaballs (`Kit.metaball`, sizes are the surface's)
   on the head bone, with the human head deleted under them.
5. *Decimated* to the budget with colour-seam vertices locked (a collapse-decimate vertex group
   at 0), so seams survive exactly; props are joined after. The light body ("BodyLo") is the
   same, decimated further, with heavier props halved.
6. *Exported* (`export_glb`): both bodies in `cast-<id>.glb`, the light one alone in
   `cast-<id>-lo.glb`. Attributes: `_pal` (palette index per corner), `_face` (cm from between
   the eyes on the face's plane, and a mask), `_ao` (`export.bake_ao`), and Gwei's `_web_*`
   (resampled after decimation, as on the hero). The node extras (`wgp`) hold the palette, the
   flat and glossy entries, the face decals and Doc's sockets (glTF axes, metres).

**Faces.** Human faces keep their real nose, lips and ears; the eyes, brows, mouths, teeth,
blush and freckles are decals the shader draws in cm on the face's plane, with ink rims a fixed
number of pixels wide (the stickers' look). Shapes: ellipse, ring, lower and upper half, stroke,
arc (a smile or a closed eye), jag (the Sybil's eyes) and teeth (two zigzag rows), each optionally
clipped to the decal before it and mirrored.

**In the game** (`apps/wgp/src/game3d/scene/characters/`): `cast-asset.ts` (loading, game units,
the hull directions), `cast-model.ts` (`CastModel`; `CastCopies`, the Sybil's copies as one
instanced draw that packs three poses into its bone texture), `cast-shaders.ts`,
`anim/clip-layer.ts` (the clips over each animator's physics) and the cast animators. Clips play
as moves from each body's own rest pose (`MotionLayer`'s retarget: bone rotation = own rest ·
source rest⁻¹ · clip; the hips scaled by the hip-height ratio), so a differently curved spine
isn't bent to the hero's shape.

**Proof** (`game-shots/cast/`, git-ignored): `cast-shoot.mjs` drives `/lab/cast` for every
character (an eight-angle turntable, two head close-ups, every animator state as a still and a
burst); run it once with the cast's files hidden for `before/` (the procedural bodies) and once
for `after/`. `cast-moments.mjs` records a full autopilot night's fights, catches, errands and
Gwei's assist (`moments-a/`, `moments-b/`). `cast-sheet.py` lays them out in `compare/`.

## The Right-Clicker (Case file 001: `cast.py`, `rc_anims.py`, `case001_textures.py`)

Case file 001's villain is a tenth cast body, made exactly like the rest:

```sh
blender -b -P launch/brand/hero/build_cast.py -- --who right-clicker      # cast-right-clicker{,-lo}.glb
blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/rc_anims.py   # right-clicker-anims.glb
apps/wgp/scripts/models/compress.sh apps/wgp/public/models/cast-right-clicker.glb apps/wgp/public/models/cast-right-clicker-lo.glb apps/wgp/public/models/right-clicker-anims.glb
```

- **Body:** a slim young man (MakeHuman macros in `cast.py`), 1.82 m. A dark hoodie with a
  ribbed hem and a kangaroo pocket, joggers, black gloves, dark sneakers; drawstrings; a small
  white cursor badge on the chest. The hood is `hood_mb` with a peak (`extra` metaballs: a
  ridge over the brow), so its brim hangs over his eyes; dark hair under it.
- **Face:** as his 2D sticker (`components/cases/art.tsx`, `RightClickerArt`): the hood's dark
  across the upper face down to the nose, two glowing cyan pixel eyes in it (the `rect` decal,
  filled with a palette entry in the file's `glow` list, which the cast shader leaves unshaded
  and blooms), slanted brows, a lopsided smirk on the lower face.
- **The cursor:** `CURSOR`, the classic 12 × 20 pointer, extruded 3.8 cm and 56 cm long, rigid on
  `hand_r`. Its stem runs through the fist and the arrow points along the hand, its plane
  across the palm (upright in a pistol grip); white faces, ink walls.
- **Budgets:** 7,000 triangles ("Body"), 2,600 ("BodyLo"); packed 194 KB and 72 KB.
- **Clips (`rc_anims.py`):** the UAL's `Pistol_Aim_Neutral`, `Pistol_Shoot` and `Pistol_Reload`
  (rc-aim, rc-click, rc-reload), and moves made like the crowd's: rc-idle (the cursor on his
  shoulder, on the UAL idle), rc-copy (Ctrl+C, on the aim, 1.2 s), rc-drag (the lasso hauled
  in, 1.0 s) and rc-stagger (reeling, on the idle). The walk, the hits and the fall are the
  hero's. Packed 66 KB, fetched only on a night he's in.
- **Textures (`case001_textures.py`):** the MISSING poster straightened and cropped for the tabs
  clue, and the hero's `render.py --pose rest34` die-cut on a card border for the paper copies
  (`apps/wgp/public/media/chapters/`).

In the game: `scene/characters/anim/right-clicker.ts` (his phases), `scene/chapter/` (the
clues, the copies, captive Mary, SCREENSHOT) and `/lab/case` (fixture frames).
`case-shoot.mjs` takes the proof shots and the perf runs.

## The city's people (`civilians.py`, `crowd_anims.py`)

Eight civilians, made exactly like the cast (an MPFB body on the same 53-bone skeleton,
painted, dressed and exported by `build_cast.py`), for the crowds on the roofs, the sidewalks
and round the stops:

```sh
launch/brand/hero/make.sh civilians                                   # all eight and crowd-anims.glb, packed (~9 min)
blender -b -P launch/brand/hero/build_cast.py -- --who civ-office --preview out.png
blender -b launch/brand/hero/build/hero-base.blend -P launch/brand/hero/crowd_anims.py -- [--preview dir]
```

| Body | Who | Look |
|---|---|---|
| `civ-office` | man, ~32, average | suit jacket, shirt and collar, tie, short hair, a phone |
| `civ-jogger` | woman, ~28, athletic | tank top (bare shoulders), leggings, sneakers, ponytail, headband |
| `civ-elder` | man, ~75, paunch | long open coat, scarf, flat cap, glasses, grey at the sides |
| `civ-teen` | boy, ~16, slim | hoodie with its hood bunched at the neck, jeans, messy hair, a phone |
| `civ-auntie` | woman, ~55, heavy | blouse, long skirt (flare), bun, a handbag on the forearm |
| `civ-worker` | man, ~42, big | tee, hi-vis vest with reflective bands, work trousers, boots, hard hat |
| `civ-student` | woman, ~21, slim | big tee, shorts, long hair (a metaball fall), backpack, a phone |
| `civ-kid` | girl, ~9 | dress, sneakers, pigtail buns |

- **One palette layout** (`SLOTS`: ink, skin, hair, brow, top, trim, bottom, shoe, accent,
  accent2, white, mouth, blush, lens, inner, sole), and per body the colours each slot may take
  (`looks` in the file's extras: skin tones light to deep, natural, grey and dyed hair, the
  clothes; "#SKIN" means the person's own skin). The game picks a pool of looks per body from
  the night's seed, so eight bodies make a varied crowd.
- **One face** for all of them (eyes with a highlight, brows, a small smile, blush), on face
  coordinates scaled per body so the eyes sit at ±3 cm and the mouth's line at −6.2 cm
  (`face_sx`, `face_sy_up`, `face_sy_down` in `build_cast.face_coords`).
- **Budgets:** "Body" 2,400–3,000 triangles, "BodyLo" 900–1,350 (its colour seams no longer
  locked, its props halved). The fingers' weights fold into the hands, so the crowd skins with
  23 bones. Packed: `civ-<id>.glb` 86–110 KB, `civ-<id>-lo.glb` 38–47 KB.

**`crowd_anims.py`** retargets UAL clips the cast doesn't use (`Walk_Formal_Loop`,
`Dance_Loop`) with `retarget.py`, and makes moves on the idle and the walk: each frame of the
base clip with some bones re-aimed by `posing.py`'s ops in the body's frame. `stand` and
`stand-talk` bring the UAL idle's wide, staggered fighter's stance in under the hips (each
thigh turned 7° in, the feet kept level); `wave`, `cheer` (a little hop), `fist-pump`, `point`
(up and ahead), `photo` (a phone held out at arm's length), `phone` and `walk-phone` (head
down to it), `clap` and `look-up` ride on that. Every oscillation is a whole number of cycles in
its loop. Exported at every other frame and only the keyed bones (`retarget.export`'s `step`
and `lean`): 96 KB packed for 13 clips.

**In the game** (`apps/wgp/src/game3d/scene/crowd/`): `crowd.ts` (the system the engine
mounts), `placement.ts` (where, from the night's seed), `lod.ts` (budgets, fades, animation
rates), `batch.ts` (an instanced fill and hull per body and level of detail, on two shared
materials),
`shaders.ts` (the cast's shaders, patched), `skeleton.ts` (forward kinematics into the bone
texture), `clips.ts` (channels), `looks.ts`, `civilians.ts` (the files). `/lab/crowd` stands
them in a row beside the cast.

**Proof** (`game-shots/npcs/`, git-ignored): `npc-shoot.mjs perf` plays a whole autopilot night
and records frame times, draw calls and the crowd's own counts (desktop or phone, any tier,
CPU throttled); `table` lays the before and after runs out; `shots` takes the night's roofs,
street, fight crowd, win and errand; `lineup` shoots `/lab/crowd`.

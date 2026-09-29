# Recipes (tested on real projects)

All examples use `python3 aeb.py ... --project "<path>.aep"`. In a real project: first read the state → show the plan → wait for the user's approval → apply in `batch` (one undo step per part) → verify.

## 1. Client edits from Frame.io / a comment export
1. Match the comment timecodes to the main comp: `renderFrames` at those times plus a contact sheet via ffmpeg `hstack/vstack`.
2. Find the layers: `findLayers {"text":"..."}`, `dumpComp {"layerType":"text","props":false}`.
3. Sort the comments into three groups: "can do myself", "needs clarification", "depends on assets/VO". Get answers **before** making changes.
4. Take a `snapshot` of all comps you will touch.
5. Text changes: `replaceText` with `layerMatch` + `comps`, **line by line** (find the old line → the new one). This keeps each line's colors and fonts.
6. After the texts:
   - `findLayers {"text":"old word"}` to confirm nothing is left;
   - `audit` (text outside the frame/safe area);
   - `renderFrames` of every changed shot.

## 2. Retime to a new voiceover (the edit was agreed in an NLE such as DaVinci Resolve, with freeze frames)
1. The user renders from the NLE: the voiceover alone as WAV from 00:00, and a proxy of the video track.
2. Build the freeze map: `python3 tools/edit_timemap.py OLD_RENDER.mov proxy.mov` (needs numpy).
   The output lists where in the old video a hold was inserted and how long it is.
   - The NLE retime curve (e.g. DaVinci Resolve) is not exposed through the scripting API, so this is the only reliable way.
   - Do not overwrite `OLD_RENDER.mov` with a new render until the map is built.
3. For each hold, find the scene and a calm moment (±0.5 s, all animation already finished). Merge holds that are next to each other within one scene: the start and end moments stay the same.
4. Make each hold a "live" pause, not a freeze. From the bottom level up:
   - **Scene comp:**
     - `setCompSettings duration` +D;
     - `setTiming outPoint` +D for the layers that reach the end of the scene;
     - `setMarker ... shift` for END;
     - keys after the hold point: `moveKeyframes {"range":[t, 999], "delta":D}`;
     - expressions with an absolute time (`ease(time, 6.8, 7.3, ...)`): `replaceInExpressions`. Find them with `listExpressions {"match":"time, \\d"}`.
   - **Parent comp:** extend the scene layer's outPoint, then `shiftLayers {"after":t, "delta":D, "markers":true}`, then extend the duration.
   - **Main comp:** the same. Do not shift the music or the new VO (their inPoint = 0, `after` does not catch them).
5. Check that the changed comps are not used somewhere else: `compInfo.usedIn` and `whereUsed`. If a comp is shared, make a copy.
6. Verify:
   - `renderFrames` at ~10 timecodes per section;
   - `python3 tools/compare_frames.py RENDER_FOLDER proxy.mov` (±3 frames = OK);
   - a mismatch is allowed only where the content was changed after the old render.

## 3. Duplicate a scene as the base of a new one (e.g. a frozen "picture" under arrows)
1. `duplicateComp` → disable the extra layers in the copy (`setSwitches enabled:false`).
2. `addFromItem` into the target comp → `timeRemap {"freezeAt": T}` → fade/scale expressions.
3. The original comp stays untouched: other scenes keep working.

## 4. Zoom-out transition into the next block
1. Put the outgoing block above the next one in the parent comp and extend it by ~1 s.
2. Inside the outgoing block:
   - a `ZOOM_OUT` null at the frame center;
   - parent the content to it;
   - scale keys 100→85;
   - in the opacity expressions multiply `* ease(time, t0, t1, 1, 0)`.
3. Cut the background of the outgoing block at the cut point (`setTiming outPoint`).
4. Turn on Collapse Transformations on precomps with shapes that go past the comp edge. Otherwise, when scaled down, you see a straight clipped edge.

## 5. Text/layer checks
- `sourceRect` gives comp-space bounds. Useful for distances between a title and a caption, and for alignment to the frame edges.
- Different line counts in text captions: compare `sourceRect.top` of neighbouring captions; different `position.y` values were chosen on purpose.

# BridgeLine - commands

Generated from `src/*.jsx` by `tools/gen_commands_doc.py`. W = changes the project (needs 'Allow changes').
Total: 134 commands.

## Read (no changes)

| Command | W | Description / args |
|---|---|---|
| `ping` |  | Bridge/AE/project status. |
| `help` |  | List commands. args: [filter] regex on name/doc, [writeOnly], [readOnly] |
| `projectTree` |  | Project items. args: [flat] list instead of tree, [type] comp\|footage\|solid\|folder\|audio\|placeholder, [match] regex, [out] file |
| `compInfo` |  | Comp settings + short layer list. args: comp |
| `dumpComp` |  | Full JSON of a comp (only modified props unless all). args: comp, [layers\|layer\|match\|selected], [all], [depth], [evaluated], [time], [props:false], [maxExpr], [out] file |
| `dumpLayer` |  | Full JSON of one layer. args: comp, layer, [all], [depth], [evaluated], [time] |
| `dumpProperty` |  | JSON of a property or group. args: comp, layer, path, [all=true], [depth], [evaluated], [time] |
| `findLayers` |  | Search layers across comps. args: [name] regex, [layerType], [comps\|compMatch], [effect] regex (name/matchName), [text] regex, [expression] regex, [comment] regex, [source] regex, [hasExpressions], [hasKeys], [disabled], [limit=500] |
| `listExpressions` |  | All expressions. args: [comps\|compMatch\|comp], [match] regex on expression, [errorsOnly], [full] untruncated, [out] |
| `listFonts` |  | Fonts used by text layers (+ missing). args: [available] also list installed fonts, [match] regex for installed list |
| `listEffects` |  | Installed effects. args: [match] regex on name/matchName/category |
| `renderFrames` |  | Save comp frames as PNG. args: comp, [time]\|[times]\|[range:[start,end], step]\|[markers:true], [folder] (default bridge/renders), [prefix] |
| `valueAtTime` |  | Evaluated value(s). args: comp, layer, path, [time]\|[times], [preExpression] |
| `sourceRect` |  | Layer rect in layer space + approx comp-space bounds. args: comp, layer(s)/match/selected, [time], [extents] |
| `activeState` |  | What is open/selected in AE now (active comp, CTI, selected layers/properties/keys, selected project items). |
| `whereUsed` |  | Where an item is used (layers) and which expressions mention it. args: item \| text (string to search in expressions) |
| `dependencyGraph` |  | Nested comp tree. args: comp, [footage] include footage/solids, [maxDepth=20] |
| `snapshot` |  | Save a JSON snapshot of comps for later diff. args: [comps\|comp\|compMatch], [name] (default: first comp name) |
| `diff` |  | Compare current state with a snapshot. args: name, [limit=300] |
| `audit` |  | Project problems report: missing footage/fonts, expression errors, texts outside frame/safe area, empty comps, unused items, layers outside comp time, missing effects. args: [comps\|compMatch], [safe=0.9] title-safe ratio, [limit=100] |
| `checkTextOverlap` |  | Text layers whose bounding box overlaps other visible layers. args: comp, [time]\|[times], [ignore] regex of layer names, [maxCover=0.9] ignore layers covering more than this share of frame |
| `getLog` |  | Last panel log lines. args: [lines=100] |
| `getNotes` |  | Notes and selection the user sent from the panel. args: [clear] empty the notes file afterwards |
| `listRQ` |  | Render queue items. args: [templates] include available template names |
| `listGuides` |  | Comp guides. args: comp |

## Layers

| Command | W | Description / args |
|---|---|---|
| `addSolid` | W | Add solid. args: comp, [color='#000000'], [width], [height], [duration], [adjustment] + common |
| `addNull` | W | Add null. args: comp, [duration] + common |
| `addAdjustment` | W | Add adjustment layer. args: comp + common |
| `addText` | W | Add text. args: comp, text (string or lines[]), [box:[w,h]], [style:{font,fontSize,fillColor,justification,tracking,leading,...}] + common |
| `addShape` | W | Add shape layer. args: comp, shapes:[spec...] (see buildShapeGroup: type rect\|ellipse\|star\|polygon\|path, size, center, vertices, fill, stroke, trim...), [absolute] layer at [0,0] with anchor [0,0] so path coords are comp coords + common |
| `addCamera` | W | Add camera. args: comp, [name], [pointOfInterest:[x,y]], [options:{zoom,depthOfField,focusDistance,aperture,blurLevel}] + common |
| `addLight` | W | Add light. args: comp, [name], [lightType] parallel\|spot\|point\|ambient, [center:[x,y]], [options:{intensity,color,coneAngle,coneFeather,castsShadows,shadowDarkness,shadowDiffusion}] + common |
| `addFromItem` | W | Add project item (footage/comp/solid) as a layer. args: comp, item, [duration] + common |
| `duplicateLayer` | W | Duplicate layer(s). args: comp, layer\|layers, [count=1] + common (applied to each copy) |
| `deleteLayer` | W | Delete layer(s) (undoable). args: comp, layer\|layers\|match\|selected |
| `renameLayer` | W | Rename. args: comp, layer, name  OR  layers + find/replace (regex) |
| `moveLayer` | W | Change stacking order. args: comp, layer\|layers, to: 'top'\|'bottom'\|index\|{above:layer}\|{below:layer} |
| `copyLayerToComp` | W | Copy layer(s) to another comp (goes on top there). args: comp, layer\|layers, toComp + common |
| `setTiming` | W | Timing. args: comp, layer(s), [startTime], [inPoint], [outPoint], [duration] (out = in + duration), [shift] delta for startTime, [stretch] |
| `shiftLayers` | W | Move layers in time together with their keys. args: comp, delta, and layer(s)\|match\|selected\|after (all layers with inPoint >= after), [markers] also shift comp markers >= after, [extendComp] |
| `trimToMarker` | W | Trim in/out to markers. args: comp, layer(s), [inMarker], [outMarker] (index or comment/regex), [layerMarkers] use the layer's own markers, [useEnd] use marker end (duration) |
| `setSwitches` | W | Layer switches. args: comp, layer(s), any of: enabled, solo, locked, shy, threeD, motionBlur, collapse, adjustment, guide, effectsActive, audioEnabled, preserveTransparency, quality(best\|draft\|wireframe), samplingQuality(bicubic\|bilinear), blend, label(0-16), frameBlending(frame_mix\|pixel_motion\|none), autoOrient(none\|along_path\|camera_or_point_of_interest) |
| `setParent` | W | Parent layers. args: comp, layer(s), parent (layer ref or null), [keepTransform=true] (false = jump, no compensation) |
| `setTrackMatte` | W | Track matte. args: comp, layer(s), matte (layer ref) or null to remove, [type=alpha] alpha\|alpha_inverted\|luma\|luma_inverted |
| `setComment` | W | Comment on layer(s) or project item. args: comp + layer(s) \| item, comment, [append] |
| `precompose` | W | Precompose layers. args: comp, layer(s), name, [moveAllAttributes=true], [folder] |
| `sequenceLayers` | W | Place layers one after another. args: comp, layer(s) (in given order), [start] time of first, [overlap=0] seconds (negative = gap), [reverse] |
| `replaceSource` | W | Replace layer source. args: comp, layer(s), item, [fixExpressions=true] |
| `replaceItemUsage` | W | Everywhere in the project, replace layers using item 'from' with item 'to' (e.g. logo placeholder -> real logo). args: from, to, [fixExpressions=true], [dryRun] |
| `selectLayers` |  | Select layers in a comp (UI only). args: comp, layer(s)\|match\|all, [add] keep current selection, [open] open comp in viewer |

## Properties, keyframes, expressions

| Command | W | Description / args |
|---|---|---|
| `setProperty` | W | Set a value (or a key if time given). args: comp, layer(s)\|match\|selected, path, value, [time] |
| `setProperties` | W | Many values at once. args: comp, items:[{layer, path, value, [time]}]  OR  layer(s) + values:{path:value}, [time] |
| `addKeyframes` | W | Add keys. args: comp, layer(s), path, keys:[{t, v, interp, ease:'easy'\|'easyIn'\|'easyOut'\|influence\|[speed,influence], easeIn, easeOut, spatial:'linear'\|'auto'\|'continuous', roving}], [relativeTo] 'in'\|'out' (t relative to layer in/out point), [clear] remove existing keys first |
| `removeKeyframes` | W | Remove keys. args: comp, layer(s), [path\|paths] (default: all keyed props), and [times]\|[range:[t0,t1]]\|[indexes]\|[selectedKeys]\|[all] (default all) |
| `moveKeyframes` | W | Move keys in time. args: comp, layer(s), [path\|paths] (default all keyed props), delta seconds, and optional key filter [range]\|[times]\|[indexes]\|[selectedKeys] |
| `setKeyInterpolation` | W | Interpolation / easing on existing keys. args: comp, layer(s), [path\|paths], key filter ([times]\|[range]\|[indexes]\|[selectedKeys]\|all), interp, ease, easeIn, easeOut, spatial, roving |
| `setExpression` | W | Set expression. args: comp, layer(s)\|match, path, expression, [enabled=true]. Returns expression errors. |
| `removeExpression` | W | Remove expression(s). args: comp, layer(s), [path] (default: all expressions on the layer) |
| `enableExpressions` | W | Enable/disable existing expressions without deleting. args: comp, layer(s), [path], enabled |
| `replaceInExpressions` | W | Find/replace inside expressions. args: find, replace, [regex], [matchCase], [comps\|compMatch\|comp] (default all), [layerMatch], [dryRun] |
| `bakeExpression` | W | Convert expression to keys. args: comp, layer, path, [range:[t0,t1]] (default layer in/out), [step=1] frames, [keepExpression] (disabled, not deleted, default true) |
| `addProperty` | W | Generic: add a property/group into an indexed group (effect, mask, shape item, text animator, selector, layer style...). args: comp, layer(s), parent path (e.g. 'effects', 'contents', 'contents/Group 1/Contents'), matchName, [name], [values:{childPath:value}], [expressions:{childPath:expr}], [index] |
| `removeProperty` | W | Remove an added property (effect, mask, shape group, animator...). args: comp, layer(s), path |
| `reorderProperty` | W | Move a property inside its indexed group. args: comp, layer, path, index |
| `renameProperty` | W | Rename an effect/mask/shape group/animator. args: comp, layer, path, name |
| `setEnabled` | W | Enable/disable an effect, mask, shape group, animator, layer style (eye icon). args: comp, layer(s), path, enabled |
| `separateDimensions` | W | Separate / join dimensions (Position). args: comp, layer(s), [path='position'], separated |
| `addControl` | W | Expression control effect. args: comp, layer, type slider\|angle\|checkbox\|color\|point\|point3d\|layer\|dropdown, name, [value], [items] for dropdown |
| `linkProperty` | W | Link property to another property (usually a control) via expression. args: comp, layer(s), path, source:{comp, layer, path}, [template] e.g. '$ * 2' or 'value + $' ($ = reference) |
| `timeRemap` | W | Time remapping. args: comp, layer(s), [enable=true], [freezeAt] source time to freeze, [keys:[{t,v}]] (t comp time, v source time), [frameBlending] |
| `addToEssentialGraphics` | W | Add properties to Essential Graphics. args: comp (layer's comp), layer, path\|paths, [names] same order, [egComp] target comp (default comp), [templateName] |
| `exportMogrt` | W | Export comp as Motion Graphics template. args: comp, file (.mogrt, inside allowed folders), [overwrite] |

## Effects, masks, text, shapes

| Command | W | Description / args |
|---|---|---|
| `addEffect` | W | Add effect. args: comp, layer(s)\|match, effect (matchName or display name), [name], [values:{param:value}], [expressions:{param:expr}], [index], [listParams=true] |
| `removeEffect` | W | Remove effect(s). args: comp, layer(s), effect (name/matchName/index) \| match regex \| all |
| `toggleEffect` | W | Enable/disable effect(s). args: comp, layer(s), effect \| match, enabled |
| `reorderEffect` | W | Move effect in stack. args: comp, layer, effect, index |
| `copyEffects` | W | Copy effects (values, keys, expressions) from one layer to others, any comp. Custom values (curves, gradients) are skipped - use applyPreset for those. args: comp, layer (source), [effects] names (default all), toComp (default comp), toLayers\|toLayer\|toMatch |
| `addMask` | W | Add mask (layer coords). args: comp, layer(s), rect:[x,y,w,h] \| ellipse:[x,y,w,h] \| vertices/inTangents/outTangents/closed, [mode=add], [inverted], [feather], [opacity], [expansion], [name], [color], [time] |
| `setMask` | W | Modify mask. args: comp, layer, mask (name or index), + any addMask fields |
| `removeMask` | W | Remove mask(s). args: comp, layer(s), mask (name/index) \| all |
| `applyPreset` | W | Apply an animation preset (.ffx). args: comp, layer(s), file |
| `setText` | W | Set text content (keeps style of first character). args: comp, layer(s), text (string or lines[]), [time] (sets a key; without time all keys are changed) |
| `setTextStyle` | W | Whole-layer text style. args: comp, layer(s)\|match\|layerType, style:{font, fontSize, fillColor, applyFill, strokeColor, strokeWidth, applyStroke, strokeOverFill, tracking, leading, autoLeading, baselineShift, horizontalScale, verticalScale, allCaps, smallCaps, fauxBold, fauxItalic, justification left\|center\|right\|full..., boxTextSize, resetCharStyle}, [time] |
| `setCharStyle` | W | Style a range of characters (AE 24.3+). args: comp, layer, ranges:[{start, end, style}] and/or finds:[{find, style, [all=true], [matchCase]}], [time] |
| `replaceText` | W | Find/replace in text layers project-wide, keeping per-character styles (colors/fonts of words). args: find, replace, [regex], [matchCase], [comps\|compMatch\|comp], [layerMatch], [dryRun] |
| `replaceFont` | W | Replace font project-wide, including per-character runs. args: from (PostScript name or regex), to (PostScript name), [regex], [comps\|compMatch], [dryRun] |
| `setTextBox` | W | Resize paragraph (box) text. args: comp, layer(s), size:[w,h], [position:[x,y]] |
| `addTextAnimator` | W | Text animator. args: comp, layer, [name], properties:{opacity\|position\|scale\|rotation\|fillColor\|tracking\|blur\|...\|matchName: value}, [selector:{type range\|wiggly\|expression, values:{Start:0, End:100, Offset:0, 'Advanced/Units':1...}, keys:{path:[{t,v,ease}]}, expression (amount expr for expression selector)}] |
| `addShapeGroup` | W | Add a shape group to a shape layer. args: comp, layer, [parent] path (default contents; a group path is fine), shape spec (type, size, center, vertices, fill, stroke, trim, name, groupPosition...) |
| `addShapeItem` | W | Add shape item/operator. args: comp, layer, [parent] (contents or group path), item: rect\|ellipse\|star\|path\|fill\|stroke\|gradientFill\|gradientStroke\|trim\|repeater\|offset\|wigglePaths\|roundCorners\|merge\|zigzag\|puckerBloat\|twist\|wiggleTransform\|group, [name], [values:{childName:value}], [expressions], [index] |
| `setPathVertices` | W | Set a path (shape path or mask). args: comp, layer, path (to 'Path' property, shape path group, or mask), vertices, [inTangents], [outTangents], [closed], [time] |
| `setGradient` | W | Gradient fill/stroke geometry (colors can NOT be set by scripting - only type/points/highlight). args: comp, layer, path (to Gradient Fill/Stroke), [type] linear\|radial, [start:[x,y]], [end:[x,y]], [highlightLength], [highlightAngle], [opacity] |

## Comps, project, markers, retime, layout, 3D, render, menu, batch

| Command | W | Description / args |
|---|---|---|
| `createComp` | W | Create comp. args: name, [width=1920], [height=1080], [pixelAspect=1], [duration=10], [frameRate=30], [bgColor], [folder], [ifExists] 'error'\|'reuse' (keep as is)\|'clear' (remove layers & markers, keep links) |
| `setCompSettings` | W | Comp settings. args: comp, any of: name, width, height, pixelAspect, duration, frameRate, bgColor, workArea:[start,duration], displayStartTime, motionBlur, shutterAngle, shutterPhase, motionBlurSamplesPerFrame, motionBlurAdaptiveSampleLimit, hideShyLayers, frameBlending, draft3D, renderer, resolutionFactor:[x,y], preserveNestedFrameRate, preserveNestedResolution, dropFrame, motionGraphicsTemplateName, time (CTI), comment, label |
| `duplicateComp` | W | Duplicate comp (not nested comps). args: comp, [name], [folder] |
| `setItem` | W | Rename / comment / label a project item. args: item, [name], [comment], [label] |
| `moveToFolder` | W | Move items to a folder. args: items:[ref...] \| item, folder (name, id or 'A/B/C' path; created if missing), [create=true] |
| `createFolder` | W | Create folder. args: name or path 'A/B' |
| `deleteItem` | W | Remove project item(s) from the project (undoable; files on disk are not touched). Refuses items in use unless force. args: items\|item, [force] |
| `addMarker` | W | Add marker(s) to comp or layer. args: comp, [layer], time + comment/duration/label/chapter/url  OR  markers:[{t, comment, duration, label}] |
| `setMarker` | W | Modify marker(s). args: comp, [layer], select by index\|time\|match\|all, and new: [comment], [duration], [label], [chapter], [url], [newTime] or [shift] |
| `removeMarker` | W | Remove marker(s). args: comp, [layer], index\|time\|match\|all |
| `markersFromFile` | W | Markers from SRT, CSV (time;[duration];comment - separator ; , or tab, header optional) or JSON [{t,comment,duration}]. args: file, comp, [layer], [clear], [offset=0] |
| `retimeByMap` | W | Retime comps by a time map (piecewise linear old->new). Each layer moves so its inPoint = f(in) (keys move with it); [trimOut=true] sets outPoint = f(out); [remapKeys] also re-times keys inside layers; comp & layer markers remapped. Nested comps are NOT retimed automatically. args: map:[[old,new],...], [comps\|comp\|compMatch], [trimOut], [remapKeys], [markers=true], [extendComp], [dryRun] |
| `importFile` | W | Import file(s). args: file \| files[], [as] footage\|comp\|compCroppedLayers\|project, [sequence], [forceAlphabetical], [folder], [name] |
| `importProject` | W | Import another .aep into this project (comes in as a folder). args: file, [folder] |
| `replaceFootage` | W | Replace a footage item's file. args: item, file, [sequence], [forceAlphabetical] |
| `interpretFootage` | W | Interpret footage. args: item, [alphaMode] ignore\|straight\|premultiplied, [premulColor], [invertAlpha], [conformFrameRate], [loop], [fieldSeparation] off\|upper_field_first\|lower_field_first, [removePulldown], [pixelAspect] |
| `setProxy` | W | Proxy. args: item, file \| none:true, [sequence], [useProxy] |
| `cleanupProject` | W | Project cleanup (needs confirm:true). args: action removeUnusedFootage\|consolidateFootage\|reduceProject, [comps] for reduceProject, confirm |
| `openComp` |  | Open comp in viewer (UI). args: comp, [time] set CTI, [workArea:[start,dur]] |
| `saveProject` | W | Save the project to its current file. args: confirm:true |
| `backupProject` | W | Copy the project file to <project folder>/_backup/<name>_<date>.aep. args: [save] save first (default false = copy last saved state), [label] |
| `guides` | W | Comp guides. args: comp, [add:[{orientation:'h'\|'v', position}]], [remove:[index...]\|'all'] |
| `align` | W | Align layers (by visual bounds). args: comp, layer(s), edge left\|hcenter\|right\|top\|vcenter\|bottom, [to] 'comp' (default)\|'selection'\|layer ref\|number (pixel), [time] |
| `distribute` | W | Distribute layers evenly between the outermost ones. args: comp, layer(s) (3+), axis x\|y, [by] center\|gap, [time] |
| `centerAnchor` | W | Move anchor point to content center (or a corner) without visual jump. args: comp, layer(s), [where] center\|topLeft\|top\|topRight\|left\|right\|bottomLeft\|bottom\|bottomRight, [time] |
| `fitToComp` | W | Scale & center layers to the comp. args: comp, layer(s), [mode] fit\|fill\|width\|height\|none (none = only center), [time] |
| `snapToPixel` | W | Round static position and anchor values to whole pixels. args: comp, layer(s) |
| `cameraOptions` | W | Camera options. args: comp, layer, values:{zoom, depthOfField, focusDistance, aperture, blurLevel, or any option name} |
| `lightOptions` | W | Light options. args: comp, layer, [lightType], values:{intensity, color, coneAngle, coneFeather, castsShadows, shadowDarkness, shadowDiffusion, ...} |
| `materialOptions` | W | 3D material options. args: comp, layer(s), values:{castsShadows, lightTransmission, acceptsShadows, acceptsLights, ambient, diffuse, specular, shininess, metal} |
| `lookAt` | W | Aim a camera/light (point of interest) or orient a 3D layer toward a point or layer. args: comp, layer(s), target:[x,y,z] \| targetLayer, [live] use an expression that follows the target |
| `renderer3D` | W | Comp 3D renderer. args: comp, renderer classic\|cinema4d\|advanced\|<internal name> |
| `motionBlurSettings` | W | Motion blur. args: comp, [enabled] comp switch, [shutterAngle], [shutterPhase], [samplesPerFrame], [adaptiveLimit], [layers\|match\|all] + [layerMotionBlur] bool |
| `addToRenderQueue` | W | Add comp to Render Queue (does not render). args: comp, file (output, allowed folders), [renderTemplate], [outputTemplate], [range:[start,end]] or [workArea=true] |
| `clearRQ` | W | Remove render queue items. args: [onlyDone] \| [indexes] |
| `startRender` | W | Render the whole queue now (blocks AE until done). args: confirm:true |
| `queueInAME` | W | Send queued items to Adobe Media Encoder. args: [render] start immediately |
| `renderPreview` | W | Quick H.264 preview of a range (blocks AE while rendering; other queue items are kept but skipped). args: comp, [range:[start,end]] (default work area), [file], [half=true] half resolution |
| `menuCommand` | W | Run a whitelisted AE menu command on selected layers. args: command (undo\|createShapesFromText\|createShapesFromVectorLayer\|createMasksFromText\|layerStyleDropShadow\|...Stroke\|convertAudioToKeyframes\|convertToEditableText\|incrementAndSave), [comp], [layer(s)] to select first |
| `audioToKeyframes` | W | Analyze audio layer(s): creates 'Audio Amplitude' null (via menu) and reports pauses. args: comp, layer(s), [silence=2] amplitude threshold, [minGap=0.25] s, [keep=false] keep the null layer |
| `purgeCache` |  | Purge AE caches. args: [target] all_caches\|undo_caches\|snapshot_caches\|image_caches |
| `batch` |  | Run several commands in order as ONE undo step. Stops at first error. args: commands:[{command, args}], [undoName] |


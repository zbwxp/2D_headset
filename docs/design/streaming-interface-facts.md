# How streaming avatar tools describe their control interface (facts, 2026-10-10)

For Q32 (bowen 1791618706: "这个应该在那些直播软件里有非常规范的接口描述吧？这个你们查一下。").

Claude opened each page; short quotes only. These are facts about other tools, not rules for ours.

## Live2D: Standard Parameter List

Source: docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/ (updated 08/26/2021).

- **Purpose:** "Common parameters for use make it easy to replace, reuse, etc."
- **Principle:** "The eyes and mouth should be set to 0 when normally closed and 1 when normally open." Wider or tighter extremes go outside that range in steps of 0.1.
- **Each parameter has:** name, ID, minimum, default, maximum, and the direction of +.

| ID | Min / default / max | + means |
|---|---|---|
| `ParamAngleX` | −30 / 0 / 30 | face turns to screen right. "To rotate a head more than -30 to 30, set -45 to 45, etc." |
| `ParamAngleY` | −30 / 0 / 30 | face turns up |
| `ParamAngleZ` | −30 / 0 / 30 | head tilts to screen right |
| `ParamEyeLOpen` / `ParamEyeROpen` | 0 / 1 / 1 | eye open |
| `ParamEyeLSmile` / `ParamEyeRSmile` | 0 / 0 / 1 | smiling eye |
| `ParamEyeBallX` / `ParamEyeBallY` | −1 / 0 / 1 | look right / up |
| `ParamBrowLY`, `…RY`, `…LX`, `…RX`, `…LAngle`, `…RAngle`, `…LForm`, `…RForm` | −1 / 0 / 1 | brow up, apart, angle, shape |
| `ParamMouthForm` | −1 / 0 / 1 | smiling mouth (+), angry mouth (−) |
| `ParamMouthOpenY` | 0 / 0 / 1 | mouth open |
| `ParamCheek` | 0 / as appropriate / 1 | blush |
| `ParamBodyAngleX/Y/Z` | −10 / 0 / 10 | body turn / up / tilt |
| `ParamBreath` | 0 / 0 / 1 | breathe in |

## Apple ARKit: face blend shapes (the usual face-tracking input)

Source: developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation.

- **Value:** each coefficient is "the current position of that feature relative to its neutral configuration, ranging from 0.0 (neutral) to 1.0 (maximum movement)".
- **52 coefficients:**
  - eyes: blink, look down / in / out / up, squint, wide, each side;
  - jaw: forward, left, right, open;
  - mouth: close, funnel, pucker, left, right, smile, frown, dimple, stretch, roll, shrug, press, lower down, upper up;
  - brows: down, inner up, outer up;
  - cheek: puff, squint;
  - nose: sneer;
  - tongue: out.
- **Use as few as you like:** "you might animate a simple cartoon character using only the jawOpen, eyeBlinkLeft, and eyeBlinkRight coefficients."
- **Sides:** left / right are the face's own sides.
- **Head angle is not a blend shape.** It comes from the face anchor's position and orientation (from memory; not on this page).

## VTube Studio: public API (a common Live2D streaming app)

Source: github.com/DenchiSoft/VTubeStudio (README).

- **Tracking parameters are input; the model has its own Live2D parameters; the user maps one to the other.**
  - Each input parameter is `{name, value, min, max, defaultValue}` (e.g. `FaceAngleX` −30…30, `FacePositionX` −10…10).
  - Plugins may add custom input parameters, and "the user can select your parameters as inputs for Live2D parameter mappings".
- **Feeding values:** `InjectParameterDataRequest` with `parameterValues: [{id, value, weight?}]`.
  - API values override webcam / phone tracking while they keep coming.
  - A parameter must be re-sent at least once a second, otherwise it is "lost" and returns to its previous controller or its default.

## Corrections (dot 1791618872, accepted by Claude 1791618906)

- **Live2D's table is a model-parameter convention** (meanings, ranges, defaults). It is not a model file format or a communication protocol. Using the same names does **not** let existing streaming software drive our models directly.
- **`InjectParameterDataRequest` feeds data into VTube Studio** to drive models inside VTS. VTS does not send data to our vector model. Connecting our player needs an adapter.
- **The sensible boundary:** face-tracking source → parameter adapter → model playback.
  - The adapter converts names, directions, ranges and calibration.
  - It can be our own separate module; it need not live in streaming software.
  - The model knows only its own parameters (angle, eye open, smile…).
- **A streaming interface only says "the eye is this much closed now".** It does not say how motion assets are stored or stacked. It helps define the outside interface, not the storage questions.
- **Widening angles from ±30 to ±90** does not make tracked angle values map one-to-one onto ours.

## What this suggests for us (Claude's first reading, as corrected above)

1. **Expose dials like Live2D's.** Our dials (angle, blink, smile…) correspond to model parameters: id, min, default, max, direction.
   - Live2D's standard ids and ranges are a useful naming reference. Reaching existing software still needs an adapter (see the corrections above).
   - Our ±90° yaw / pitch is a wider range of the same kind; Live2D itself allows widening.
2. **Keep the mapping outside the model**, in an adapter (ours or another app's). VTube Studio maps tracking input to model parameters in the app, not in the model. A face tracker (ARKit's 52 values, 0 = neutral) or an animation only supplies numbers.
3. **ARKit's values match our motion meaning.** They are relative to neutral (0) and run to the maximum (1), which matches "a motion is a change relative to a base".
4. **The boundary of the model is a parameter list plus "give values, get a picture".** Everything inside (angle recordings, motion recordings, assembly) is ours.

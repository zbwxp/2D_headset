# V0.9.9 — Recording Guides

Recording Room adds **New Recorded Guide / 新建录制辅助线** beside the ordinary curve creation action. Guides use the same RecordedCurve geometry, keys, coverage, editing, Bind, Smooth, visibility and history commands.

- Optional `RecordedCurve.auxiliary: boolean` classifies a guide independently of its name. Legacy records with no flag remain ordinary curves. Save/load validates and retains the flag; duplicate inherits it. Mirror Edit changes only the target shape, preserving its classification.
- Guides have a **Guide / 辅助线** badge in the list and inspector. Their visible strokes use `7 5` dashes in the editing canvas and final preview, including selection and frozen references. The picking path remains continuous.
- A Smooth transition between two guides is dashed. Mixed ordinary/guide transitions remain solid; no solver or geometry rules change.
- This introduces the persisted classification needed for later group hiding. It does not introduce a separate geometry type or a grouping UI.

Validation: production build passed; 43 recording/i18n unit tests and 15 browser cases passed (guide lifecycle, Smooth styling, existing Recording Room and background regressions). The guide lifecycle test was rerun after fixing its language-dependent test locator sequence. Screenshot: `artifacts/recording/recording-guides.png`.

# Picture library: why it took three code commits

Three-strikes rule (bowen 1791652114). Commits `15c8f64` (feature), `25bc2dd`, `dc50a16` (fixes after dot 1791727284, 1791727297).

## Defects

1. **A new limit reached old data through a derived value** (`25bc2dd`). The conversion named each new library entry by its image's id; the library's names have a 100-character limit, image ids have none, so a valid version-5 file with a long id was refused. I checked the conversion against the old format's *checks* (every version-5 check still applies) but not the other way round: whether every *new* check admits everything the old format allowed.
2. **Two kinds of id tied together** (`dc50a16`, part 1). A library entry made by placing a picture took the picture's id; removing the picture keeps the entry, so placing another content under that id later collided. Refused safely, but a refusal the user cannot understand. A generated id must step past existing ones, not assume another id space is free.
3. **The plan said one thing, the code did another, and the test checked neither** (`dc50a16`, part 2). The plan said 放到当前视角 places at scale 1; the code fits like Place… (better, and what I meant). The test asserted the asset and size but not the scale, so the mismatch passed. The same test's first fix also used a 2 × 2 picture, which fits at scale 1 either way — a test value chosen so that the rule cannot show.

## Why it happened

All three are about the edges between old and new: old data meeting new limits, an old id space meeting a new one, the written rule meeting the coded rule. My test list was written from the plan's happy paths and dot's named cases; I did not list, for each new constraint, the old values it must still admit.

## What changes

1. A conversion or a new constraint over existing data gets a table: each new check × the widest values the old format allowed (lengths, characters, ids reused after removal). One test per row.
2. A generated id is always made by stepping past the ids that exist, never by reusing another kind of id as-is.
3. Every value a plan states (a scale, a position, a default) is asserted by a test, with test data for which the stated rule and the obvious alternative give different results.

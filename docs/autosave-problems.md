# Autosave: why the handover took three code commits

Asked by dot 1791706102 (three-strikes rule, bowen 1791652114). Code commits `f48d571`, `20a3d8d`, `844ccd3` (plus the test `e7c3265`).

## Defects

1. **"Not writing" was taken to mean "the disk can be restored"** (`20a3d8d`; dot 1791705517, 1791705686). The handover asked one question, "is the previous instance still using the store?", and let the new instance restore once the answer was no. A write that *failed* also answers no, but then the disk holds an older text (B) while the page holds the newer one (C), and restoring B loses C. Two different conditions were merged into one:
   - **the store is free** (no read, backup or write in flight): needed so two instances never use it at once;
   - **the disk holds the newest text**: needed before restoring from it.
   A failure gives the first without the second. Now a failed newest text is handed over instead of restored over (`844ccd3`).
2. **The barrier covered the save queue only** (`20a3d8d`; dot 1791705686). The restore read and the backup of an unreadable save run in `start`, and I did not think of them as "using the store", so a new instance could read or back up while the old one's read or backup was still running. Now every store operation of an instance is counted by one barrier.
3. **The handover was a pair, not a chain** (`20a3d8d`; dot 1791705540, 1791705686). Each instance checked only its own state, so an instance still waiting for its predecessor looked idle and let a third one through. Now an instance is idle only when its predecessor is, and a leftover text is passed down the chain.

## Why the first tests saw none of this

4. **I tested the case that was reported, not the cases around it.** dot 1791705181 described B writing and C queued, ending in success; I wrote exactly that test with two instances and stopped. The handover has three dimensions, and I covered one corner of them:
   - what the previous instance is doing: restore read, backup, writing, queued, waiting in `start`;
   - how its last operation ends: lands or fails;
   - how many instances: two, or three with one in between (dropped, or still waiting).
   This repeats reference pictures round one, item 4 (`docs/reference-images-problems.md`): the success path tested, the failing variant not.

## The handover now, case by case (each a test in `autosave/test/autosave.test.ts`)

| previous instance | its last operation | new instance |
| --- | --- | --- |
| writing B | lands | waits, restores B, writes nothing |
| writing B, C queued | both land | waits for C, restores C |
| C queued after B | C fails | does not restore B; keeps C, says so, writes C |
| restore read in flight | returns | reads only after it; the old one applies nothing |
| backup in flight | lands | backs up only after it; the old one writes no CURRENT |
| writing B, a second instance dropped in between | lands | waits, restores B |
| writing B, a second instance still waiting in `start` | lands / fails | waits for the first; restores B / is handed B |
| C failed, a second instance never started | — | is handed C through the second |
| autosave off (read failed), then D drawn | — | keeps D, stays off with the reason; reads and writes nothing |
| autosave off (backup failed), then D drawn, a second instance never started | — | same, through the second; the unreadable save untouched |
| autosave off, nothing drawn since | — | starts normally (reads, restores) |

5. **A fourth commit, same root** (dot 1791706297): with autosave off, the drawing is never "wanted", so nothing drawn after it went off was handed over, and a new instance could restore the old disk over it. Handing it over as a failed text would be wrong too: it would be written, bypassing "a failed read or backup never overwrites the saved drawing". It is now handed over with the reason, and the new instance stays off. The case table above was still built from the queue's states and missed the off state; the rows now include it.

## What changes

1. A guard that protects a shared resource covers **every** operation on it, listed before code, not only the path being fixed.
2. "Resource free" and "data current" are separate conditions and are checked separately.
3. A handover or ordering rule is written as a case table (states × outcomes × chain length) in the plan before code, and each row becomes a test; a reported case is one row, never the whole test.
4. Until dot accepts, bowen is told to refresh only while the status line shows "saved".

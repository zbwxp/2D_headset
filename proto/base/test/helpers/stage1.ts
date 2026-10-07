// The stage-1 sample files are in the format BEFORE doc 18 §29 I-1 (rule records, rule / author expression keys).
// Tests that work on the CURRENT records open them as that older version, so the schema-3 conversion
// (contour.document/2, expressionMigration.ts) runs exactly as for any old file.
import { readFileSync } from 'node:fs'
import { Editor } from '../../src/editor'

export const BEFORE_I1 = { schemaVersion: 2, sequences: { 'contour.document': 1 } }
export const rawSample = (file = 'stage1-valid.json'): any[] => JSON.parse(readFileSync(`test/fixtures/${file}`, 'utf8')).records
/** the sample converted to the current format, as plain (unfrozen) records */
export const converted = (file = 'stage1-valid.json'): any[] =>
  structuredClone(Editor.open({ store: Object.fromEntries(rawSample(file).map((r) => [r.id, r])), schema: BEFORE_I1 } as any).reader.allRecords()) as any[]

const EYE = ['curve:lid', 'curve:lowerLid']
/**
 * Character K without the data an I-1 expression state cannot carry yet (fine-tune, line and node takeovers on the eye
 * curves — carried by domains / line correspondence in I-2) and without its converted expression fix (computed from
 * that data). The blink of this K plays from the presets' keyframes.
 */
export function eyePlain(rs: any[]): any[] {
  const k = rs.find((r) => r.id === 'character:K')
  for (const c of EYE) delete k.fineTune[c]
  const eyeConn = new Set(rs.filter((r) => r.typeName === 'connection' && r.ends.some((e: any) => EYE.includes(e.curveId))).map((r) => r.id))
  k.takeovers = k.takeovers.filter((t: any) => (t.kind === 'line' ? !EYE.includes(t.curveId) : !eyeConn.has(t.connectionId)))
  k.exprFixes = []
  return rs
}

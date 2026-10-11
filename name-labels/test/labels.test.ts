// name-labels/ (docs/name-labels-plan.md; dot 1791732110): the labels for a selection and a kind; no imports.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { labelsFor, middleOf } from '../index'

const L = (id: string, x: number) => ({ id, name: `线${id}`, mid: { x, y: 0 } })
const lines = [L('a', 1), L('b', 2), L('c', 3), L('d', 4), L('solo', 9)]
const curves = [{ id: 'g4', name: '四线曲线', lines: ['a', 'b', 'c', 'd'] }, { id: 'g1', name: '单线曲线', lines: ['solo'] }]

describe('labelsFor', () => {
  it('line kind: one label per selected line, its name at its middle; repeats and unknown ids ignored', () => {
    expect(labelsFor(lines, curves, ['c', 'a', 'c', 'nope'], 'line')).toEqual([{ key: 'line:c', text: '线c', at: { x: 3, y: 0 } }, { key: 'line:a', text: '线a', at: { x: 1, y: 0 } }])
  })
  it('curve kind: one label per curve touched, at its middle line — the earlier middle one for an even count (index ⌊(n − 1) / 2⌋)', () => {
    expect(labelsFor(lines, curves, ['d'], 'curve')).toEqual([{ key: 'curve:g4', text: '四线曲线', at: { x: 2, y: 0 } }])
    expect(labelsFor(lines, [{ id: 'g3', name: 'x', lines: ['a', 'b', 'c'] }], ['a'], 'curve')[0]!.at).toEqual({ x: 2, y: 0 })
  })
  it('a curve of one line: the line\'s name with line kind, the curve\'s name with curve kind', () => {
    expect([labelsFor(lines, curves, ['solo'], 'line')[0]!.text, labelsFor(lines, curves, ['solo'], 'curve')[0]!.text]).toEqual(['线solo', '单线曲线'])
  })
  it('nothing selected, or only ids not drawn here: no labels', () => {
    expect([labelsFor(lines, curves, [], 'line'), labelsFor(lines, curves, ['gone'], 'curve')]).toEqual([[], []])
  })
  it('middleOf: a cubic at t = ½', () => {
    expect(middleOf([{ x: 0, y: 0 }, { x: 0, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 0 }])).toEqual({ x: 4, y: 6 })
  })
  it('imports nothing', () => {
    expect(readFileSync(join(__dirname, '..', 'index.ts'), 'utf8')).not.toMatch(/^import /m)
  })
})

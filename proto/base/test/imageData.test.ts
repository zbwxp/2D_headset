// The structure of an embedded picture (src/imageData.ts; review of 4a208bc D2): decoding alone accepted a truncated
// PNG body and a GIF labelled image/png.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { imageDataProblem } from '../src/imageData'
import { Image } from '../src/schema'
import { validateRecord } from '../src/schema'

const bytes = (f: string) => new Uint8Array(readFileSync(`e2e/fixtures/${f}`))
const dataUrl = (f: string, type: string) => `data:image/${type};base64,${readFileSync(`e2e/fixtures/${f}`).toString('base64')}`

describe('imageDataProblem', () => {
  it('whole PNG / JPEG / WebP pictures pass', () => {
    expect(imageDataProblem('png', bytes('ref-small.png'))).toBeNull()
    expect(imageDataProblem('png', bytes('ref-matrix.png'))).toBeNull()
    expect(imageDataProblem('jpeg', bytes('generated.jpg'))).toBeNull()
    expect(imageDataProblem('webp', bytes('generated.webp'))).toBeNull()
  })
  it("dot's truncated PNG (IDAT declares 100 bytes, 24 are there) is refused", () => {
    expect(imageDataProblem('png', bytes('bad-body.png'))).toMatch(/截断/)
  })
  it('a GIF labelled PNG, or one format declared as another, is refused', () => {
    expect(imageDataProblem('png', bytes('gif-as-png.png'))).toMatch(/文件头不符/)
    expect(imageDataProblem('jpeg', bytes('ref-small.png'))).toMatch(/文件头不符/)
    expect(imageDataProblem('webp', bytes('generated.jpg'))).toMatch(/文件头不符/)
  })
  it('a flipped byte inside a PNG chunk is refused (its CRC); a cut JPEG / WebP is refused', () => {
    const png = bytes('ref-small.png').slice()
    png[40] ^= 0xff
    expect(imageDataProblem('png', png)).toMatch(/损坏|截断/)
    const jpg = bytes('generated.jpg')
    expect(imageDataProblem('jpeg', jpg.slice(0, jpg.length - 10))).toMatch(/截断/)
    const webp = bytes('generated.webp')
    expect(imageDataProblem('webp', webp.slice(0, webp.length - 10))).toMatch(/截断/)
  })
  it('the record validator refuses a src whose bytes are not the declared format (signature)', () => {
    const rec = (src: string) => Image.create({ id: Image.createId('x'), name: 'x', parentId: 'container:L' as any, src, width: 1, height: 1, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } })
    expect(() => validateRecord(rec(dataUrl('gif-as-png.png', 'png')))).toThrow()
    expect(() => validateRecord(rec(dataUrl('generated.jpg', 'png')))).toThrow()
    expect(() => validateRecord(rec(dataUrl('generated.jpg', 'jpeg')))).not.toThrow()
  })
})

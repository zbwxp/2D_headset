// A minimal binary glTF (.glb / .vrm) reader for a head shell (bowen 1792508212: a 捏脸 head from e.g. VRoid Studio):
// the meshes' triangle lists (POSITION + indices, every primitive), named by mesh / node, positions in the mesh's own
// space. Browser- and node-safe (takes an ArrayBuffer). Skins, morphs and materials are ignored.
export interface ShellPart { name: string; material: string; positions: Float32Array; indices: Uint32Array; normals?: Float32Array }

export function readGlb(buf: ArrayBuffer): ShellPart[] {
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb file')
  let off = 12, json: any, bin: DataView | undefined, binOff = 0
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)))
    else if (type === 0x004e4942) { bin = new DataView(buf, off + 8, len); binOff = off + 8 }
    off += 8 + len
  }
  if (!json || !bin) throw new Error('glb without JSON or BIN chunk')
  const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
  const read = (ai: number): number[] => {
    const a = json.accessors[ai], v = json.bufferViews[a.bufferView], n = SIZE[a.type]!, stride = v.byteStride ?? n * ({ 5126: 4, 5125: 4, 5123: 2, 5121: 1 } as Record<number, number>)[a.componentType]!
    const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), out: number[] = []
    for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
      const o = base + i * stride
      out.push(a.componentType === 5126 ? bin!.getFloat32(o + k * 4, true) : a.componentType === 5125 ? bin!.getUint32(o + k * 4, true) : a.componentType === 5123 ? bin!.getUint16(o + k * 2, true) : bin!.getUint8(o + k))
    }
    return out
  }
  void binOff
  const parts: ShellPart[] = []
  ;(json.meshes ?? []).forEach((m: any, mi: number) => m.primitives.forEach((p: any, pi: number) => {
    if (p.attributes?.POSITION === undefined || (p.mode ?? 4) !== 4) return
    const pos = read(p.attributes.POSITION), idx = p.indices !== undefined ? read(p.indices) : pos.map((_, i) => i).filter(i => i < pos.length / 3)
    parts.push({ name: `${m.name ?? `mesh${mi}`}#${pi}`, material: json.materials?.[p.material]?.name ?? '', positions: new Float32Array(pos), indices: new Uint32Array(idx), ...(p.attributes.NORMAL !== undefined ? { normals: new Float32Array(read(p.attributes.NORMAL)) } : {}) })
  }))
  return parts
}

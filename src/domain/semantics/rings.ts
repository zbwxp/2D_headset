import type { SemanticRing } from "../project/types";
export function defaultRings(segments = 32, rows = 32): SemanticRing[] {
  const layers: [string, string, number, string][] = [
    ["cranial", "颅顶", 7, "#9fbfa9"],
    ["brow", "眉弓", 12, "#c8be8a"],
    ["cheek", "脸颊", 16, "#bdcdec"],
    ["muzzle", "口鼻区域", 20, "#bba3d0"],
    ["jaw", "下颌", 23, "#b9eb9f"],
    ["chin", "下巴", 27, "#e0ad96"],
    ["neck", "颈部连接", 29, "#90bac7"],
  ];
  const rings = layers.map(([kind, label, row, color]) => ({
    id: `${kind}_ring`,
    kind,
    label,
    color,
    closed: true,
    editable: true,
    samples: Array.from({ length: segments }, (_, j) => ({
      vertexId: 1 + (row - 1) * segments + j,
      u: j / segments,
    })),
  }));
  rings.push({
    id: "midline_curve",
    kind: "midline",
    label: "正中线",
    color: "#ffc879",
    closed: false,
    editable: false,
    samples: [
      { vertexId: 0, u: 0 },
      ...Array.from({ length: rows - 1 }, (_, i) => ({
        vertexId: 1 + i * segments + segments / 4,
        u: (i + 1) / rows,
      })),
      { vertexId: 1 + (rows - 1) * segments, u: 1 },
    ],
  });
  return rings;
}

# Generates the stage-1 archive samples (valid + invalid) with every coordinate written out.
# Run: python3 make_stage1.py   (writes stage1-valid.json, stage1-invalid-missing.json)
import json, copy

def V(x, y): return {"x": round(x, 6), "y": round(y, 6)}
def A(x, y, hix, hiy, hox, hoy):  # absolute control points (new data)
    return {"p": V(x, y), "hIn": V(x + hix, y + hiy), "hOut": V(x + hox, y + hoy)}

def lid(k, dx=0.0, dy=0.0):          # upper lid a, m, b
    return {"a": A(-10 + dx, 0 + dy, 0, 0, 3, -4 * k), "m": A(0 + dx, -4 * k + dy, -5, 0, 5, 0), "b": A(10 + dx, 0 + dy, -3, -4 * k, 0, 0)}
def lower(k, dx=0.0, dy=0.0):        # lower lid c, n, d (c↔a, n↔m, d↔b; d coincides with b: shared eye corner)
    return {"c": A(-10 + dx, 0 + dy, 0, 0, 3, 2 * k), "n": A(0 + dx, 2 * k + dy, -5, 0, 5, 0), "d": A(10 + dx, 0 + dy, -3, 2 * k, 0, 0)}
def strand(dx=0.0):
    return {"u": A(30 + dx, -2, 0, 0, 2, 3), "w": A(32 + dx, 10, -1, -3, 0, 0)}
def closed(shape_lower, k_up):  # an author's closed upper lid: on the lower lid, the middle slightly lifted; the
    # corners stay ON the lower lid's corners (shared endpoint: one logical position per node and state, §17)
    lift = {"a": 0, "m": 0.3 * k_up, "b": 0}
    return {a: {h: V(shape_lower[l][h]["x"], shape_lower[l][h]["y"] - (lift[a] if h == "p" or a == "m" else 0)) for h in ("p", "hIn", "hOut")} for a, l in (("a", "c"), ("m", "n"), ("b", "d"))}

def rel(x, y, hix, hiy, hox, hoy, i):  # curve record anchors: handles RELATIVE (existing convention)
    return {"id": i, "p": V(x, y), "hIn": V(hix, hiy), "hOut": V(hox, hoy)}

curve_common = {"typeName": "curve", "parentId": "container:L1", "closed": False, "depthOffset": 0, "tags": []}
recs = [
    {"typeName": "container", "id": "container:L1", "name": "眼", "parentId": None, "index": "a1", "visible": True, "locked": False, "opacity": 1, "tags": []},
    {"typeName": "container", "id": "container:L3", "name": "旧下颌（迁移示例）", "parentId": None, "index": "a2", "visible": True, "locked": False, "opacity": 1, "tags": []},
    {**curve_common, "id": "curve:lid", "name": "上眼睑", "index": "a1",
     "anchors": {"a": rel(-10, 0, 0, 0, 3, -4, "a"), "m": rel(0, -4, -5, 0, 5, 0, "m"), "b": rel(10, 0, -3, -4, 0, 0, "b")},
     "segments": [{"id": "s1", "from": "a", "to": "m"}, {"id": "s2", "from": "m", "to": "b"}], "stroke": {"color": "#000", "width": 2}},
    {**curve_common, "id": "curve:lowerLid", "name": "下眼睑", "index": "a2",
     "anchors": {"c": rel(-10, 0, 0, 0, 3, 2, "c"), "n": rel(0, 2, -5, 0, 5, 0, "n"), "d": rel(10, 0, -3, 2, 0, 0, "d")},
     "segments": [{"id": "s3", "from": "c", "to": "n"}, {"id": "s4", "from": "n", "to": "d"}], "stroke": {"color": "#000", "width": 1.5}},
    {**curve_common, "id": "curve:strand", "name": "侧发", "index": "a3",
     "anchors": {"u": rel(30, -2, 0, 0, 2, 3, "u"), "w": rel(32, 10, -1, -3, 0, 0, "w")},
     "segments": [{"id": "t1", "from": "u", "to": "w"}], "stroke": {"color": "#000", "width": 1.5}},
    {**curve_common, "id": "curve:C1", "name": "旧下颌线", "parentId": "container:L3", "index": "a1",
     "anchors": {"a1": rel(0, 0, 0, 0, 5, 5, "a1"), "a2": rel(20, 10, -5, 0, 5, 0, "a2")},
     "segments": [{"id": "j1", "from": "a1", "to": "a2"}], "stroke": {"color": "#000", "width": 2}},
    {"typeName": "connection", "id": "connection:corner", "ends": [{"curveId": "curve:lid", "anchorId": "b"}, {"curveId": "curve:lowerLid", "anchorId": "d"}], "geometricJoin": "corner"},
    {"typeName": "reference", "id": "reference:R1", "name": "镜像下颌", "parentId": "container:L1", "index": "a9", "sourceId": "container:L3",
     "transform": {"a": -1, "b": 0, "c": 0, "d": 1, "e": 60, "f": 0}, "overrides": {"curve:C1#a2": V(21, 10)}},

    # A: family (curve membership: the ONLY authority) and presets (preset membership: preset.familyId is the ONLY authority)
    {"typeName": "family", "id": "family:eye", "name": "眼型", "curves": ["curve:lid", "curve:lowerLid", "curve:strand"]},
    {"typeName": "preset", "id": "preset:P", "familyId": "family:eye", "name": "杏眼"},
    {"typeName": "preset", "id": "preset:Q", "familyId": "family:eye", "name": "圆眼"},
]

def forms(preset, curve, original, yaw, expr):
    return {"typeName": "forms", "id": f"forms:{preset}/{curve}", "curveId": curve, "owner": {"kind": "preset", "id": preset},
            "encoding": "absolute", "original": original, "yaw": [{"yaw": y, "shape": s} for y, s in yaw], "expr": expr}

P_lower = {-60: lower(0.9, -4), 0: lower(1.1), 90: lower(0.7, 5)}
P_lid = {-60: lid(0.9, -4), 0: lid(1.1), 90: lid(0.7, 5)}
Q_lower = {0: lower(1.4), 45: lower(1.2, 2)}
Q_lid = {0: lid(1.4), 45: lid(1.2, 2)}
blink_rule = lambda low: {a: copy.deepcopy(low[l]) for a, l in (("a", "c"), ("m", "n"), ("b", "d"))}  # lidClose v1: upper := lower (by the rule's correspondence)
recs += [
    forms("preset:P", "curve:lid", lid(1), sorted(P_lid.items()),
          {"blink": [{"yaw": 0, "kind": "author", "target": closed(P_lower[0], 1), "base": blink_rule(P_lower[0]), "ruleVersion": 1},
                     {"yaw": 90, "kind": "rule"}]}),
    forms("preset:P", "curve:lowerLid", lower(1), sorted(P_lower.items()), {}),
    forms("preset:P", "curve:strand", None, [(90, strand(5))], {}),
    forms("preset:Q", "curve:lid", lid(1.3), sorted(Q_lid.items()), {"blink": [{"yaw": 45, "kind": "rule"}]}),
    forms("preset:Q", "curve:lowerLid", lower(1.3), sorted(Q_lower.items()), {}),
    forms("preset:Q", "curve:strand", None, [(90, strand(4))], {}),
    # B: rule binding + version; point correspondence for every anchor of the upper lid
    {"typeName": "rule", "id": "rule:eye/blink", "familyId": "family:eye", "param": "blink", "kind": "lidClose", "version": 1,
     "roles": {"upper": "curve:lid", "lower": "curve:lowerLid"}, "correspondence": {"a": "c", "m": "n", "b": "d"}},
    # B: helper domains — one per preset and per non-zero key yaw (initialisation / rebuild only)
    {"typeName": "helperDomain", "id": "helperDomain:P/-60", "presetId": "preset:P", "yaw": -60, "affine": {"a": 0.9, "b": 0, "c": 0, "d": 0.95, "e": -4, "f": 0}, "source": {"yaw": 0}, "target": {"yaw": -60}, "ruleVersion": 1},
    {"typeName": "helperDomain", "id": "helperDomain:P/90", "presetId": "preset:P", "yaw": 90, "affine": {"a": 0.42, "b": -0.07, "c": 0.11, "d": 0.9, "e": 5, "f": 0}, "source": {"yaw": 0}, "target": {"yaw": 90}, "ruleVersion": 1},
    {"typeName": "helperDomain", "id": "helperDomain:Q/45", "presetId": "preset:Q", "yaw": 45, "affine": {"a": 0.8, "b": 0, "c": 0, "d": 0.97, "e": 2, "f": 0}, "source": {"yaw": 0}, "target": {"yaw": 45}, "ruleVersion": 1},
]
# C: character (its targets live ONLY here; there are no character-owned forms)
front_lid = {a: {h: V(0.6 * P_lid[0][a][h]["x"] + 0.4 * Q_lid[0][a][h]["x"], 0.6 * P_lid[0][a][h]["y"] + 0.4 * Q_lid[0][a][h]["y"]) for h in ("p", "hIn", "hOut")} for a in "amb"}
# the character's neutral lower lid at 90 when the closed-eye fix was made: its corner sits on the node takeover target
char_lower_90 = {a: {h: V(v["x"] + 0.5, v["y"] - 0.4) for h, v in hs.items()} for a, hs in P_lower[90].items()}
fix_target_90 = {a: {h: V(v["x"] + 0.5, v["y"] - 0.4) for h, v in hs.items()} for a, hs in P_lid[90].items()}
recs.append({"typeName": "character", "id": "character:K", "familyId": "family:eye", "name": "角色 K",
    "weights": {"preset:P": 0.6, "preset:Q": 0.4},
    "fineTune": {"curve:lid": {"m": {"dp": V(0, -0.8), "dIn": V(0.3, -0.8), "dOut": V(-0.3, -0.8)}}},
    "takeovers": [
        {"kind": "line", "id": "takeover:lid@90", "curveId": "curve:lid", "state": {"yaw": 90}, "direction": {"from": 0, "to": 90},
         "target": fix_target_90, "basisFront": front_lid, "L": [0.42, -0.07, 0.11, 0.9]},
        {"kind": "node", "id": "takeover:corner@90", "connectionId": "connection:corner", "state": {"yaw": 90}, "direction": {"from": 0, "to": 90},
         "target": V(15.5, -0.4), "basisFront": V(10, 0), "L": [0.42, -0.07, 0.11, 0.9], "basisFrom": "takeover:lid@90"}],
    "exprFixes": [
        {"id": "exprFix:lid@90/blink", "curveId": "curve:lid", "state": {"yaw": 90, "blink": 1},
         "target": closed(char_lower_90, 0.5), "base": blink_rule(char_lower_90), "ruleVersion": 1}]})
recs += [
    {"typeName": "visibility", "id": "visibility:preset:P/curve:strand", "curveId": "curve:strand", "owner": {"kind": "preset", "id": "preset:P"}, "mode": "step", "keys": [{"yaw": -90, "visible": False}, {"yaw": 30, "visible": True}]},
    {"typeName": "visibility", "id": "visibility:preset:Q/curve:strand", "curveId": "curve:strand", "owner": {"kind": "preset", "id": "preset:Q"}, "mode": "step", "keys": [{"yaw": -90, "visible": False}, {"yaw": 40, "visible": True}]},
    # migrated legacy yaw track (the ONLY legacy-delta data): old offsets as stored, missing = 0
    {"typeName": "forms", "id": "forms:document/curve:C1", "curveId": "curve:C1", "owner": {"kind": "document"},
     "encoding": "legacy-delta", "original": "curve", "yaw": [{"yaw": -30, "offsets": {"a1": V(-2, 1)}}, {"yaw": 45, "offsets": {"a1": V(3, 0.5), "a2": V(4, 0)}}], "expr": {}},
]
doc = {"schema": {"contour": 2}, "records": recs}
open("stage1-valid.json", "w").write(json.dumps(doc, ensure_ascii=False, indent=1))
bad = copy.deepcopy(doc)
for r in bad["records"]:
    if r["id"] == "forms:preset:Q/curve:strand":
        r["original"] = None; r["yaw"] = []   # identity only: with weight 0.4 the blend must REPORT missing
open("stage1-invalid-missing.json", "w").write(json.dumps(bad, ensure_ascii=False, indent=1))
print(len(recs), "records")

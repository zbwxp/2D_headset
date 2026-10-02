"""Rebuild the scene starter from the unchanged original source assets."""
import copy
import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

root = Path(__file__).resolve().parents[2]
asset = root / 'src/assets'
starter = json.loads((asset / 'three-piece-starting-example.json').read_text())
front = json.loads((asset / 'hairless-symmetric-two-face-mirror.json').read_text())
source = starter['drawing']
rig = starter['vectorRecording']['rigs'][0]
front_layers = ['5b7519c8-b451-442d-8ebb-deec4091ef2b', '909c9a51-f5f1-4e3a-9da9-6b4544ad0d9c']
red_layer = '5af1eb38-6a86-4521-abe6-113150188944'
red_layers = [layer for layer in source['layers'] if layer['id'] == red_layer]
items = set(red_layers[0]['items'])
curves = [curve for curve in source['curves'] if curve['id'] in items]
curve_ids = {curve['id'] for curve in curves}
node_ids = {node for curve in curves for node in curve['nodes']}
red = {'version': 3, 'layers': red_layers, 'curves': curves,
       'nodes': [node for node in source['nodes'] if node['id'] in node_ids],
       'fills': [fill for fill in source['fills'] if fill['id'] in items],
       'offsets': [offset for offset in source['offsets'] if offset['id'] in items],
       'joins': [join for join in source['joins'] if join['a']['curveId'] in curve_ids and join['b']['curveId'] in curve_ids],
       'endpointLinks': [link for link in source.get('endpointLinks', []) if link['a']['curveId'] in curve_ids and link['b']['curveId'] in curve_ids],
       'groups': [group for group in source.get('groups', []) if set(group['curveIds']) <= curve_ids],
       'displayIntervals': [track for track in source.get('displayIntervals', []) if track['anchor']['id'] in curve_ids]}
assert len(curves) == 8 and len(red['fills']) == 1
assert all((link['a']['curveId'] in curve_ids) == (link['b']['curveId'] in curve_ids) for link in source.get('endpointLinks', []))
assert all(set(use['id'] for use in fill['boundary']) <= curve_ids for fill in red['fills'])
uid = lambda label: str(uuid5(NAMESPACE_URL, 'contour:three-piece-scene-example:' + label))
front_id, red_id = uid('front-artwork'), uid('red-artwork')
front_instance, red_instance, scene_id = uid('front-instance'), uid('red-instance'), uid('scene')
name = '三片脸 · 双源场景起步稿'
scene = {'id': scene_id, 'name': name, 'angle': {'x': 90, 'y': 0},
         'instances': [{'id': front_instance, 'artworkId': front_id, 'name': '正面源稿 · 蓝绿两片', 'layerIds': front_layers},
                       {'id': red_instance, 'artworkId': red_id, 'name': '独立红片源稿 · 0°收拢未完成', 'layerIds': [red_layer]}],
         'warps': [], 'bindings': [], 'visibilityTracks': [], 'intervalTracks': [], 'depthTracks': [],
         'tolerance': starter['vectorRecording']['tolerance']}
for index, deformer in enumerate(rig['deformers']):
    warp_id = uid('warp-' + str(index))
    keys = []
    for original in rig['keys']:
        if original['angle'] not in [{'x': 0, 'y': 0}, {'x': 90, 'y': 0}]:
            continue
        key_name = original['name']
        if original['angle'] == {'x': 0, 'y': 0} and index == 1:
            key_name = '0° · 红片收拢未完成'
        if original['angle'] == {'x': 90, 'y': 0}:
            key_name = '90° · 仅平移对齐，压缩未完成' if index == 0 else '90° · 红片保持原形'
        keys.append({'id': uid('key-' + str(index) + '-' + original['id']), 'name': key_name,
                     'angle': original['angle'], 'value': original['grids'][deformer['id']]})
    scene['warps'].append({'id': warp_id, 'name': deformer['name'], 'restGrid': deformer['grid'], 'keys': keys})
    scene['bindings'].extend({'instanceId': front_instance if index == 0 else red_instance,
                              'sourceLayerId': layer, 'warpId': warp_id}
                             for layer, target in rig['bindings'].items() if target == deformer['id'])
right_index = next(i for i, layer in enumerate(front['layers']) if layer['id'] == front_layers[0])
left_index = next(i for i, layer in enumerate(front['layers']) if layer['id'] == front_layers[1])
red_depth = len(front['layers']) - (right_index + left_index) / 2
scene['depthTracks'] = [{'id': uid('red-depth'), 'target': {'instanceId': red_instance, 'sourceLayerId': red_layer},
                         'keys': [{'id': uid('red-depth-' + str(x)), 'angle': {'x': x, 'y': 0}, 'value': red_depth} for x in [0, 90]]}]
project = {key: copy.deepcopy(value) for key, value in starter.items()
           if key not in ['drawing', 'drawingSnapshots', 'vectorRecording', 'recordingScenes']}
project['meta']['name'] = name + '（0°红片收拢与90°压缩未完成）'
project['drawing'] = copy.deepcopy(red)
project['drawingSnapshots'] = {'version': 1, 'activeId': red_id, 'items': [
    {'id': front_id, 'name': '正面源稿 · 完整镜像画稿', 'drawing': front},
    {'id': red_id, 'name': '红前片源稿 · 独立八曲线', 'drawing': red}], 'images': []}
project['recordingScenes'] = {'version': 1, 'activeSceneId': scene_id, 'scenes': [scene]}
(asset / 'three-piece-scene-example.json').write_text(json.dumps(project, ensure_ascii=False, indent=2) + '\n')

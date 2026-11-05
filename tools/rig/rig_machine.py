r"""Rig and animate one generated machine (Blender's Python module, bpy 4.x).

Run with the Hunyuan 2.1 venv, which has bpy:

  %USERPROFILE%\Hunyuan3D-2.1\.venv\Scripts\python.exe tools\rig\rig_machine.py <id> [--inspect] [--out <glb>]

Reads `~/Hunyuan3D-2/outputs/af_<id>/textured.glb` and the joint table in `tools/rig/rigs.json`.

  --inspect  only normalise and render front and side views with a grid (and the joints, if the table has them) to
             `~/Hunyuan3D-2/outputs/af_<id>/rig_*.png`, for placing joints by eye.
  default    build the skeleton, weight the mesh, key the clips and write `public/assets/models/<id>.glb`.

Frame used for joints ("body frame"): Blender axes, the machine facing -Y, its left on +X, up +Z, the soles on z = 0,
centred between the shins, and scaled so the whole mesh (crest and weapons included) is 1.0 tall. The exported model is
rescaled so the top of the helmet (`head_top`) stands at HEAD_TOP game units.

Weighting is deliberately stiff, because these are armoured machines: each vertex follows its nearest bone, and blends
only with that bone's parent or child, and only inside a narrow band at the joint. Boxes in the table ("claims") hand a
region to a named bone first (a held weapon, a shield, a back unit).
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
HY = os.path.join(os.path.expanduser('~'), 'Hunyuan3D-2', 'outputs')
HEAD_TOP = 1.0          # game units from the soles to the top of the helmet
BLEND = 0.012           # width of the blend band at a joint, in body-frame units
FPS = 30

args = [a for a in sys.argv[1:]]
uid = args[0]
inspect = '--inspect' in args
out_glb = args[args.index('--out') + 1] if '--out' in args else os.path.join(REPO, 'public', 'assets', 'models', uid + '.glb')
work = os.path.join(HY, 'af_' + uid)
table = json.load(open(os.path.join(HERE, 'rigs.json')))
spec = table.get(uid, {})


# ---------------------------------------------------------------- load and normalise
bpy.ops.wm.read_factory_settings(use_empty=True)
src = os.path.join(work, 'textured.glb')
if inspect and not os.path.exists(src):
    src = os.path.join(work, 'shape.glb')   # joints can be placed before the paint stage has run
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in bpy.context.scene.objects:
    o.select_set(o in meshes)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
for o in list(bpy.context.scene.objects):
    if o is not body:
        bpy.data.objects.remove(o)
body.data.transform(body.matrix_world)
body.matrix_world = Matrix.Identity(4)
body.name = uid


def verts():
    a = np.empty(len(body.data.vertices) * 3)
    body.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def auto_yaw(v):
    """Turn so the machine faces -Y: the shins lie side by side along X, and the toes point to -Y."""
    z0, h = v[:, 2].min(), np.ptp(v[:, 2])
    shin = v[(v[:, 2] > z0 + 0.12 * h) & (v[:, 2] < z0 + 0.22 * h)][:, :2]
    c = shin - shin.mean(0)
    w, vec = np.linalg.eigh(c.T @ c)
    lateral = vec[:, 1]
    fwd = np.array([-lateral[1], lateral[0]])
    feet = v[v[:, 2] < z0 + 0.04 * h][:, :2]
    if (feet.mean(0) - shin.mean(0)) @ fwd < 0:
        fwd = -fwd
    # rotate fwd onto -Y
    return math.atan2(fwd[0], -fwd[1])


v = verts()
yaw = math.radians(spec['yaw']) if 'yaw' in spec else auto_yaw(v)
body.data.transform(Matrix.Rotation(yaw, 4, 'Z'))
v = verts()
z0, h = v[:, 2].min(), np.ptp(v[:, 2])
shin = v[(v[:, 2] > z0 + 0.12 * h) & (v[:, 2] < z0 + 0.22 * h)]
cx, cy = np.median(shin[:, 0]), np.median(shin[:, 1])
body.data.transform(Matrix.Scale(1 / h, 4) @ Matrix.Translation((-cx, -cy, -z0)))
v = verts()
print(f'{uid}: yaw {math.degrees(yaw):.0f} deg, {len(v)} vertices, x {v[:, 0].min():.2f}..{v[:, 0].max():.2f}, '
      f'y {v[:, 1].min():.2f}..{v[:, 1].max():.2f}', flush=True)


# ---------------------------------------------------------------- joints and bones
def J(name):
    p = spec['joints'][name]
    return Vector(p)


BONES = [
    # name, head joint, tail joint, parent
    ('pelvis', 'hips', 'waist', 'root'),
    ('chest', 'waist', 'neck', 'pelvis'),
    ('head', 'neck', 'head_top', 'chest'),
]
for s in 'LR':
    BONES += [
        (f'upperarm_{s}', f'shoulder_{s}', f'elbow_{s}', 'chest'),
        (f'forearm_{s}', f'elbow_{s}', f'wrist_{s}', f'upperarm_{s}'),
        (f'hand_{s}', f'wrist_{s}', f'hand_end_{s}', f'forearm_{s}'),
        (f'thigh_{s}', f'hip_{s}', f'knee_{s}', 'pelvis'),
        (f'shin_{s}', f'knee_{s}', f'ankle_{s}', f'thigh_{s}'),
        (f'foot_{s}', f'ankle_{s}', f'toe_{s}', f'shin_{s}'),
    ]


def render_views(tag, overlay=None, colours=False):
    """Orthographic front and side renders with a 0.05 grid; joints drawn on top when given."""
    from PIL import Image, ImageDraw
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX' if colours else 'TEXTURE'
    scene.render.resolution_x = scene.render.resolution_y = 800
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.3
    outs = []
    views = [('front', (0, -5, 0.5), (math.pi / 2, 0, 0)), ('side', (5, 0, 0.5), (math.pi / 2, 0, math.pi / 2))]
    if tag == 'grid':
        views.append(('top', (0, 0, 5), (0, 0, 0)))   # looking down: image right = +x, image up = +y (the back)
    for name, loc, rot in views:
        cam.location = loc
        cam.rotation_euler = rot
        path = os.path.join(work, f'rig_{tag}_{name}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        im = Image.open(path).convert('RGB')
        d = ImageDraw.Draw(im)

        def px(a, z):
            return ((a + 0.65) / 1.3 * 800, (1.15 - z) / 1.3 * 800)
        for i in range(-13, 14):
            x, _ = px(i * 0.05, 0)
            d.line([(x, 0), (x, 800)], fill=(200, 200, 255) if i % 2 else (120, 120, 255), width=1)
        for i in range(-3, 24):
            _, y = px(0, i * 0.05)
            d.line([(0, y), (800, y)], fill=(200, 200, 255) if i % 2 else (120, 120, 255), width=1)
        for i in range(-12, 13, 2):
            d.text(px(i * 0.05, 1.12), f'{i * 0.05:+.1f}', fill=(0, 0, 160))
        for i in range(0, 23, 2):
            d.text((4, px(0, i * 0.05)[1] - 6), f'{i * 0.05:.1f}', fill=(0, 0, 160))
        if overlay and name != 'top':
            ax = 0 if name == 'front' else 1
            for (_, a, b, _) in overlay:
                pa, pb = J(a), J(b)
                d.line([px(pa[ax], pa[2]), px(pb[ax], pb[2])], fill=(255, 0, 0), width=3)
            for k, p in spec['joints'].items():
                x, y = px(p[ax], p[2])
                d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(255, 255, 0), outline=(0, 0, 0))
        label = {'front': 'x (machine left +)', 'side': 'y (back +, front -)', 'top': 'x across, y up the image (back +); grid 0.0 row = y -0.5'}[name]
        d.text((200, 780), f'{uid} {name}: horizontal = {label}', fill=(0, 0, 0))
        im.save(path)
        outs.append(path)
    print('renders:', *outs, flush=True)


if inspect and 'joints' not in spec:
    render_views('grid')
    sys.exit(0)

weapons = spec.get('bones', [])  # extra bones: {name, head, tail, parent}
for w in weapons:
    spec['joints'][w['name'] + '.h'] = w['head']
    spec['joints'][w['name'] + '.t'] = w['tail']
    BONES.append((w['name'], w['name'] + '.h', w['name'] + '.t', w['parent']))

if inspect:
    render_views('joints', overlay=BONES)

arm_data = bpy.data.armatures.new('rig')
arm = bpy.data.objects.new('rig', arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
root = eb.new('root')
root.head, root.tail = (0, 0, 0), (0, 0.15, 0)
for name, a, b, parent in BONES:
    bone = eb.new(name)
    bone.head, bone.tail = J(a), J(b)
    bone.parent = eb[parent]
    bone.use_connect = False
    bone.align_roll(Vector((0, -1, 0)) if abs((J(b) - J(a)).normalized().y) < 0.9 else Vector((0, 0, 1)))
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- stiff weights
v = verts()
names = [b[0] for b in BONES]
heads = np.array([list(J(b[1])) for b in BONES])
tails = np.array([list(J(b[2])) for b in BONES])
seg = tails - heads
t = np.clip(np.einsum('vbk,bk->vb', v[:, None, :] - heads[None], seg) / np.maximum((seg * seg).sum(1), 1e-9), 0, 1)
closest = heads[None] + t[..., None] * seg[None]
dist = np.linalg.norm(v[:, None, :] - closest, axis=2)
weights = np.zeros_like(dist)
parent_of = {b[0]: b[3] for b in BONES}
nearest = dist.argmin(1)
claimed = np.full(len(v), -1)
for c in spec.get('claims', []):
    lo, hi = np.array(c['box'][0]), np.array(c['box'][1])
    inside = np.all((v >= lo) & (v <= hi), axis=1) & (claimed < 0)
    claimed[inside] = names.index(c['bone'])
for i in range(len(v)):
    if claimed[i] >= 0:
        weights[i, claimed[i]] = 1
        continue
    n = nearest[i]
    weights[i, n] = 1
    for j, other in enumerate(names):
        if j == n or not (parent_of[names[n]] == other or parent_of[other] == names[n]):
            continue
        gap = dist[i, j] - dist[i, n]
        if gap < 3 * BLEND:
            weights[i, j] = math.exp(-gap / BLEND)
weights /= weights.sum(1, keepdims=True)
for j, name in enumerate(names):
    vg = body.vertex_groups.new(name=name)
    for i in np.nonzero(weights[:, j] > 0.01)[0]:
        vg.add([int(i)], float(weights[i, j]), 'REPLACE')
body.parent = arm
mod = body.modifiers.new('rig', 'ARMATURE')
mod.object = arm

if inspect:
    # colour each vertex by its main bone, for checking the split
    fixed = {'pelvis': (1, .55, 0), 'chest': (.9, .1, .1), 'head': (1, 1, .2),
             'upperarm_L': (.2, .8, .2), 'forearm_L': (.1, .3, .9), 'hand_L': (.2, .9, .9),
             'upperarm_R': (.1, .45, .1), 'forearm_R': (.05, .1, .45), 'hand_R': (.1, .5, .5),
             'thigh_L': (.7, .3, .9), 'shin_L': (1, .5, .7), 'foot_L': (1, 1, 1),
             'thigh_R': (.35, .1, .5), 'shin_R': (.55, .25, .35), 'foot_R': (.5, .5, .5)}
    pal = np.array([fixed.get(n, (.05, .05, .05)) for n in names])   # extra bones (weapons) are black
    ca = body.data.color_attributes.new('bone', 'FLOAT_COLOR', 'POINT')
    main = weights.argmax(1)
    cols = np.concatenate([pal[main], np.ones((len(v), 1))], axis=1)
    ca.data.foreach_set('color', cols.ravel())
    body.data.color_attributes.active_color = ca
    render_views('weights', colours=True)
    body.data.color_attributes.remove(ca)


# ---------------------------------------------------------------- clips
pose = arm.pose.bones
REST = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}
for pb in pose:
    pb.rotation_mode = 'QUATERNION'

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
SIDE = {'L': 1, 'R': -1}


def rot(bone, pitch=0.0, roll=0.0, yaw=0.0):
    """A local rotation from armature-space angles in degrees: pitch about +X (positive leans an upward bone forward
    and swings a downward bone back), roll about -Y (positive tips the top to the machine's left), yaw about +Z."""
    inv = REST[bone].inverted()
    q = Quaternion()
    for axis, deg in ((X, pitch), (-Y, roll), (Z, yaw)):
        if deg:
            q = Quaternion((inv @ axis).normalized(), math.radians(deg)) @ q
    return q


def key(frame, pose_map, root_z=0.0, root_y=0.0):
    for pb in pose:
        q = pose_map.get(pb.name, Quaternion())
        pb.rotation_quaternion = q
        pb.keyframe_insert('rotation_quaternion', frame=frame)
    pose['root'].location = (0, 0, 0)
    pose['pelvis'].location = Vector((0, 0, 0))
    # pelvis location is in its own local frame; express a world drop/shift through its rest matrix
    pose['pelvis'].location = REST['pelvis'].inverted() @ Vector((0, root_y, root_z))
    pose['pelvis'].keyframe_insert('location', frame=frame)


def clip(name, frames, loop):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for f, pm, *rest in frames:
        key(f, pm, *rest)
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, int(frames[0][0]), act)
    arm.animation_data.action = None
    return act


main = spec.get('main_hand', 'R')
off = 'L' if main == 'R' else 'R'
shot_hand = spec.get('shot_hand', main)   # the arm that aims a ranged weapon
shot = spec.get('shot', 'arm')     # 'arm': raise the weapon arm to aim; 'mount': a shoulder or hip weapon, brace and recoil

# idle: a slow breath and a small look around (2 s loop)
clip('idle', [
    (1, {'chest': rot('chest', pitch=0), 'head': rot('head', yaw=0)}),
    (30, {'chest': rot('chest', pitch=2), 'head': rot('head', yaw=6),
          'upperarm_L': rot('upperarm_L', roll=1.5), 'upperarm_R': rot('upperarm_R', roll=-1.5)}, -0.004),
    (60, {'chest': rot('chest', pitch=0), 'head': rot('head', yaw=0)}),
], True)


def stride(s_fwd):
    """One walking key: s_fwd = +1 with the left leg forward."""
    m = {}
    for s in 'LR':
        a = s_fwd if s == 'L' else -s_fwd
        m[f'thigh_{s}'] = rot(f'thigh_{s}', pitch=-24 * a)
        m[f'shin_{s}'] = rot(f'shin_{s}', pitch=6 if a > 0 else 22)
        m[f'foot_{s}'] = rot(f'foot_{s}', pitch=8 * a)
        m[f'upperarm_{s}'] = rot(f'upperarm_{s}', pitch=(14 if s == off else 6) * a)
    m['pelvis'] = rot('pelvis', yaw=6 * s_fwd)
    m['chest'] = rot('chest', yaw=-8 * s_fwd, pitch=4)
    return m


def passing(s_up):
    m = {}
    for s in 'LR':
        lift = s == s_up
        m[f'thigh_{s}'] = rot(f'thigh_{s}', pitch=-10 if lift else 4)
        m[f'shin_{s}'] = rot(f'shin_{s}', pitch=40 if lift else 4)
    m['chest'] = rot('chest', pitch=4)
    return m


# walk: one stride cycle (0.8 s loop)
clip('walk', [
    (1, stride(1), -0.012), (7, passing('R'), 0.004), (13, stride(-1), -0.012), (19, passing('L'), 0.004), (25, stride(1), -0.012),
], True)


def crouch(depth):
    m = {}
    for s in 'LR':
        m[f'thigh_{s}'] = rot(f'thigh_{s}', pitch=-30 * depth)
        m[f'shin_{s}'] = rot(f'shin_{s}', pitch=55 * depth)
        m[f'foot_{s}'] = rot(f'foot_{s}', pitch=-25 * depth)
        m[f'upperarm_{s}'] = rot(f'upperarm_{s}', pitch=12 * depth)
    m['chest'] = rot('chest', pitch=12 * depth)
    return m


def tuck():
    m = {}
    for s in 'LR':
        m[f'thigh_{s}'] = rot(f'thigh_{s}', pitch=-40)
        m[f'shin_{s}'] = rot(f'shin_{s}', pitch=60)
        m[f'foot_{s}'] = rot(f'foot_{s}', pitch=15)
        m[f'upperarm_{s}'] = rot(f'upperarm_{s}', pitch=-20, roll=18 * SIDE[s])
    m['chest'] = rot('chest', pitch=-4)
    return m


# jump: crouch, spring, tuck, land (1 s, once). The game moves the machine through the air; the clip only poses it.
clip('jump', [
    (1, {}), (6, crouch(1), -0.09), (10, {k: rot(k, pitch=-8) if k.startswith('thigh') else Quaternion() for k in names}, 0.0),
    (16, tuck()), (24, tuck()), (27, crouch(0.8), -0.07), (31, {}),
], False)

# fly: lean into a boost with the legs trailing (0.6 s loop)
fly = {}
for s in 'LR':
    fly[f'thigh_{s}'] = rot(f'thigh_{s}', pitch=14)
    fly[f'shin_{s}'] = rot(f'shin_{s}', pitch=32)
    fly[f'foot_{s}'] = rot(f'foot_{s}', pitch=30)
    fly[f'upperarm_{s}'] = rot(f'upperarm_{s}', pitch=28, roll=10 * SIDE[s])
    fly[f'forearm_{s}'] = rot(f'forearm_{s}', pitch=-10)
fly['pelvis'] = rot('pelvis', pitch=18)
fly['chest'] = rot('chest', pitch=8)
fly['head'] = rot('head', pitch=-20)
fly2 = dict(fly)
fly2['chest'] = rot('chest', pitch=11)
fly2['thigh_L'] = rot('thigh_L', pitch=20)
fly2['thigh_R'] = rot('thigh_R', pitch=10)
clip('fly', [(1, fly, 0.02), (10, fly2, 0.035), (19, fly, 0.02)], True)

# melee: wind up, strike, recover (0.9 s, once)
up = {f'upperarm_{main}': rot(f'upperarm_{main}', pitch=115, roll=-10 * SIDE[main]),
      f'forearm_{main}': rot(f'forearm_{main}', pitch=50),
      'chest': rot('chest', yaw=25 * SIDE[main], pitch=-6),
      f'thigh_{off}': rot(f'thigh_{off}', pitch=-18), f'shin_{off}': rot(f'shin_{off}', pitch=10)}
hitm = {f'upperarm_{main}': rot(f'upperarm_{main}', pitch=-60),
        f'forearm_{main}': rot(f'forearm_{main}', pitch=-15),
        'chest': rot('chest', yaw=-25 * SIDE[main], pitch=14),
        f'thigh_{off}': rot(f'thigh_{off}', pitch=-30), f'shin_{off}': rot(f'shin_{off}', pitch=20),
        f'thigh_{main}': rot(f'thigh_{main}', pitch=12)}
clip('melee', [(1, {}), (9, up, -0.01), (14, hitm, -0.04), (20, hitm, -0.04), (27, {})], False)

# shoot: aim, fire with recoil, lower (0.7 s, once)
if shot == 'arm':
    aim = {f'upperarm_{shot_hand}': rot(f'upperarm_{shot_hand}', pitch=-80, roll=-12 * SIDE[shot_hand]),
           f'forearm_{shot_hand}': rot(f'forearm_{shot_hand}', pitch=-5),
           'chest': rot('chest', yaw=12 * SIDE[shot_hand])}
    kick = dict(aim)
    kick[f'upperarm_{shot_hand}'] = rot(f'upperarm_{shot_hand}', pitch=-92, roll=-12 * SIDE[shot_hand])
    kick['chest'] = rot('chest', yaw=12 * SIDE[shot_hand], pitch=-5)
else:
    aim = {'chest': rot('chest', pitch=-4), 'thigh_L': rot('thigh_L', pitch=-10), 'thigh_R': rot('thigh_R', pitch=6),
           'shin_L': rot('shin_L', pitch=10)}
    kick = dict(aim)
    kick['chest'] = rot('chest', pitch=-12)
clip('shoot', [(1, {}), (7, aim), (10, kick, 0, 0.02), (14, aim), (21, {})], False)

# hit: knocked back and recover (0.45 s, once)
clip('hit', [(1, {}), (4, {'chest': rot('chest', pitch=-16, roll=6), 'head': rot('head', pitch=-14),
                           'upperarm_L': rot('upperarm_L', pitch=20), 'upperarm_R': rot('upperarm_R', pitch=20)}, 0, 0.03),
             (14, {})], False)

# destroyed: the knees go, the body slumps forward (1.2 s, once; the game topples the whole machine)
slump = {'chest': rot('chest', pitch=30, roll=10), 'head': rot('head', pitch=25, roll=12)}
for s in 'LR':
    slump[f'thigh_{s}'] = rot(f'thigh_{s}', pitch=-45)
    slump[f'shin_{s}'] = rot(f'shin_{s}', pitch=80)
    slump[f'foot_{s}'] = rot(f'foot_{s}', pitch=-30)
    slump[f'upperarm_{s}'] = rot(f'upperarm_{s}', pitch=-15, roll=-8 * SIDE[s])
    slump[f'forearm_{s}'] = rot(f'forearm_{s}', pitch=-20)
clip('destroyed', [(1, {}), (12, crouch(0.6), -0.06), (30, slump, -0.2), (36, slump, -0.2)], False)

if inspect:
    # pose tests: render the key poses
    for name, frame in (('walk', 1), ('jump', 16), ('fly', 1), ('melee', 9), ('melee', 14), ('shoot', 10), ('destroyed', 36)):
        arm.animation_data.action = bpy.data.actions[name]
        for tr in arm.animation_data.nla_tracks:
            tr.mute = True
        bpy.context.scene.frame_set(frame)
        render_views(f'pose_{name}{frame}')
    sys.exit(0)

# ---------------------------------------------------------------- export at game scale
k = HEAD_TOP / spec['joints']['head_top'][2]
arm.scale = (k, k, k)
for m in body.data.materials:
    if m and m.use_nodes:
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Metallic'].default_value = 0.0
            bsdf.inputs['Roughness'].default_value = 0.5
for tr in arm.animation_data.nla_tracks:
    tr.mute = False
bpy.context.scene.frame_set(1)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=out_glb, export_format='GLB', use_selection=True, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_skins=True, export_def_bones=False, export_extras=True,
    export_apply=False, export_image_format='JPEG', export_jpeg_quality=88, export_optimize_animation_size=True)
sys.path.insert(0, HERE)
import pack_glb  # noqa: E402
pack_glb.pack(out_glb)
arm.scale = (1, 1, 1)
print(f'{uid}: wrote {out_glb} ({os.path.getsize(out_glb) / 1e6:.2f} MB)', flush=True)

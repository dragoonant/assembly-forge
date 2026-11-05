r"""Finalize generated board objects (Blender's Python module, bpy 4.x): textured mesh -> game GLB.

  %USERPROFILE%\Hunyuan3D-2.1\.venv\Scripts\python.exe tools\rig\finalize_prop.py [name ...]

Reads `~/Hunyuan3D-2/outputs/af_p_<name>/textured.glb` and writes `public/assets/models/props/<name>.glb`: one mesh, the
feet on z = 0 and centred, satin materials, a JPEG texture. The game fits each prop to its hex on load (Prop.tsx), so the
scale here only needs to be sane.
"""
import os
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
HY = os.path.join(os.path.expanduser('~'), 'Hunyuan3D-2', 'outputs')
NAMES = sys.argv[1:] or ['objective', 'garrison', 'base', 'crate', 'energy', 'wreck_a', 'wreck_b']
out_dir = os.path.join(REPO, 'public', 'assets', 'models', 'props')
os.makedirs(out_dir, exist_ok=True)

for name in NAMES:
    src = os.path.join(HY, 'af_p_' + name, 'textured.glb')
    if not os.path.exists(src):
        print(f'{name}: no textured.glb, skipped', flush=True)
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
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
    co = [v.co for v in body.data.vertices]
    lo = Vector([min(c[i] for c in co) for i in range(3)])
    hi = Vector([max(c[i] for c in co) for i in range(3)])
    size = max(hi - lo)
    body.data.transform(Matrix.Scale(1 / size, 4) @ Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    for m in body.data.materials:
        if m and m.use_nodes:
            bsdf = m.node_tree.nodes.get('Principled BSDF')
            if bsdf:
                bsdf.inputs['Metallic'].default_value = 0.0
                bsdf.inputs['Roughness'].default_value = 0.55
    out = os.path.join(out_dir, name + '.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=False,
                              export_image_format='JPEG', export_jpeg_quality=85)
    sys.path.insert(0, HERE)
    import pack_glb  # noqa: E402
    pack_glb.pack(out)
    print(f'{name}: {os.path.getsize(out) / 1e6:.2f} MB', flush=True)

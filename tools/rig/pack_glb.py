r"""Shrink a GLB by storing vertex attributes at the precision the game needs (KHR_mesh_quantization).

  python tools/rig/pack_glb.py <file.glb> [...]

Rewrites each file in place:
  - NORMAL      float x3  -> normalized signed byte x3 (padded to 4 bytes)
  - TEXCOORD_n  float x2  -> normalized unsigned short x2 (only when every value is inside 0..1)
  - WEIGHTS_0   float x4  -> normalized unsigned byte x4, re-summed to exactly 1
Positions, joints, indices and animation data are left alone, so skinning is unchanged. three.js reads the
KHR_mesh_quantization extension natively. Needs numpy only.
"""
import json
import struct
import sys

import numpy as np

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'glTF'
    jlen = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack_from('<I', b, off)[0]
    return j, bytearray(b[off + 8:off + 8 + blen])


def accessor_array(j, binbuf, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    dt = np.dtype(COMP[a['componentType']])
    n = NCOMP[a['type']]
    stride = bv.get('byteStride', dt.itemsize * n)
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    raw = np.frombuffer(bytes(binbuf[start:start + stride * a['count']]), dtype=np.uint8).reshape(a['count'], stride)
    return raw[:, :dt.itemsize * n].copy().view(dt).reshape(a['count'], n)


def pack(path):
    j, binbuf = read_glb(path)
    chunks = []          # new binary, built from kept and new buffer views
    new_views = []
    remap = {}

    def add_view(data, stride=None, target=None):
        while sum(len(c) for c in chunks) % 4:
            chunks.append(b'\0')
        view = {'buffer': 0, 'byteOffset': sum(len(c) for c in chunks), 'byteLength': len(data)}
        if stride:
            view['byteStride'] = stride
        if target:
            view['target'] = target
        chunks.append(data)
        new_views.append(view)
        return len(new_views) - 1

    replaced = {}  # accessor index -> (new bytes, componentType, normalized, stride)
    for mesh in j['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            if 'NORMAL' in at and j['accessors'][at['NORMAL']]['componentType'] == 5126:
                v = accessor_array(j, binbuf, at['NORMAL'])
                q = np.clip(np.round(v * 127), -127, 127).astype(np.int8)
                q = np.concatenate([q, np.zeros((len(q), 1), np.int8)], axis=1)
                replaced[at['NORMAL']] = (q.tobytes(), 5120, True, 4)
            for k in [k for k in at if k.startswith('TEXCOORD_')]:
                if j['accessors'][at[k]]['componentType'] != 5126:
                    continue
                v = accessor_array(j, binbuf, at[k])
                if v.min() < 0 or v.max() > 1:
                    continue
                replaced[at[k]] = (np.round(v * 65535).astype(np.uint16).tobytes(), 5123, True, 4)
            if 'WEIGHTS_0' in at and j['accessors'][at['WEIGHTS_0']]['componentType'] == 5126:
                v = accessor_array(j, binbuf, at['WEIGHTS_0'])
                q = np.floor(v * 255).astype(np.int32)
                short = 255 - q.sum(1)          # give the rounding remainder to the largest weight
                q[np.arange(len(q)), v.argmax(1)] += short
                replaced[at['WEIGHTS_0']] = (np.clip(q, 0, 255).astype(np.uint8).tobytes(), 5121, True, 4)

    # copy every buffer view still in use, then the replacements
    used = set()
    for i, a in enumerate(j['accessors']):
        if i not in replaced and 'bufferView' in a:
            used.add(a['bufferView'])
    for img in j.get('images', []):
        if 'bufferView' in img:
            used.add(img['bufferView'])
    for vi in sorted(used):
        bv = j['bufferViews'][vi]
        s = bv.get('byteOffset', 0)
        remap[vi] = add_view(bytes(binbuf[s:s + bv['byteLength']]), bv.get('byteStride'), bv.get('target'))
    for i, a in enumerate(j['accessors']):
        if i in replaced:
            data, comp, norm, stride = replaced[i]
            a['bufferView'] = add_view(data, stride, 34962)
            a['byteOffset'] = 0
            a['componentType'] = comp
            a['normalized'] = norm
            a.pop('min', None)
            a.pop('max', None)
        elif 'bufferView' in a:
            a['bufferView'] = remap[a['bufferView']]
    for img in j.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = remap[img['bufferView']]
    j['bufferViews'] = new_views
    out = b''.join(chunks)
    out += b'\0' * (-len(out) % 4)
    j['buffers'] = [{'byteLength': len(out)}]
    for key in ('extensionsUsed', 'extensionsRequired'):
        j.setdefault(key, [])
        if 'KHR_mesh_quantization' not in j[key]:
            j[key].append('KHR_mesh_quantization')
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    glb = b'glTF' + struct.pack('<II', 2, 12 + 8 + len(js) + 8 + len(out))
    glb += struct.pack('<I', len(js)) + b'JSON' + js + struct.pack('<I', len(out)) + b'BIN\0' + out
    before = len(binbuf)
    open(path, 'wb').write(glb)
    print(f'{path}: {before / 1e6:.2f} MB of data -> {len(out) / 1e6:.2f} MB', flush=True)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        pack(p)

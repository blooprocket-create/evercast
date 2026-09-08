"""Round-trip every delivered GLB through Blender and validate usable geometry."""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

root=Path(__file__).resolve().parents[2]
manifest=json.loads((root/'public/models/environment/manifest.json').read_text())
report=[]
for asset in manifest['assets']:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    path=root/'public'/asset['url'].lstrip('/')
    assert path.is_file() and path.stat().st_size>100, path
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH']
    assert objects, asset['id']
    triangles=0;points=[]
    for o in objects:
        o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
        assert len(o.data.materials)>0, asset['id']
        for v in o.data.vertices:
            p=o.matrix_world@v.co
            assert all(math.isfinite(c) for c in p),asset['id']
            points.append(p)
        assert all(t.area>1e-10 for t in o.data.loop_triangles),asset['id']+' degenerate face'
    assert triangles==asset['triangles'],(asset['id'],triangles,asset['triangles'])
    low=[min(p[i] for p in points) for i in range(3)]
    high=[max(p[i] for p in points) for i in range(3)]
    assert abs(low[2])<.001,(asset['id'],'ground offset',low[2])
    assert all(abs(high[i]-low[i]-asset['dimensionsMeters'][i])<.002 for i in range(3)),asset['id']+' bounds'
    report.append({'id':asset['id'],'triangles':triangles,'bytes':path.stat().st_size,'passed':True})
bpy.ops.wm.open_mainfile(filepath=str(root/'art/environment/evercast_environment.blend'))
for asset in manifest['assets']:
    obj=bpy.data.objects.get(asset['id'])
    assert obj is not None and obj.type=='MESH',asset['id']+' source mesh'
    assert asset['biome'] in [c.name for c in obj.users_collection],asset['id']+' collection'
    assert all(abs(v-1)<.00001 for v in obj.scale),asset['id']+' source scale'
result={'blender':bpy.app.version_string,'assetCount':len(report),'totalTriangles':sum(a['triangles'] for a in report),'totalGlbBytes':sum(a['bytes'] for a in report),'checks':['GLB import','nonempty meshes and materials','finite vertices','nondegenerate triangles','triangle count','ground pivot','dimensions round trip','editable Blender source and biome collections'],'assets':report}
(root/'art/environment/validation.json').write_text(json.dumps(result,indent=2)+'\n')
print('EVERCAST_VALIDATED',len(report))

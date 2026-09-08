"""Reusable faceted magic geometry; Blender 5.2. No baked spell animation."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'public/models/vfx'; ART = ROOT/'art/vfx'
OUT.mkdir(parents=True, exist_ok=True); ART.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
palette = {'arcane': (.48,.28,1), 'fire': (1,.22,.035), 'frost': (.15,.75,1),
           'storm': (.48,.65,1), 'blood': (1,.035,.32)}
kit = {
 'arcane': ['core_a','core_b','ring_a','ring_b','shard_a','shard_b','shard_c','glyph_a','glyph_b','spark'],
 'fire': ['flame_a','flame_b','ember','fragment_a','fragment_b','ring'],
 'frost': ['shard_a','shard_b','shard_c','ring','glyph','cluster'],
 'storm': ['spark','shard','endpoint','ring'],
 'blood': ['droplet','glyph','ring','endpoint']}
assets=[]
for school, names in kit.items():
    mat=bpy.data.materials.new('VFX / '+school); mat.use_nodes=True
    p=mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*palette[school],1)
    p.inputs['Emission Color'].default_value=(*palette[school],1)
    p.inputs['Emission Strength'].default_value=1
    p.inputs['Roughness'].default_value=1; p.inputs['Specular IOR Level'].default_value=0
    for variant,name in enumerate(names):
        parts=[]
        def crystal(pos,scale):
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=pos)
            o=bpy.context.object; o.scale=scale; parts.append(o); return o
        def bar(a,b,width):
            d=Vector(b)-Vector(a)
            bpy.ops.mesh.primitive_cone_add(vertices=4,radius1=width,radius2=width*.65,depth=d.length)
            o=bpy.context.object;o.location=(Vector(a)+Vector(b))/2
            o.rotation_euler=d.to_track_quat('Z','Y').to_euler();parts.append(o)
        if 'ring' in name or 'glyph' in name:
            n=8 if school=='frost' else (10 if name.endswith('_b') else 12)
            for i in range(n):
                a=i*math.tau/n; b=a+math.tau/n*.72
                bar((math.cos(a)*.5,math.sin(a)*.5,0),(math.cos(b)*.5,math.sin(b)*.5,0),.018)
                r=.37 if 'glyph' in name else .55
                bar((math.cos(a)*r,math.sin(a)*r,0),(math.cos(a)*(r+.11),math.sin(a)*(r+.11),0),.013)
                if 'glyph' in name:
                    b=a+math.tau/n*(3 if name.endswith('_b') else 2)
                    bar((math.cos(a)*.32,math.sin(a)*.32,0),(math.cos(b)*.32,math.sin(b)*.32,0),.012)
        elif 'core' in name or 'endpoint' in name or 'cluster' in name:
            crystal((0,0,0),(.18,.18,.48))
            for i in range(4 if name!='core_b' else 6):
                a=i*math.tau/(4 if name!='core_b' else 6)
                o=crystal((math.cos(a)*.20,math.sin(a)*.20,-.08),(.065,.065,.3))
                o.rotation_euler=(math.sin(a)*.3,math.cos(a)*.3,a)
        else:
            crystal((0,0,0),(.12+(variant%3)*.025,.065,.34+(variant%2)*.12))
            if 'flame' in name or 'droplet' in name:
                crystal((.09,0,-.14),(.08,.055,.23))
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts:o.select_set(True)
        bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
        obj=bpy.context.object;obj.name=f'{school}_{name}'
        bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
        obj.data.materials.clear();obj.data.materials.append(mat)
        bpy.ops.export_scene.gltf(filepath=str(OUT/(obj.name+'.glb')),export_format='GLB',use_selection=True,
            export_animations=False,export_cameras=False,export_lights=False)
        tris=sum(len(p.vertices)-2 for p in obj.data.polygons)
        assets.append({'id':obj.name,'school':school,'file':obj.name+'.glb','triangles':tris,'pivot':'center','unit':'meter'})
        obj.location=(len(assets)%10*1.5,len(assets)//10*1.5,0)
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'evercast_vfx.blend'))
(OUT/'manifest.json').write_text(json.dumps({'version':1,'generator':'tools/blender/build_vfx.py','assets':assets},indent=2)+'\n')
print('VFX kit:',len(assets),'assets,',sum(a['triangles'] for a in assets),'triangles')

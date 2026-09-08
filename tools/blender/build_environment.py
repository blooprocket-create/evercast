"""Deterministic Evercast prop library. Run with Blender --background --python this_file."""
import bpy, math, random, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/environment'
ART = ROOT / 'art/environment'
OUT.mkdir(parents=True, exist_ok=True)
ART.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
random.seed(8127)

def mat(name, color, metal=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Roughness'].default_value=.78 if metal else 1; p.inputs['Metallic'].default_value=metal
    p.inputs['Specular IOR Level'].default_value=.22 if metal else 0
    return m

bark=[mat('Bark / umber',(.19,.095,.046)),mat('Bark / honey edge',(.31,.18,.085)),mat('Bark / shadow',(.095,.043,.028))]
leaf=[mat('Leaf / fern',(.15,.32,.065)),mat('Leaf / sunlit',(.32,.48,.095)),mat('Leaf / sage',(.23,.38,.12))]
dark=[mat('Leaf / deep jade',(.035,.16,.115)),mat('Leaf / blue spruce',(.07,.235,.19)),mat('Leaf / moss edge',(.12,.29,.17))]
stone=[mat('Stone / warm slate',(.32,.35,.31)),mat('Stone / pale edge',(.46,.48,.405)),mat('Stone / deep face',(.205,.235,.23))]
grave=[mat('Grave / violet slate',(.255,.235,.31)),mat('Grave / weathered edge',(.40,.375,.43)),mat('Grave / dark mortar',(.135,.125,.17))]
moss=mat('Moss / chartreuse',(.255,.365,.065)); wood=mat('Wood / cut end',(.60,.385,.16)); ring=mat('Wood / growth ring',(.31,.16,.065))
ivory=mat('Bone / old ivory',(.68,.61,.43)); iron=mat('Iron / oxidized',(.12,.16,.17),.55)
gold=mat('Shrine / tarnished bronze',(.47,.32,.10),.5); glow=mat('Shrine / jade inlay',(.19,.74,.52))
petals=[mat('Flower / cream',(.91,.77,.37)),mat('Flower / periwinkle',(.40,.28,.68)),mat('Mushroom / russet',(.52,.15,.065))]

def linear_hex(value):
    values=[int(value[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values)

for material,color in zip(leaf+dark+ [moss],['708B56','87A366','79965B','376B59','467C65','548D68','617847']):
    rgb=linear_hex(color);material.diffuse_color=(*rgb,1)
    material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*rgb,1)
amber=mat('Lantern / candle',(.8,.36,.075))
amber.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(1,.31,.045,1)
amber.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=1.4

def finish(o,name,mats):
    o.name=name
    if not isinstance(mats,list): mats=[mats]
    for m in mats:o.data.materials.append(m)
    for p in o.data.polygons:p.material_index=random.randrange(len(mats))
    return o

def mesh(name,verts,faces,mats):
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o)
    return finish(o,name,mats)

def ico(name,loc,scale,mats,sub=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=loc)
    o=bpy.context.object
    for v in o.data.vertices: v.co*=random.uniform(.85,1.13)
    o.scale=scale
    return finish(o,name,mats)

def beam(name,a,b,r1,r2,mats,n=7):
    d=Vector(b)-Vector(a)
    bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r1,radius2=r2,depth=d.length,location=(Vector(a)+Vector(b))/2)
    o=bpy.context.object;o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    return finish(o,name,mats)

def box(name,loc,scale,mats,bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Chipped stone edges','BEVEL');mod.width=min(bevel,min(scale)*.22);mod.segments=1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,mats)

def path(name,pts,r,mats):
    for i in range(len(pts)-1):beam(name,pts[i],pts[i+1],r*(1-i/len(pts)),max(.012,r*(1-(i+1)/len(pts))),mats)

def grass(n=28,extent=.65):
    for i in range(n):
        x,y=random.uniform(-extent,extent),random.uniform(-extent*.6,extent*.6);h=random.uniform(.18,.55);a=random.random()*math.tau
        w=random.uniform(.025,.055);dx,dy=math.cos(a),math.sin(a)
        mesh('Folded grass blade',[(x-dy*w,y+dx*w,0),(x+dy*w,y-dx*w,0),(x+dx*h*.18,y+dy*h*.18,h*.6),(x+dx*h*.55,y+dy*h*.55,h)],[(0,1,2),(0,2,3)],leaf)

def flowers(v):
    grass(20,.75)
    for i in range(13 if v==0 else 18):
        x,y=random.uniform(-.7,.7),random.uniform(-.4,.4);h=random.uniform(.28,.65)
        beam('Flower stem',(x,y,0),(x+.045,y,h),.012,.007,dark[1],5)
        for k in range(5):
            a=k*math.tau/5
            ico('Petal',(x+.045+math.cos(a)*.075,y+math.sin(a)*.075,h),(.085,.05,.025),petals[v])
        ico('Pollen',(x+.045,y,h+.018),(.035,.035,.025),gold)

def rock(v=0,mossy=False):
    scales=[(.72,.55,.6),(1,.65,.43),(.55,.48,.95)]
    sx,sy,sz=scales[v]
    ico('Fractured boulder',(0,0,sz*.72),(sx,sy,sz),stone,2)
    for i in range(4):ico('Stone splinter',(random.uniform(-sx,sx),random.uniform(-sy,sy),.08),(.16,.12,.14),stone)
    if mossy:
        for i in range(12):
            a=random.random()*math.tau;r=random.uniform(.05,.45)
            ico('Raised moss cushion',(math.cos(a)*r,math.sin(a)*r,sz*1.45),(.22,.15,.055),moss)

def tree(v=0,kind='healthy'):
    h=[3.3,4.0,3.0][v]*(1.2 if kind=='dark' else 1)
    lean=[.12,-.3,.4][v];tr=bark if kind=='healthy' else [bark[2],bark[0],stone[2]]
    pts=[(0,0,0),(lean*.4,0,h*.34),(lean,.06,h*.7),(lean*.4,.08,h)]
    path('Tapered crooked trunk',pts,.24,tr)
    for k in range(7):
        a=k*math.tau/7+.2
        path('Buttress root',[(lean*.15,0,.5),(math.cos(a)*.4,math.sin(a)*.4,.12),(math.cos(a)*.85,math.sin(a)*.85,.025)],.12,tr)
    for k in range(10):
        a=k*2.399+v;z=h*(.36+k*.048);r=(1.25 if v!=1 else .95)*(1-.035*k)
        end=(lean+math.cos(a)*r,math.sin(a)*r,z+h*.26)
        path('Angular branch',[(lean*.7,0,z),(math.cos(a)*r*.55,math.sin(a)*r*.55,z+.2),end],.09,tr)
        if kind=='dead':
            path('Broken twig',[end,(end[0]+math.cos(a+.7)*.35,end[1]+math.sin(a+.7)*.35,end[2]+.28)],.035,tr)
        else:
            pal=leaf if kind=='healthy' else dark
            for j in range(3):
                ico('Faceted foliage spray',(end[0]+random.uniform(-.28,.28),end[1]+random.uniform(-.28,.28),end[2]+j*.12),(.67,.56,.52 if v!=1 else .72),pal,2)
    if kind!='dead':ico('Crown',(lean*.4,0,h+.3),(.75,.7,.7),leaf if kind=='healthy' else dark,2)
    for k in range(9):
        a=k*2.4
        beam('Bark ridge',(math.cos(a)*.22,math.sin(a)*.22,.2),(lean*.5+math.cos(a)*.16,math.sin(a)*.16,h*.5),.017,.007,tr[1],4)

def log():
    beam('Fallen bark',(-1.25,0,.3),(1.25,.08,.34),.32,.26,bark,11)
    for x in [-1.26,1.26]:
        beam('Exposed end grain',(x,0,.32),(x+(.015 if x>0 else -.015),0,.32),.255,.255,wood,11)
        for r in [.085,.16,.225]:
            bpy.ops.mesh.primitive_torus_add(major_segments=12,minor_segments=3,location=(x*1.015,0,.32),major_radius=r,minor_radius=.007,rotation=(0,math.pi/2,0));finish(bpy.context.object,'Growth ring',ring)
    path('Snapped limb',[(.2,0,.4),(.35,.22,.75),(.65,.3,.88)],.09,bark)
    for i in range(7):ico('Moss on log',(random.uniform(-1,1),.05,.59),(.21,.18,.035),moss)

def ruin_stone():
    box('Broken dressed stone',(0,0,.32),(1,.65,.64),stone,.095)
    box('Worn cornice',(0,.02,.66),(1.1,.73,.13),stone,.045)
    # Shallow relief and an interrupted old sun emblem on the front face.
    for x in [-.34,.34]:box('Carved border',(x,-.331,.32),(.035,.018,.4),stone[1],.006)
    for z in [.14,.51]:box('Carved border',(0,-.331,z),(.68,.018,.03),stone[1],.006)
    for k in range(7):
        a=k*math.tau/8;b=(k+1)*math.tau/8
        beam('Sun emblem',(math.cos(a)*.12,-.344,.33+math.sin(a)*.12),(math.cos(b)*.12,-.344,.33+math.sin(b)*.12),.013,.013,stone[2],4)
    path('Ancient fracture',[(.18,-.346,.62),(.1,-.35,.46),(.19,-.35,.37),(.13,-.35,.2)],.012,stone[2])
    for i in range(4):ico('Weathered moss',(random.uniform(-.4,.4),random.uniform(-.22,.22),.73),(.12,.09,.025),moss)

def roots():
    for k in range(9):
        a=k*2.4;r=random.uniform(.7,1.4)
        path('Twisting exposed root',[(0,0,.3),(math.cos(a)*r*.4,math.sin(a)*r*.4,.25),(math.cos(a+.2)*r*.75,math.sin(a+.2)*r*.75,.1),(math.cos(a+.4)*r,math.sin(a+.4)*r,.025)],.16,bark)

def mushrooms():
    for i in range(12):
        x,y=random.uniform(-.7,.7),random.uniform(-.45,.45);h=random.uniform(.16,.55);r=h*.47
        beam('Mushroom stalk',(x,y,0),(x+.025,y,h),.035,.025,ivory)
        beam('Gilled underside',(x+.025,y,h-.055),(x+.025,y,h),r*.8,r,ivory,9)
        beam('Angular mushroom cap',(x+.025,y,h),(x+.025,y,h+r*.6),r,.025,petals[2],9)
        for k in range(3):ico('Cap fleck',(x+.025+random.uniform(-r*.4,r*.4),y+random.uniform(-r*.4,r*.4),h+r*.5),(.025,.025,.009),ivory)

def bush():
    for i in range(11):
        a=i*2.4;r=random.uniform(.1,.6);x,y=math.cos(a)*r,math.sin(a)*r
        beam('Bush branch',(0,0,0),(x,y,.65),.03,.008,bark)
        ico('Bush leaf cluster',(x,y,random.uniform(.35,.7)),(.38,.31,.35),dark,2)

def arch(palette=stone,broken=False,width=2.1,height=2.1):
    for side in [-1,1]:
        for z in range(5):box('Pillar course',(side*(width/2+.2),0,.2+z*.4),(.48,.65,.38),palette)
        box('Footing',(side*(width/2+.2),0,.1),(.7,.8,.2),palette)
        box('Capital',(side*(width/2+.2),0,height),(.63,.75,.2),palette)
    for i in range(11):
        if broken and i in [4,5,6]:continue
        a=i*math.pi/11+.015;b=(i+1)*math.pi/11-.015;r=width/2+.2
        vs=[(math.cos(t)*rr,y,height+math.sin(t)*rr*.9) for y in [-.33,.33] for rr,t in [(r-.23,a),(r+.23,a),(r+.23,b),(r-.23,b)]]
        mesh('Arch voussoir',vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],palette)
    if broken:
        for i in range(5):
            o=box('Fallen arch masonry',(random.uniform(-.8,.8),random.uniform(-.5,.5),.15),(.4,.4,.3),palette);o.rotation_euler.z=random.random()*3

def shrine():
    arch()
    for k in range(3):box('Altar step',(0,.6,.12+k*.18),(1.5-k*.25,1-k*.14,.18),stone)
    beam('Offering pedestal',(0,.6,.4),(0,.6,1.05),.28,.2,stone,8)
    ico('Jade relic',(0,.6,1.35),(.18,.18,.37),glow)
    for side in [-1,1]:
        path('Climbing shrine vine',[(side*1.4,-.38,.1),(side*1.3,-.38,1.2),(side*1.5,-.34,2),(side*.9,-.34,2.8)],.04,dark)
        for k in range(7):ico('Shrine ivy',(side*(1.3+random.uniform(-.13,.13)),-.4,.3+k*.34),(.17,.055,.11),dark)

def tomb(v):
    box('Gravestone plinth',(0,0,.09),(.85,.55,.18),grave)
    if v==1:
        box('Cross shaft',(0,0,.85),(.23,.25,1.5),grave);box('Cross arms',(0,.018,1.17),(.88,.25,.23),grave)
    else:
        box('Carved headstone',(0,0,.68),(.64,.24,1.1),grave,.07)
        if v==0:beam('Peaked headstone',(0,0,1.2),(0,0,1.48),.4,0,grave,4)
        else:ico('Broken crown',(.12,0,1.2),(.31,.15,.18),grave)
    for k in range(3):box('Recessed inscription',(0,-.126,.53+k*.115),(.29-k*.045,.012,.024),grave[2],.005)
    path('Weathering fissure',[(.15,-.135,1.08),(.08,-.14,.95),(.17,-.14,.81)],.01,grave[2])

def fence():
    for x in [-1.3,1.3]:
        box('Fence pier',(x,0,.62),(.27,.32,1.24),grave)
        beam('Pier finial',(x,0,1.24),(x,0,1.49),.21,0,grave,4)
    for z in [.38,.95]:beam('Iron cross rail',(-1.3,0,z),(1.3,0,z),.032,.032,iron,6)
    for i in range(9):
        x=-1.08+i*.27;h=1.15 if i not in [3,4] else .63
        beam('Iron picket',(x,0,.18),(x+.09*(i==4),0,h),.022,.022,iron,5)
        beam('Spear point',(x,0,h),(x,0,h+.14),.065,0,iron,4)

def roof(cx,cy,z,w,d,h,pal):
    mesh('Steep slate roof',[(cx-w/2,cy-d/2,z),(cx+w/2,cy-d/2,z),(cx+w/2,cy+d/2,z),(cx-w/2,cy+d/2,z),(cx,cy-d/2,z+h),(cx,cy+d/2,z+h)],[(0,4,1),(3,2,5),(0,3,5,4),(1,4,5,2),(0,1,2,3)],pal)
    beam('Roof ridge cap',(cx,cy-d/2-.07,z+h+.025),(cx,cy+d/2+.07,z+h+.025),.06,.06,pal[1],6)
    for side in [-1,1]:
        for row in range(1,5):
            t=row/5;x=cx+side*w/2*t;zz=z+h*(1-t)+.018
            beam('Slate course edge',(x,cy-d/2,zz),(x,cy+d/2,zz),.012,.012,pal[2],4)
        for i in range(1,7):
            y=cy-d/2+i*d/7
            beam('Roof seam',(cx,y,z+h+.02),(cx+side*w/2,y,z+.02),.009,.009,pal[2],4)

def mausoleum():
    box('Crypt foundation',(0,0,.15),(3,2.5,.3),grave)
    box('Crypt chamber',(0,.25,1.2),(2.4,1.8,2.1),grave)
    box('Recessed crypt door',(0,-.67,1),(.95,.035,1.65),grave[2])
    for x in [-.7,.7]:box('Door pilaster',(x,-.78,1.1),(.23,.23,2),grave)
    roof(0,.2,2.3,2.8,2.4,.95,grave)
    box('Door lintel',(0,-.8,2.04),(1.6,.3,.22),grave)
    for x in [-.3,0,.3]:beam('Crypt grille',(x,-.71,.3),(x,-.71,1.78),.018,.018,iron,5)
    ico('Door seal',(0,-.74,1.15),(.13,.035,.13),gold)
    for side in [-1,1]:
        for z in [.65,1.2,1.75]:
            box('Crypt side panel',(side*1.215,.25,z),(.025,1.28,.36),grave[1],.015)
        box('Crypt corner column',(side*1.06,-.7,1.3),(.16,.17,1.95),grave[1])
    beam('Crypt crest',(0,.2,3.2),(0,.2,3.65),.04,.035,iron,5)
    beam('Crypt crest arms',(-.16,.2,3.48),(.16,.2,3.48),.035,.035,iron,5)

def cathedral(part):
    if part=='tower':
        box('Tower shaft',(0,0,2.5),(1.8,1.8,5),grave)
        for z in [.2,2.8,4.5,5]:box('Tower stringcourse',(0,0,z),(2,2,.17),grave)
        beam('Octagonal spire',(0,0,5),(0,0,7.5),1.35,0,grave,8)
        for x in [-.55,.55]:box('Belfry slit',(x,-.913,4.1),(.27,.025,.8),grave[2])
        for x in [-.83,.83]:
            for y in [-.83,.83]:box('Tower corner rib',(x,y,2.5),(.2,.2,5.1),grave[1])
        for z in [1,1.7,2.4]:box('Tower narrow window',(0,-.915,z),(.23,.025,.43),grave[2],.015)
        beam('Spire needle',(0,0,7.4),(0,0,7.9),.045,0,iron)
    elif part=='nave':
        box('Nave wall',(0,0,1.8),(4,2.4,3.6),grave)
        roof(0,0,3.6,4.4,2.8,1.7,grave)
        for x in [-1.45,-.5,.5,1.45]:
            box('Lancet recess',(x,-1.215,2.3),(.33,.025,1.35),grave[2])
            beam('Lancet point',(x,-1.22,2.98),(x,-1.22,3.23),.19,0,grave[2],4)
        for x in [-1.9,0,1.9]:box('Wall buttress',(x,-1.38,1.5),(.24,.55,3),grave)
    else:
        for x in [-.9,.9]:
            box('Buttress pier',(x,0,1.8),(.45,.6,3.6),grave)
            beam('Buttress pinnacle',(x,0,3.6),(x,0,4.5),.38,0,grave,4)
        path('Flying stone brace',[(-.9,0,1.8),(-.4,0,2.6),(.9,0,3.1)],.19,grave)

def bones():
    for i in range(12):
        x,y=random.uniform(-.65,.65),random.uniform(-.4,.4);a=random.random()*math.tau;l=random.uniform(.22,.52)
        aa=(x,y,.12);bb=(x+math.cos(a)*l,y+math.sin(a)*l,.14)
        beam('Long bone',aa,bb,.035,.025,ivory,6)
        for p in [aa,bb]:ico('Bone joint',p,(.065,.055,.06),ivory)
    ico('Weathered skull',(.12,-.14,.25),(.18,.15,.18),ivory,2)
    for x in [.055,.185]:ico('Eye socket',(x,-.277,.28),(.04,.018,.048),grave[2])
    for i in range(6):ico('Grave rubble',(random.uniform(-.8,.8),random.uniform(-.45,.45),.075),(.16,.12,.1),grave)

def waystone():
    box('Waystone footing',(0,0,.1),(.95,.8,.2),stone,.09)
    beam('Weathered hexagonal marker',(0,0,.2),(.06,0,1.9),.4,.29,stone,6)
    beam('Marker crown',(.06,0,1.9),(.06,0,2.18),.35,.04,stone,6)
    for i in range(13):
        a=i*math.tau/12;b=(i+1)*math.tau/12
        beam('Sunwheel engraving',(.04+math.cos(a)*.16,-.292,1.43+math.sin(a)*.16),(.04+math.cos(b)*.16,-.292,1.43+math.sin(b)*.16),.014,.014,gold,4)
    for z in [.5,.65,.8]:box('Old waymark glyph',(.04,-.316,z),(.17,.015,.025),stone[2],.005)
    path('Marker fracture',[(.18,-.32,.92),(.1,-.34,1.08),(.16,-.32,1.22)],.011,stone[2])
    for i in range(5):ico('Weathered base moss',(random.uniform(-.35,.35),random.uniform(-.3,.3),.2),(.18,.12,.035),moss)

def fern():
    fern_leaf=mat('Fern / sage',linear_hex('7F9F70'))
    for k in range(9):
        a=k*math.tau/9;length=random.uniform(.65,1.05)
        pts=[]
        for i in range(9):
            t=i/8;r=length*t;pts.append((math.cos(a)*r,math.sin(a)*r,.04+math.sin(t*math.pi*.75)*length*.6))
        path('Arched fern rachis',pts,.012,dark[1])
        for i in range(1,8):
            t=i/8;cx,cy,cz=pts[i];w=length*.30*math.sin(t*math.pi)*(.8+random.random()*.2)
            for side in [-1,1]:
                dx,dy=math.cos(a+side*1.15)*w,math.sin(a+side*1.15)*w
                px,py=-dy/w*.045,dx/w*.045
                mesh('Tapered fern leaflet',[(cx,cy,cz),(cx+dx*.48+px,cy+dy*.48+py,cz+.045),(cx+dx,cy+dy,cz+.025),(cx+dx*.48-px,cy+dy*.48-py,cz+.035)],[(0,2,1),(0,3,2)],[fern_leaf,dark[2]])

def fir():
    path('Old fir trunk',[(0,0,0),(.08,0,1.8),(-.06,.06,3.5),(0,0,5.1)],.23,bark)
    for k in range(6):
        a=k*math.tau/6
        path('Fir root',[(0,0,.3),(math.cos(a)*.45,math.sin(a)*.45,.1),(math.cos(a)*.8,math.sin(a)*.8,.02)],.1,bark)
    for level in range(6):
        z=1.25+level*.58;spread=1.6*(1-level*.12)
        for k in range(7):
            a=k*math.tau/7+level*.55;end=(math.cos(a)*spread,math.sin(a)*spread,z-.18)
            beam('Fir bough',(0,0,z+.12),end,.045,.012,bark,6)
            for j in [0,1]:
                d=spread*(.55+j*.27)
                o=ico('Flat needle spray',(math.cos(a)*d,math.sin(a)*d,z+.07-j*.1),(spread*.47,.26-level*.025,.16),dark,1)
                o.rotation_euler.z=a
    beam('Fir leader',(0,0,4.4),(0,0,5.5),.36,0,dark,7)

def lantern():
    box('Lantern foundation',(0,0,.09),(.63,.63,.18),grave)
    beam('Carved lantern pedestal',(0,0,.18),(0,0,1.15),.21,.13,grave,8)
    box('Lantern sill',(0,0,1.17),(.48,.48,.1),iron)
    for x in [-.17,.17]:
        for y in [-.17,.17]:beam('Lantern cage',(x,y,1.18),(x,y,1.78),.017,.017,iron,5)
    box('Lantern cornice',(0,0,1.8),(.47,.47,.08),iron)
    beam('Peaked lantern roof',(0,0,1.82),(0,0,2.1),.38,.015,iron,4)
    beam('Candle',(0,0,1.21),(0,0,1.48),.065,.06,ivory,7)
    ico('Living candle flame',(0,0,1.56),(.045,.045,.11),amber,2)
    for side in [-1,1]:
        path('Cage diagonal',[(-.17,-.185,1.28),(.17,-.185,1.67)] if side<0 else [(.17,.185,1.28),(-.17,.185,1.67)],.01,iron)

assets=[]
def asset(biome,name,fn):
    before=set(bpy.data.objects);random.seed('evercast/'+name);fn()
    objs=[o for o in bpy.data.objects if o not in before]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]
    bpy.ops.object.convert(target='MESH');bpy.ops.object.join()
    o=bpy.context.object;o.name=name
    bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    # Ground every standalone asset while retaining a centered placement pivot.
    minz=min(v.co.z for v in o.data.vertices)
    for v in o.data.vertices:v.co.z-=minz
    o.data.calc_loop_triangles()
    folder=OUT/biome;folder.mkdir(exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(folder/(name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
    assets.append({'id':name,'biome':biome,'url':f'/models/environment/{biome}/{name}.glb','triangles':len(o.data.loop_triangles),'dimensionsMeters':[round(x,3) for x in o.dimensions],'object':o})

for v in range(2):asset('greenfields',f'grass_clump_{chr(97+v)}',lambda v=v:grass(28+v*15,.55+v*.2))
for v in range(2):asset('greenfields',f'flower_patch_{chr(97+v)}',lambda v=v:flowers(v))
for v in range(3):asset('greenfields',f'rock_{chr(97+v)}',lambda v=v:rock(v))
for v in range(3):asset('greenfields',f'healthy_tree_{chr(97+v)}',lambda v=v:tree(v))
asset('greenfields','fallen_log',log)
asset('greenfields','small_ruin_stone',ruin_stone)
asset('greenfields','meadow_waystone',waystone)
for v in range(3):asset('whispering_woods',f'dark_tree_{chr(97+v)}',lambda v=v:tree(v,'dark'))
asset('whispering_woods','root_cluster',roots)
asset('whispering_woods','mushroom_patch',mushrooms)
asset('whispering_woods','bush_clump',bush)
for v in range(2):asset('whispering_woods',f'mossy_rock_{chr(97+v)}',lambda v=v:rock(v,True))
asset('whispering_woods','forest_shrine_arch',shrine)
asset('whispering_woods','forest_fern',fern)
asset('whispering_woods','ancient_fir',fir)
for v in range(3):asset('gravehollow',f'dead_tree_{chr(97+v)}',lambda v=v:tree(v,'dead'))
for v in range(3):asset('gravehollow',f'gravestone_{chr(97+v)}',lambda v=v:tomb(v))
asset('gravehollow','broken_fence_segment',fence)
asset('gravehollow','ruined_arch',lambda:arch(grave,True))
asset('gravehollow','mausoleum',mausoleum)
asset('gravehollow','graveyard_gate',lambda:arch(grave,width=2.6))
for part in ['tower','nave','buttress']:asset('gravehollow','cathedral_'+part,lambda part=part:cathedral(part))
asset('gravehollow','bone_pile_rubble',bones)
asset('gravehollow','vigil_lantern',lantern)

manifest={'version':1,'units':'meters','upAxis':'Y (GLB), Z (Blender)','pivot':'ground center','style':'faceted low-poly fantasy; modeled details; no textures required','assets':[{k:v for k,v in a.items() if k!='object'} for a in assets]}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

# Actual-scale editable source library, organized into biome collections.
for biome in ['greenfields','whispering_woods','gravehollow']:
    coll=bpy.data.collections.new(biome);bpy.context.scene.collection.children.link(coll)
    group=[a for a in assets if a['biome']==biome]
    for i,a in enumerate(group):
        o=a['object']
        for c in list(o.users_collection):c.objects.unlink(o)
        coll.objects.link(o);o.location=(i%4*10,-(i//4)*10,0)
    coll.hide_viewport=biome!='greenfields';coll.hide_render=biome!='greenfields'
bpy.context.scene.unit_settings.system='METRIC'
bpy.context.preferences.filepaths.save_version=0
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_distance=37
            area.spaces.active.region_3d.view_location=(14,-10,1)
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'evercast_environment.blend'))

# Orthographic studio contact sheets. Each cell is normalized for readable detail.
scene=bpy.context.scene
for coll in scene.collection.children:coll.hide_render=False
for a in assets:a['object'].hide_render=True
scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1800;scene.render.resolution_y=1700;scene.render.resolution_percentage=100
scene.world.color=(.20,.20,.20)
scene.view_settings.view_transform='AgX'
back=mat('Preview / charcoal',(.022,.033,.037));label=mat('Preview / lettering',(.71,.78,.72))
box('Studio floor',(0,0,-.14),(60,60,.2),back)
def aim(o,point):o.rotation_euler=(Vector(point)-o.location).to_track_quat('-Z','Y').to_euler()
for loc,power,size in [((-8,-10,18),2600,10),((10,3,12),1900,9)]:
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;aim(o,(0,0,0))
bpy.ops.object.camera_add(location=(0,-24,21));camera=bpy.context.object;aim(camera,(0,0,0));camera.data.type='ORTHO';camera.data.ortho_scale=19;scene.camera=camera
for biome in ['greenfields','whispering_woods','gravehollow']:
    temps=[];group=[a for a in assets if a['biome']==biome]
    rows=math.ceil(len(group)/4)
    camera.data.ortho_scale=21 if rows==4 else 19
    for i,a in enumerate(group):
        src=a['object'];o=src.copy();o.data=src.data.copy();scene.collection.objects.link(o);o.hide_render=False
        s=2.4/max(src.dimensions);o.scale=(s,s,s);o.rotation_euler.z=-.22;o.location=((i%4-1.5)*4.4,(rows-1)*2.9-(i//4)*5.8,0);temps.append(o)
        bpy.ops.object.text_add(location=(o.location.x,o.location.y-1.65,.12),rotation=camera.rotation_euler)
        t=bpy.context.object;t.data.body=a['id'].replace('_',' ').upper();t.data.align_x='CENTER';t.data.size=.185;t.data.materials.append(label);temps.append(t)
    bpy.ops.object.text_add(location=(0,(rows-1)*2.9+4,.4),rotation=camera.rotation_euler)
    t=bpy.context.object;t.data.body='EVERCAST  /  '+biome.replace('_',' ').upper();t.data.align_x='CENTER';t.data.size=.43;t.data.materials.append(label);temps.append(t)
    scene.render.filepath=str(ART/(biome+'_preview.png'));bpy.ops.render.render(write_still=True)
    for o in temps:bpy.data.objects.remove(o,do_unlink=True)
print('EVERCAST_COMPLETE',len(assets),'assets',sum(a['triangles'] for a in assets),'triangles')

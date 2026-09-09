"""Evercast articulated low-poly cast. Blender 5.2, deterministic, no external assets.
Rigid joint animation deliberately preserves the carved, faceted art direction.
"""
import bpy, math, json, random
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/models/characters'; ART=ROOT/'art/characters'
OUT.mkdir(parents=True,exist_ok=True); ART.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
random.seed(9281)

def material(name,hex,metal=False,emission=0):
    rgb=[int(hex[i:i+2],16)/255 for i in (0,2,4)]
    rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    m=bpy.data.materials.new(name);m.diffuse_color=(*rgb,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,1)
    p.inputs['Roughness'].default_value=.78 if metal else 1;p.inputs['Metallic'].default_value=.35 if metal else 0
    p.inputs['Specular IOR Level'].default_value=.2 if metal else 0
    p.inputs['Emission Color'].default_value=(*rgb,1);p.inputs['Emission Strength'].default_value=emission
    return m
cloth=material('Cast / midnight plum','625579'); fold=material('Cast / lavender fold','7C6A91')
lining=material('Cast / warm lining','C0A789'); leather=material('Cast / oxblood leather','654A43')
skin=material('Cast / warm skin','D3A17A'); hair=material('Cast / silver beard','B8BDB0')
dark=material('Cast / ink','252E36'); bronze=material('Iron / cast bronze','A78D58',True)
gem=material('Arcane / amethyst','9D8DDD',False,.65); eye=material('Arcane / amber eye','E6BA65',False,.35)
green=material('Cast / moss green','708B56'); greenLight=material('Cast / sage edge','93A978')
bark=material('Cast / weathered bark','74654E'); barkLight=material('Cast / cut bark','9B8964')
red=material('Cast / terracotta','A96850'); horn=material('Cast / old ivory','C2B391')
slate=material('Cast / blue slate','536572'); edge=material('Cast / slate edge','778588')
feather=material('Cast / crow plumage','424956'); featherEdge=material('Cast / feather edge','687080')
ember=material('Arcane / ember heart','F3A855',False,1.2); flame=material('Cast / amber flame','C97847')

def node(name,parent=None,loc=(0,0,0)):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;o.location=loc;return o
def finish(o,name,m,parent):
    o.name=name;o.data.materials.append(m);o.parent=parent;return o
def ico(name,loc,size,m,parent,sub=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1)
    o=bpy.context.object;o.location=loc;o.scale=size
    return finish(o,name,m,parent)
def beam(name,a,b,r1,r2,m,parent,n=8):
    d=Vector(b)-Vector(a);bpy.ops.mesh.primitive_cone_add(vertices=n,radius1=r1,radius2=r2,depth=d.length)
    o=bpy.context.object;o.location=(Vector(a)+Vector(b))/2;o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
    return finish(o,name,m,parent)
def box(name,loc,size,m,parent):
    bpy.ops.mesh.primitive_cube_add(size=1);o=bpy.context.object;o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    bevel=o.modifiers.new('Hand-cut edges','BEVEL');bevel.width=min(size)*.15;bevel.segments=1
    bpy.ops.object.modifier_apply(modifier=bevel.name);o.location=loc
    return finish(o,name,m,parent)
def mesh(name,verts,faces,m,parent):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);return finish(o,name,m,parent)
def torus(name,loc,major,minor,m,parent,rot=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_segments=12,minor_segments=4,major_radius=major,minor_radius=minor)
    o=bpy.context.object;o.location=loc;o.rotation_euler=rot;return finish(o,name,m,parent)
def ringsurface(name,rings,m,parent,n=12):
    verts=[]
    for x,y,z,r in rings:
        for i in range(n):
            a=i*math.tau/n;verts.append((x+math.cos(a)*r,y+math.sin(a)*r,z))
    faces=[tuple(reversed(range(n)))]
    for j in range(len(rings)-1):
        for i in range(n):a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    faces.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    return mesh(name,verts,faces,m,parent)
def eyes(parent,z,y=-.24,width=.12):
    for x in [-width,width]:
        ico('Deep eye socket',(x,y,z),(.073,.033,.054),dark,parent)
        ico('Amber iris',(x,y-.027,z),(.027,.018,.032),eye,parent)

assets=[]; models=[]; gears={}
def mage():
    root=node('mage'); body=node('joint_body',root,(0,0,.84)); joints={'body':body}
    robe=node('gear_robe',body);gears['robe']=robe
    ringsurface('Tailored robe',[(0,0,-.57,.39),(0,0,-.30,.34),(0,0,.05,.25),(0,0,.41,.31)],cloth,robe)
    for i in range(10):
        a=i*math.tau/10
        beam('Stitched skirt pleat',(math.cos(a)*.38,math.sin(a)*.38,-.53),(math.cos(a)*.255,math.sin(a)*.255,.04),.023,.012,fold,robe,4)
    torus('Woven hem',(0,0,-.53),.385,.018,lining,robe)
    beam('Leather belt',(0,0,.04),(0,0,.12),.27,.27,leather,robe,12)
    box('Belt clasp',(0,-.277,.08),(.13,.027,.095),bronze,robe)
    # Layered shoulder mantle, sewn front opening and moon clasp.
    ringsurface('Shoulder mantle',[(0,0,.27,.36),(0,0,.43,.32),(0,0,.47,.20)],fold,robe)
    for x in [-.075,.075]:beam('Robe front piping',(x,-.31,-.48),(x,-.265,.27),.011,.009,lining,robe,4)
    head=node('joint_head',body,(0,0,.66));joints['head']=head
    ico('Sculpted face',(0,-.025,0),(.215,.19,.245),skin,head,2)
    ico('Angular nose',(0,-.213,-.005),(.055,.084,.063),skin,head)
    for x in [-.078,.078]:
        ico('Quiet eyes',(x,-.203,.042),(.029,.015,.021),dark,head)
        beam('Silver brow',(x-.043,-.197,.082),(x+.042,-.197,.076),.016,.012,hair,head,5)
    for i in range(7):
        x=(i-3)*.048
        beam('Carved beard lock',(x,-.174,-.085),(x*.6,-.19,-.32+abs(i-3)*.039),.053,.008,hair,head,5)
    helm=node('gear_helm',head,(0,0,.16));gears['helm']=helm
    ringsurface('Bent travelling hat',[(0,0,0,.40),(0,0,.047,.40),(0,0,.06,.235),(-.025,.02,.35,.16),(-.14,.04,.63,.08),(-.28,.035,.65,.008)],cloth,helm)
    beam('Hat ribbon',(0,0,.07),(-.004,0,.13),.24,.225,leather,helm,12)
    ico('Hat brooch',(0,-.234,.1),(.058,.026,.06),bronze,helm)
    boots=node('gear_boots',root);gears['boots']=boots
    for side in [-1,1]:
        leg=node('joint_leg_'+str(side),boots,(side*.17,0,.43));joints['leg'+str(side)]=leg
        beam('Boot shaft',(0,0,0),(0,0,-.27),.10,.12,leather,leg)
        box('Turned boot toe',(0,-.09,-.32),(.225,.36,.16),leather,leg)
        box('Leather sole',(0,-.09,-.39),(.23,.37,.035),dark,leg)
        box('Boot buckle',(side*.103,-.045,-.12),(.032,.095,.065),bronze,leg)
    for side in [-1,1]:
        arm=node('joint_arm_'+str(side),body,(side*.31,0,.32));joints['arm'+str(side)]=arm
        beam('Bell sleeve',(0,0,0),(side*.105,-.035,-.31),.15,.18,cloth,arm)
        beam('Sleeve trim',(side*.10,-.035,-.27),(side*.11,-.038,-.32),.18,.18,lining,arm)
        ico('Mitten hand',(side*.11,-.055,-.36),(.10,.09,.12),skin,arm,2)
        ring=node('gear_ringRight' if side==1 else 'gear_ringLeft',arm,(side*.11,-.145,-.36))
        gears['ringRight' if side==1 else 'ringLeft']=ring
        torus('Engraved ring',(0,0,0),.04,.012,bronze,ring,(math.pi/2,0,0))
        ico('Ring stone',(0,-.018,.025),(.026,.024,.027),gem,ring)
    staff=node('gear_staff',joints['arm1'],(.14,-.07,-.32));gears['staff']=staff
    beam('Crooked ash staff',(0,0,-.72),(.07,0,1.04),.038,.048,bark,staff)
    beam('Staff foot ferrule',(0,0,-.72),(.005,0,-.57),.045,.04,bronze,staff)
    for z in [-.08,.0,.08]:torus('Grip binding',(.03,0,z),.047,.012,leather,staff)
    for side in [-1,1]:
        beam('Crystal cradle',(.065,0,.87),(side*.13+.07,0,1.1),.035,.023,bronze,staff,6)
    ico('Amethyst focus',(.07,0,1.15),(.13,.115,.22),gem,staff)
    node('socket_spell',staff,(.07,0,1.28))
    book=node('gear_spellbook',joints['arm-1'],(-.12,-.16,-.30));gears['spellbook']=book
    box('Bound parchment',(0,0,0),(.32,.085,.40),lining,book)
    for y in [-.063,.063]:box('Tooled book cover',(0,y,0),(.36,.033,.44),leather,book)
    box('Book spine',(-.17,0,0),(.045,.15,.44),leather,book)
    for x in [-.13,.13]:
        for z in [-.17,.17]:box('Brass book corner',(x,-.085,z),(.065,.018,.065),bronze,book)
    torus('Book sun emblem',(0,-.085,0),.075,.013,bronze,book,(math.pi/2,0,0))
    neck=node('gear_necklace',body,(0,-.32,.25));gears['necklace']=neck
    for side in [-1,1]:beam('Pendant chain',(side*.12,.015,.14),(0,0,-.04),.01,.01,bronze,neck,5)
    ico('Moon pendant',(0,-.017,-.065),(.065,.028,.087),gem,neck)
    # Five cumulative, socket-local modeled upgrades for the six equipment milestones.
    for slot,g in gears.items():
        for tier in range(1,6):
            detail=node('upgrade_'+slot+'_'+str(tier),g);detail['gearTier']=tier;detail['gearSlot']=slot
            a=(tier-3)*.30
            if slot=='helm':
                beam('Crown filigree',(math.sin(a)*.28,-math.cos(a)*.28,.055),(math.sin(a)*.30,-math.cos(a)*.30,.12+tier*.023),.025,.009,bronze,detail,5)
            elif slot=='staff':
                a=tier*math.tau/5
                beam('Astral prong',(.07+math.cos(a)*.09,math.sin(a)*.09,.92),(.07+math.cos(a)*.18,math.sin(a)*.18,1.30),.025,.007,bronze,detail,5)
            elif slot=='robe':
                box('Embroidered rune',((tier-3)*.075,-.343,-.33),(.028,.012,.10),bronze,detail)
            elif slot=='boots':
                detail.parent=joints['leg-1']
                ico('Boot rune',((tier-3)*.024,-.275,-.31),(.012,.015,.027),gem,detail)
                mirrored=node('upgrade_boots_'+str(tier)+'_R',joints['leg1'])
                mirrored['gearTier']=tier;mirrored['gearSlot']='boots'
                ico('Boot rune',((tier-3)*.024,-.275,-.31),(.012,.015,.027),gem,mirrored)
            elif slot=='spellbook':
                ico('Cover constellation',((tier-3)*.046,-.089,.115),(.016,.014,.024),gem,detail)
            else:
                ico('Jewelled setting',((tier-3)*.018,-.035,-.085 if slot=='necklace' else .032),(.014,.018,.02),gem,detail)
    return root,joints

def slime():
    root=node('moss_slime');body=node('joint_body',root,(0,0,.05))
    ico('Mossback body',(0,0,.44),(.60,.46,.49),green,body,2)
    for x in [-.31,0,.31]:ico('Soft foot lobe',(x,-.21,.09),(.24,.30,.12),green,body)
    for i in range(9):
        a=i*2.4;ico('Moss cushion',(math.cos(a)*.39,math.sin(a)*.29,.68+random.random()*.1),(.15,.13,.085),greenLight,body)
    eyes(body,.48,-.424,.16)
    beam('Mouth seam',(-.09,-.455,.30),(.1,-.455,.30),.014,.014,dark,body,5)
    for x in [-.18,.22]:beam('Sprout stem',(x,.03,.8),(x+.05,.03,1.03),.014,.009,bark,body,5);ico('Sprout leaf',(x+.10,.03,.96),(.115,.028,.05),greenLight,body)
    return root,{'body':body}
def briarling():
    root=node('briarling');body=node('joint_body',root,(0,0,.72));j={'body':body}
    ringsurface('Split heartwood',[(0,0,-.34,.22),(.02,0,0,.32),(0,0,.31,.20)],bark,body,7)
    for i in range(6):
        a=i*math.tau/6;beam('Bark ridge',(math.cos(a)*.23,math.sin(a)*.23,-.25),(math.cos(a)*.25,math.sin(a)*.25,.21),.026,.014,barkLight,body,4)
    eyes(body,.14,-.25,.10)
    for side in [-1,1]:
        arm=node('joint_arm_'+str(side),body,(side*.24,0,.10));j['arm'+str(side)]=arm
        beam('Branch arm',(0,0,0),(side*.29,-.05,-.20),.075,.04,bark,arm)
        for k in range(3):beam('Twig claw',(side*.29,-.05,-.20),(side*(.38+k*.025),-.09+k*.06,-.30),.025,.007,barkLight,arm,5)
        leg=node('joint_leg_'+str(side),root,(side*.16,0,.38));j['leg'+str(side)]=leg
        beam('Root leg',(0,0,0),(side*.07,-.1,-.31),.09,.065,bark,leg)
        ico('Leaf shoulder',(side*.28,.03,.22),(.22,.14,.12),green,body)
        beam('Antler branch',(side*.12,0,.27),(side*.32,0,.70),.055,.008,bark,body)
        beam('Antler fork',(side*.23,0,.52),(side*.40,-.025,.58),.029,.005,barkLight,body)
        ico('Antler leaf',(side*.29,0,.69),(.12,.06,.08),greenLight,body)
    return root,j
def imp():
    root=node('road_imp');body=node('joint_body',root,(0,0,.69));j={'body':body}
    ico('Imp torso',(0,0,0),(.23,.18,.29),red,body,2)
    head=node('joint_head',body,(0,-.015,.38));j['head']=head
    ico('Imp face',(0,0,0),(.27,.20,.23),red,head,2);eyes(head,.03,-.19,.11)
    for s in [-1,1]:
        beam('Swept horn',(s*.17,.015,.13),(s*.29,.05,.39),.075,.008,horn,head)
        ico('Pointed ear',(s*.29,.0,.02),(.16,.05,.07),red,head)
        beam('Small tusk',(s*.08,-.19,-.10),(s*.075,-.23,-.035),.027,.004,horn,head,5)
        arm=node('joint_arm_'+str(s),body,(s*.20,0,.13));j['arm'+str(s)]=arm
        beam('Wiry arm',(0,0,0),(s*.16,-.06,-.23),.068,.055,red,arm)
        ico('Imp fist',(s*.16,-.08,-.26),(.095,.07,.09),red,arm)
        leg=node('joint_leg_'+str(s),root,(s*.12,0,.45));j['leg'+str(s)]=leg
        beam('Bent leg',(0,0,0),(s*.04,.07,-.24),.073,.04,red,leg)
        box('Cloven hoof',(s*.04,-.045,-.35),(.15,.23,.18),dark,leg)
    beam('Belt',(0,0,-.12),(0,0,-.04),.24,.245,leather,body)
    beam('Tail',(0,.12,-.12),(.34,.39,-.18),.035,.025,red,body)
    beam('Tail tip',(.34,.39,-.18),(.45,.42,.05),.07,.002,red,body,4)
    beam('Rusty knife',(-.36,-.09,-.06),(-.40,-.1,.30),.06,.003,bronze,body,4)
    return root,j
def beetle():
    root=node('ash_beetle');body=node('joint_body',root,(0,0,.38));j={'body':body}
    ico('Charcoal abdomen',(0,.09,.05),(.40,.55,.27),dark,body,2)
    for s in [-1,1]:
        ico('Split elytron',(s*.18,.08,.18),(.225,.49,.20),slate,body,2)
        for k in range(3):
            leg=node('joint_leg_'+str(s)+'_'+str(k),body,(s*.29,k*.27-.27,-.03));j['leg'+str(s)+'_'+str(k)]=leg
            beam('Armored leg',(0,0,0),(s*.26,-.06,-.02),.042,.026,edge,leg)
            beam('Hooked tarsus',(s*.26,-.06,-.02),(s*.33,-.13,-.31),.03,.009,dark,leg)
        beam('Mandible',(s*.12,-.52,-.02),(s*.25,-.76,-.03),.055,.02,horn,body)
        beam('Mandible hook',(s*.25,-.76,-.03),(s*.10,-.80,.0),.025,.004,horn,body)
        for i in range(4):box('Carapace ridge',(s*.19,.31-i*.16,.35),(.27,.025,.018),edge,body)
    ico('Beetle head',(0,-.43,.03),(.23,.20,.17),slate,body);eyes(body,.09,-.6,.11)
    return root,j
def crow():
    root=node('hollow_crow');body=node('joint_body',root,(0,0,.82));j={'body':body}
    ico('Crow breast',(0,0,0),(.19,.29,.28),feather,body,2)
    ico('Crow head',(0,-.20,.27),(.17,.18,.17),feather,body,2)
    beam('Ivory beak',(0,-.31,.26),(0,-.57,.21),.09,.002,horn,body,4)
    eyes(body,.30,-.352,.09)
    for s in [-1,1]:
        wing=node('joint_arm_'+str(s),body,(s*.14,0,.10));j['arm'+str(s)]=wing
        ico('Wing shoulder',(s*.18,.03,0),(.30,.21,.09),feather,wing)
        for i in range(6):
            beam('Layered flight feather',(s*(.13+i*.047),i*.048-.07,0),(s*(.55+i*.055),.12+i*.10,-.075-i*.018),.075,.004,featherEdge if i%2 else feather,wing,5)
        beam('Bird leg',(s*.09,-.01,-.17),(s*.09,-.09,-.44),.018,.015,dark,body,5)
        for k in range(3):beam('Talon',(s*.09,-.09,-.44),(s*.09+(k-1)*.035,-.20,-.45),.014,.002,horn,body,4)
    for i in range(5):beam('Tail feather',((i-2)*.05,.12,-.1),((i-2)*.085,.63,-.20),.07,.006,feather,body,5)
    return root,j
def warden():
    root=node('road_warden');body=node('joint_body',root,(0,0,1.04));j={'body':body}
    ringsurface('Sentinel cuirass',[(0,0,-.35,.25),(0,0,.17,.43),(0,0,.38,.32)],slate,body,8)
    box('Chest heraldry',(0,-.366,.10),(.23,.025,.31),bronze,body)
    ico('Heart sigil',(0,-.40,.12),(.065,.026,.12),gem,body)
    head=node('joint_head',body,(0,0,.61));j['head']=head
    ringsurface('Closed sentinel helm',[(0,0,-.19,.22),(0,0,.15,.25),(0,0,.30,.05)],slate,head,8)
    box('Visor slit',(0,-.232,.015),(.32,.018,.038),dark,head)
    for s in [-1,1]:
        box('Watchful eye',(s*.082,-.248,.016),(.047,.016,.013),eye,head)
        arm=node('joint_arm_'+str(s),body,(s*.37,0,.18));j['arm'+str(s)]=arm
        ico('Layered pauldron',(s*.03,0,.01),(.24,.25,.20),edge,arm)
        beam('Arm guard',(s*.07,0,-.05),(s*.13,0,-.40),.11,.09,slate,arm)
        ico('Gauntlet',(s*.13,-.025,-.46),(.13,.12,.14),edge,arm)
        leg=node('joint_leg_'+str(s),root,(s*.19,0,.69));j['leg'+str(s)]=leg
        beam('Greave',(0,0,0),(s*.015,0,-.48),.13,.105,slate,leg)
        box('Iron sabaton',(s*.015,-.09,-.58),(.27,.38,.19),edge,leg)
        box('Hanging fauld',(s*.20,-.14,-.39),(.22,.16,.28),slate,body)
    shield=j['arm1']
    box('Shield face',(.14,-.19,-.27),(.43,.07,.62),slate,shield)
    box('Shield sun',(.14,-.235,-.25),(.07,.02,.39),bronze,shield)
    weapon=j['arm-1'];beam('War pick haft',(-.13,0,-.65),(-.13,0,.26),.035,.035,bark,weapon)
    box('Hammer head',(-.13,0,.27),(.43,.20,.23),edge,weapon)
    return root,j
def hound():
    root=node('crypt_hound');body=node('joint_body',root,(0,0,.72));j={'body':body}
    ico('Hound ribcage',(0,.02,0),(.26,.48,.27),feather,body,2)
    for s in [-1,1]:
        for i in range(4):beam('Exposed rib',(s*.20,-.24+i*.14,.11),(s*.25,-.20+i*.14,-.13),.025,.02,horn,body,5)
        for k in range(2):
            leg=node('joint_leg_'+str(s)+'_'+str(k),body,(s*.18,-.30+k*.63,-.08));j['leg'+str(s)+'_'+str(k)]=leg
            beam('Hound shank',(0,0,0),(s*.02,.08,-.32),.067,.038,feather,leg)
            beam('Bone ankle',(s*.02,.08,-.32),(s*.03,-.025,-.53),.04,.025,horn,leg)
            ico('Clawed paw',(s*.03,-.07,-.58),(.09,.14,.065),feather,leg)
    head=node('joint_head',body,(0,-.40,.14));j['head']=head
    ico('Hound skull',(0,-.06,.02),(.20,.23,.21),horn,head,2)
    ico('Long muzzle',(0,-.26,-.04),(.13,.21,.105),horn,head)
    ico('Nose',(0,-.42,-.025),(.09,.05,.055),dark,head)
    eyes(head,.09,-.244,.125)
    for s in [-1,1]:
        beam('Torn ear',(s*.12,.005,.14),(s*.20,.04,.39),.09,.003,feather,head,4)
        for i in range(3):beam('Fang',(s*.11,-.21-i*.06,-.07),(s*.10,-.21-i*.06,-.16),.02,.002,horn,head,4)
    beam('Skeletal tail',(0,.39,.05),(.10,.76,.26),.06,.009,horn,body)
    return root,j
def wisp():
    root=node('ember_wisp');body=node('joint_body',root,(0,0,.87));j={'body':body}
    ico('Living ember',(0,0,0),(.23,.20,.30),ember,body,2)
    for i in range(5):
        a=i*math.pi/4;x=math.cos(a)*.25;y=math.sin(a)*.22
        ringsurface('Rising flame shard',[(x,y,-.19,.075),(x*.9,y*.9,.13,.12),(x*.55,y*.55,.51+random.random()*.13,.004)],flame,body,5)
    eyes(body,.06,-.206,.085)
    for i in range(3):ico('Orbiting cinder',(.35*math.cos(i*2.1),.32*math.sin(i*2.1),-.30+i*.23),(.045,.045,.09),ember,body)
    beam('Trailing spark',(0,0,-.21),(.08,0,-.55),.15,.003,ember,body,7)
    return root,j

CLIPS={'idle':48,'walk':24,'attack':20,'hit':10,'death':26}

# Motion curves. The clips used to be pure sine, which is why every action read
# as soft: a sine rises and falls symmetrically, so there is no anticipation
# before a strike, no snap in it, and no follow-through after. These three
# shapes are the whole difference between a gesture and a hit.
def clamp01(t): return 0. if t<0 else 1. if t>1 else t
def ease_out(t,p=3): return 1-(1-clamp01(t))**p
def ease_in(t,p=3): return clamp01(t)**p
def damp(t,freq=1.8,decay=4.5): return math.sin(t*math.tau*freq)*math.exp(-t*decay)

# The projectile leaves the staff at exactly half the clip - CombatVfxPlan sets
# release to castDuration * 0.5 - so the strike is timed to peak there: wind
# back through the first third, snap through the next fifth, arrive at 0.5.
WIND=.32; SNAP=.18
def strike(t):
    t=clamp01(t)
    if t<WIND: return -.55*ease_out(t/WIND,2)
    if t<WIND+SNAP: return -.55+1.55*ease_out((t-WIND)/SNAP,3)
    u=(t-WIND-SNAP)/(1-WIND-SNAP)
    # Settles rather than stopping; the overshoot is the follow-through.
    return (1-ease_out(u,2))*(1+.35*damp(u))

def recoil(t):
    # A hit is already over by the time it starts, so this is full at the first
    # frame and springs back through rest instead of easing in from it.
    t=clamp01(t)
    return (1-ease_in(t,2))*math.cos(t*math.tau*1.15)*math.exp(-t*3.1)

def collapse(t):
    # Rears back, then falls under its own weight and settles.
    t=clamp01(t)
    if t<.18: return -.10*math.sin(t/.18*math.pi)
    u=(t-.18)/.82
    return ease_in(u,1.6)*(1+.05*damp(u,1.2,6))

def animate(root,joints):
    # Named NLA tracks merge into one glTF animation per state, with all rigid joints.
    for name,frames in CLIPS.items():
        for role,o in joints.items():
            base=o.location.copy();scale=o.scale.copy();rot=o.rotation_euler.copy()
            o.animation_data_create();action=bpy.data.actions.new(root.name+'_'+name+'_'+role);o.animation_data.action=action
            for frame in range(1,frames+2):
                t=(frame-1)/frames;wave=math.sin(t*math.tau)
                o.location=base;o.rotation_euler=rot;o.scale=scale
                s=-1 if '-1' in role else 1
                if name=='idle':
                    # The head trails the body's breath rather than moving with it.
                    if role=='body':o.location.z+=.024*wave
                    if role.startswith('arm'):o.rotation_euler.y=s*.035*wave
                    if role=='head':o.rotation_euler.z=.025*math.sin((t-.09)*math.tau)
                elif name=='walk':
                    if role=='body':o.location.z+=.028*(1-math.cos(t*math.tau*2));o.rotation_euler.y=.035*wave
                    if role.startswith('leg'):o.rotation_euler.x=.35*wave*s*(-1 if role.endswith('_1') else 1)
                    if role.startswith('arm'):o.rotation_euler.x=-.20*wave*s
                    # Counter-rotating against the roll is what stops a walk
                    # reading as the whole model swinging as one piece.
                    if role=='head':o.rotation_euler.y=-.05*math.sin((t-.07)*math.tau)
                elif name=='attack':
                    # The arm leads, the body drives, the head follows through.
                    lead=strike(t+.05);drive=strike(t);trail=strike(t-.07)
                    if role=='body':o.location.y-=.30*drive;o.rotation_euler.x=.22*drive
                    if role.startswith('arm'):o.rotation_euler.x=-.95*lead;o.rotation_euler.y=-s*.18*lead
                    if role=='head':o.rotation_euler.x=-.16*trail
                    # Braced, so the lunge has something to push against.
                    if role.startswith('leg'):o.rotation_euler.x=-.14*drive*s
                elif name=='hit':
                    r=recoil(t)
                    if role=='body':o.location.y+=.22*r;o.rotation_euler.x=-.30*r
                    if role=='head':o.rotation_euler.x=-.34*recoil(t-.08)
                    if role.startswith('arm'):o.rotation_euler.x=.28*recoil(t-.05);o.rotation_euler.y=s*.2*r
                elif name=='death':
                    k=collapse(t)
                    if role=='body':o.location.z-=base.z*.7*k;o.rotation_euler.y=1.45*k;o.scale=tuple(1-.20*max(0.,k) for _ in range(3))
                    if role.startswith('arm'):o.rotation_euler.y=s*.5*k;o.rotation_euler.x=-.4*collapse(t-.06)
                    if role=='head':o.rotation_euler.x=.5*collapse(t-.1)
                if root.name=='moss_slime' and role=='body' and name in ['idle','walk','attack','hit']:
                    # A slime has no skeleton to brace with, so it deforms instead.
                    amount=.06*wave if name in ('idle','walk') else (-.22*strike(t) if name=='attack' else .18*recoil(t))
                    o.scale=(1+amount,1+amount,1-amount)
                if root.name=='hollow_crow' and role.startswith('arm') and name in ['idle','walk','attack']:
                    o.rotation_euler.y=s*(.18+wave*.48)
                o.keyframe_insert(data_path='location',frame=frame);o.keyframe_insert(data_path='rotation_euler',frame=frame);o.keyframe_insert(data_path='scale',frame=frame)
            track=o.animation_data.nla_tracks.new();track.name=name
            strip=track.strips.new(action.name,1,action);strip.action_frame_start=1;strip.action_frame_end=frames+1
            o.animation_data.action=None;track.mute=True
            o.location=base;o.rotation_euler=rot;o.scale=scale
    # Exporter reads muted tracks as named clips; leave one active for source preview.
    for o in joints.values():
        for track in o.animation_data.nla_tracks:track.mute=track.name!='idle'

def select_tree(root):
    bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
    for o in root.children_recursive:o.select_set(True)
    bpy.context.view_layer.objects.active=root
def export(root,name,animated=True):
    select_tree(root)
    bpy.context.scene.frame_set(1)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,
        export_yup=True,export_extras=True,export_animations=animated,export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,export_frame_range=False)
    meshes=[o for o in root.children_recursive if o.type=='MESH'];triangles=0
    for o in meshes:o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
    assets.append({'id':name,'url':'/models/characters/'+name+'.glb','triangles':triangles,
        'animations':list(CLIPS) if animated else [],'rig':'articulated transform hierarchy' if animated else 'socket attachment'})

bpy.context.scene.render.fps=24;bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=49
for factory in [mage,slime,briarling,imp,beetle,crow,warden,hound,wisp]:
    root,joints=factory();animate(root,joints);export(root,root.name);models.append(root)
# Standalone socket-space equipment files are also editable and replaceable independently.
for slot,g in gears.items():
    parent=g.parent;loc=g.location.copy();rotation=g.rotation_euler.copy()
    g.parent=None;g.location=(0,0,0);g.rotation_euler=(0,0,0)
    export(g,'gear_'+slot,False)
    g.parent=parent;g.location=loc;g.rotation_euler=rotation
(OUT/'manifest.json').write_text(json.dumps({'version':1,'units':'meters','front':'Blender -Y','assets':assets},indent=2)+'\n')
# Save production source before arranging a separate studio presentation.
for i,r in enumerate(models):r.location=(i%3*4,-(i//3)*4,0)
bpy.context.scene.unit_settings.system='METRIC';bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'evercast_characters.blend'))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1600;scene.render.resolution_y=1600;scene.render.resolution_percentage=100
scene.world.color=(.24,.24,.24);scene.view_settings.view_transform='AgX'
floor=material('Studio / floor','333F45');box('Studio floor',(4,-4,-.09),(20,20,.16),floor,None)
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
for loc,power,size in [((-3,-9,12),1800,8),((9,3,9),2200,7)]:
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.size=size;aim(o,(4,-4,0))
bpy.ops.object.camera_add(location=(9,-23,15));cam=bpy.context.object;aim(cam,(4,-4,.6));cam.data.type='ORTHO';cam.data.ortho_scale=14;scene.camera=cam
scene.render.filepath=str(ART/'cast_preview.png');bpy.ops.render.render(write_still=True)
print('EVERCAST_CAST_COMPLETE',len(assets),'assets',sum(a['triangles'] for a in assets),'triangles')

import { Color3, Mesh, MeshBuilder, Scene, ShaderMaterial, StandardMaterial, VertexBuffer, VertexData } from '@babylonjs/core';

interface Ridge { mesh: Mesh; material: StandardMaterial; depth: number; height: number; speed: number; }

/** A screen-filling sky and three slow-moving landscape layers, independent of chunk lifetime. */
export class WorldBackdrop {
  private readonly sky: Mesh;
  private readonly skyMaterial: ShaderMaterial;
  private readonly ridges: Ridge[] = [];
  private lastDistance = Number.NaN;

  constructor(private readonly scene: Scene) {
    this.skyMaterial = new ShaderMaterial('painted sky', scene, {
      vertexSource: `precision highp float; attribute vec3 position; attribute vec2 uv; varying vec2 vUV;
        void main(){vUV=uv; gl_Position=vec4(position.xy,0.99999,1.0);}`,
      fragmentSource: `precision highp float; varying vec2 vUV; uniform vec3 zenith; uniform vec3 horizon; uniform float daylight; uniform float aspect;
        void main(){
          float h=smoothstep(0.25,1.0,vUV.y);
          vec3 color=mix(horizon,zenith,h);
          vec2 sunUV=(vUV-vec2(0.76,0.955))*vec2(aspect,1.0);
          float halo=exp(-dot(sunUV,sunUV)*20.0);
          float disc=1.0-smoothstep(0.032,0.041,length(sunUV));
          float cloud=pow(max(0.0,sin(vUV.x*14.0+sin(vUV.y*17.0)*1.5)*0.5+0.5),4.0);
          cloud*=exp(-pow((vUV.y-0.72)*11.0,2.0));
          color+=vec3(0.10,0.072,0.03)*halo*daylight;
          color=mix(color,vec3(0.8,0.66,0.39),disc*daylight*0.8);
          color+=cloud*vec3(0.016,0.019,0.017)*daylight;
          gl_FragColor=vec4(color,1.0);
        }`,
    }, { attributes: ['position', 'uv'], uniforms: ['zenith', 'horizon', 'daylight', 'aspect'] });
    this.skyMaterial.backFaceCulling = false;this.skyMaterial.disableDepthWrite = true;
    this.sky = MeshBuilder.CreatePlane('sky backdrop', { size: 2 }, scene);
    this.sky.material = this.skyMaterial;this.sky.alwaysSelectAsActiveMesh = true;this.sky.isPickable = false;
    for (const [depth, height, speed] of [[72, 6.5, 0.16], [46, 3.5, 0.3], [27, 1.8, 0.52]]) {
      const mesh = new Mesh(`ridge-${depth}`, scene);
      const material = new StandardMaterial(`ridge atmosphere-${depth}`, scene);
      material.disableLighting = true;material.fogEnabled = false;material.backFaceCulling = false;
      mesh.material = material;mesh.isPickable = false;
      this.ridges.push({ mesh, material, depth, height, speed });
    }
  }

  update(distance: number, sky: Color3, haze: Color3, foliage: Color3, daylight: number): void {
    this.skyMaterial.setColor3('zenith', sky.scale(1.25 + daylight * 0.75));
    this.skyMaterial.setColor3('horizon', haze.scale(1.1 + daylight * 0.55));
    this.skyMaterial.setFloat('daylight', daylight);
    const engine = this.scene.getEngine();
    this.skyMaterial.setFloat('aspect', engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()));
    for (let layer = 0; layer < this.ridges.length; layer++) {
      const ridge = this.ridges[layer];
      ridge.material.emissiveColor = Color3.Lerp(foliage.scale(0.65), haze, 0.9 - layer * 0.16).scale(2.2 - layer * 0.25);
      if (Math.abs(distance - this.lastDistance) < 0.12) continue;
      const positions: number[] = [], indices: number[] = [], normals: number[] = [];
      for (let i = 0; i <= 120; i++) {
        const x = -180 + i * 3;
        const sample = x + distance * ridge.speed;
        const y = ridge.height + Math.sin(sample * 0.065 + layer * 2) * ridge.height * 0.22
          + Math.sin(sample * 0.17 + layer * 3) * ridge.height * 0.11
          + Math.sin(sample * 0.38) * ridge.height * 0.045;
        positions.push(x, -3, ridge.depth, x, y, ridge.depth);
        if (i < 120) { const a = i * 2; indices.push(a, a + 1, a + 3, a, a + 3, a + 2); }
      }
      if (ridge.mesh.isVerticesDataPresent(VertexBuffer.PositionKind)) ridge.mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
      else {
        VertexData.ComputeNormals(positions, indices, normals);
        const data = new VertexData();data.positions = positions;data.indices = indices;data.normals = normals;data.applyToMesh(ridge.mesh, true);
      }
    }
    if (!Number.isFinite(this.lastDistance) || Math.abs(distance - this.lastDistance) >= 0.12) this.lastDistance = distance;
  }

  dispose(): void {
    this.sky.dispose();this.skyMaterial.dispose();
    for (const ridge of this.ridges) { ridge.mesh.dispose();ridge.material.dispose(); }
  }
}

/**
 * The retro view: the world drawn at a fraction of the pixels and scaled up blocky, a 16-bit look,
 * with everything you read (screens, boards, signs, books: anything showing a canvas, and the TV)
 * drawn on top at full resolution, so text stays sharp.
 */
import * as THREE from 'three';

/** The layer what you read goes on, besides the usual one, for drawing it alone (lights too). */
const READ_LAYER = 1;
/** How often (ms) the scene is looked through again for what you read, as things come and go. */
const RESORT_MS = 500;

/** Something you read: a mesh showing a canvas or a video. */
function readable(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return false;
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return mats.some((mat) => {
    const map = (mat as THREE.MeshBasicMaterial).map;
    return map instanceof THREE.CanvasTexture || map instanceof THREE.VideoTexture;
  });
}

const transparent = (m: THREE.Mesh) => (Array.isArray(m.material) ? m.material : [m.material]).some((mat) => mat.transparent);

export class RetroPass {
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly size = new THREE.Vector2();
  private readonly blitScene = new THREE.Scene();
  private readonly blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly blit = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, toneMapped: false });
  /** Only depth: where the world is, for what you read to hide behind. */
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  /** What you read, and the see-through things that mustn't hide it (glass), as of the last look. */
  private reads: THREE.Mesh[] = [];
  private glass: THREE.Mesh[] = [];
  private hidden: THREE.Mesh[] = [];
  private sortedAt = -Infinity;

  /** `scale`: the world's pixels to the window's CSS pixels (a third is chunky without being a blur). */
  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scale: number,
  ) {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blit);
    quad.frustumCulled = false;
    this.blitScene.add(quad);
  }

  /** Draws `scene` from `camera` the retro way, the world through `drawWorld` (the toon outline). */
  render(scene: THREE.Scene, camera: THREE.Camera, now: number, drawWorld: (scene: THREE.Scene, camera: THREE.Camera) => void) {
    const { renderer } = this;
    this.sort(scene, now);
    // Wherever the frame was headed: the screen, or a filter's texture (the drunk vision).
    const out = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;

    // The world, small and without what you read, then scaled up blocky.
    renderer.setRenderTarget(this.small());
    this.hide(this.reads);
    drawWorld(scene, camera);
    renderer.setRenderTarget(out);
    renderer.render(this.blitScene, this.blitCamera);

    // The world's depth at full size (not the glass, that what's behind it shows through), then what you
    // read on top at full size, hidden where the world is in front of it. The shadows are already drawn.
    const background = scene.background;
    const shadows = renderer.shadowMap.autoUpdate;
    scene.background = null;
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = false;
    renderer.clearDepth();
    this.hide(this.glass);
    scene.overrideMaterial = this.depthOnly;
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    this.unhide();
    const layers = camera.layers.mask;
    camera.layers.set(READ_LAYER);
    renderer.render(scene, camera);
    camera.layers.mask = layers;
    renderer.autoClear = autoClear;
    renderer.shadowMap.autoUpdate = shadows;
    scene.background = background;
  }

  /** The texture the world's drawn into, sized to the window. */
  private small(): THREE.WebGLRenderTarget {
    const css = this.renderer.getSize(this.size);
    const w = Math.max(1, Math.round(css.x * this.scale));
    const h = Math.max(1, Math.round(css.y * this.scale));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose();
      // Blocky when scaled up; sRGB so the darks don't band in 8 bits (as the drunk vision's).
      this.target = new THREE.WebGLRenderTarget(w, h, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, colorSpace: THREE.SRGBColorSpace });
      this.blit.map = this.target.texture;
      this.blit.needsUpdate = true;
    }
    return this.target;
  }

  /** Looks through the scene for what you read and the glass, every so often: they come and go. */
  private sort(scene: THREE.Scene, now: number) {
    if (now - this.sortedAt < RESORT_MS) return;
    this.sortedAt = now;
    const reads: THREE.Mesh[] = [];
    const glass: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) o.layers.enable(READ_LAYER);
      else if (readable(o)) {
        o.layers.enable(READ_LAYER);
        reads.push(o);
      } else if ((o as THREE.Mesh).isMesh && transparent(o as THREE.Mesh)) glass.push(o as THREE.Mesh);
    });
    this.reads = reads;
    this.glass = glass;
  }

  /** Hides those of `meshes` that are showing, until unhide (which the next draw of the world does). */
  private hide(meshes: THREE.Mesh[]) {
    this.unhide();
    for (const m of meshes) if (m.visible) (m.visible = false), this.hidden.push(m);
  }

  private unhide() {
    for (const m of this.hidden) m.visible = true;
    this.hidden.length = 0;
  }
}

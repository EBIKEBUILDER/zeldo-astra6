import * as B from '@babylonjs/core';
import type { GameData, Zone, Obstacle, Decoration } from './types';
import { WORLDS } from './world';

/** Babylon is deliberately a projection of the serializable simulation. */
export function createGameRenderer(canvas: HTMLCanvasElement) {
  const engine = new B.Engine(canvas, true, { stencil: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  engine.setHardwareScalingLevel(Math.max(1, (window.devicePixelRatio || 1) / 1.7));
  const scene = new B.Scene(engine);
  scene.clearColor = B.Color4.FromHexString('#d3ddaeff');
  scene.ambientColor = B.Color3.Black();
  scene.imageProcessingConfiguration.exposure = .94;
  scene.imageProcessingConfiguration.contrast = 1.04;
  const camera = new B.FreeCamera('adventure-camera', new B.Vector3(8, 22, -12), scene);
  camera.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
  camera.minZ = .1; camera.maxZ = 160;
  camera.inputs.clear();
  const hemisphere = new B.HemisphericLight('warm-sky', new B.Vector3(.15, 1, -.2), scene);
  hemisphere.intensity = .68;
  hemisphere.diffuse = B.Color3.FromHexString('#fff9ec');
  hemisphere.groundColor = B.Color3.FromHexString('#7b9876');
  const sun = new B.DirectionalLight('late-afternoon', new B.Vector3(-.7, -1.3, .55), scene);
  sun.position = new B.Vector3(20, 32, -18); sun.intensity = .66;
  sun.diffuse = B.Color3.FromHexString('#fff4de');
  const shadows = new B.ShadowGenerator(2048, sun);
  shadows.useBlurExponentialShadowMap = true;
  shadows.blurKernel = 24; shadows.setDarkness(.22); shadows.normalBias = .03;
  shadows.bias = .0004;
  const materials = new Map<string, B.StandardMaterial>();
  const mat = (color: string, glow = 0, alpha = 1): B.StandardMaterial => {
    const key = `${color}:${glow}:${alpha}`;
    let value = materials.get(key);
    if (!value) {
      value = new B.StandardMaterial(key, scene);
      value.diffuseColor = B.Color3.FromHexString(color);
      value.emissiveColor = value.diffuseColor.scale(glow);
      value.specularColor = B.Color3.Black(); value.alpha = alpha;
      value.backFaceCulling = false;
      materials.set(key, value);
    }
    return value;
  };
  const C = { grass: '#91ad68', darkGrass: '#789554', paleGrass: '#9eb672', pine: '#35694f', pineLight: '#4f8256', pineDark: '#285641', trunk: '#7c5a3e', dirt: '#d3bc80', stone: '#8c9383', stoneDark: '#69776e', stoneLight: '#a9af9b', wood: '#9d7950', woodLight: '#c5a474', cream: '#f0dfb4', orange: '#dc8248', water: '#70afa5', gold: '#efd17a', dungeon: '#535e59' };
  let serial = 0;
  const shadowCasters: B.AbstractMesh[] = [];
  function finish(mesh: B.Mesh, color: string, parent?: B.Node, cast = true, glow = 0) {
    mesh.material = mat(color, glow); mesh.isPickable = false; mesh.receiveShadows = true;
    mesh.metadata = { castsShadow: cast };
    if (parent) mesh.parent = parent;
    if (cast) shadowCasters.push(mesh);
    return mesh;
  }
  function box(name: string, w: number, h: number, d: number, x: number, y: number, z: number, color: string, parent?: B.Node, cast = true) {
    const mesh = finish(B.MeshBuilder.CreateBox(`${name}-${serial++}`, { width: w, height: h, depth: d }, scene), color, parent, cast);
    mesh.position.set(x, y, z); return mesh;
  }
  function ball(name: string, size: number, x: number, y: number, z: number, color: string, parent?: B.Node, scale?: [number, number, number], cast = true) {
    const mesh = finish(B.MeshBuilder.CreateSphere(`${name}-${serial++}`, { diameter: size, segments: 5 }, scene), color, parent, cast);
    mesh.position.set(x, y, z); if (scale) mesh.scaling.set(...scale); mesh.convertToFlatShadedMesh(); return mesh;
  }
  function cylinder(name: string, top: number, bottom: number, height: number, x: number, y: number, z: number, color: string, parent?: B.Node, sides = 7, cast = true) {
    const mesh = finish(B.MeshBuilder.CreateCylinder(`${name}-${serial++}`, { diameterTop: top, diameterBottom: bottom, height, tessellation: sides }, scene), color, parent, cast);
    mesh.position.set(x, y, z); return mesh;
  }
  function ground(name: string, w: number, d: number, x: number, z: number, color: string, parent: B.Node, y = .012) {
    const mesh = finish(B.MeshBuilder.CreateGround(`${name}-${serial++}`, { width: w, height: d }, scene), color, parent, false);
    mesh.position.set(x, y, z); return mesh;
  }
  function group(name: string, x = 0, z = 0, parent?: B.Node) {
    const root = new B.TransformNode(`${name}-${serial++}`, scene);
    root.position.set(x, 0, z); if (parent) root.parent = parent; return root;
  }
  function diamond(name: string, x: number, y: number, z: number, color: string, parent: B.Node, size = .23, glow = 0) {
    const mesh = finish(B.MeshBuilder.CreatePolyhedron(`${name}-${serial++}`, { type: 1, size }, scene), color, parent, false, glow);
    mesh.scaling.set(.75, 1.6, .75); mesh.position.set(x, y, z); return mesh;
  }
  function ring(name: string, radius: number, thickness: number, x: number, y: number, z: number, color: string, parent: B.Node) {
    const mesh = finish(B.MeshBuilder.CreateTorus(`${name}-${serial++}`, { diameter: radius * 2, thickness, tessellation: 18 }, scene), color, parent, false);
    mesh.position.set(x, y, z); return mesh;
  }
  function pine(x: number, z: number, s: number, rotation: number, parent: B.Node) {
    const node = group('pine', x, z, parent); node.rotation.y = rotation; node.scaling.setAll(s);
    cylinder('trunk', .25, .38, 1.7, 0, .85, 0, C.trunk, node, 6);
    const lower = cylinder('pine-bough', .12, 2.3, 2.1, 0, 2.04, 0, C.pineDark, node, 6);
    lower.rotation.y = .35;
    cylinder('pine-bough', 0, 1.96, 2.05, .06, 2.71, -.015, C.pine, node, 6).rotation.y = .08;
    cylinder('pine-tip', 0, 1.28, 1.8, -.04, 3.40, 0, C.pineLight, node, 5).rotation.z = .03;
    cylinder('root', .62, .86, .12, 0, .07, 0, C.darkGrass, node, 7, false);
  }
  function rock(o: Obstacle, parent: B.Node, dungeon: boolean) {
    if (dungeon) {
      const node = group('ruined-pillar', o.x, o.z, parent);
      box('base', 1.4, .24, 1.4, 0, .12, 0, C.stoneDark, node);
      cylinder('pillar', 1.0, 1.15, 2.0, 0, 1.15, 0, C.stone, node, 6);
      cylinder('capital', 1.4, 1.25, .3, 0, 2.2, 0, C.stoneLight, node, 6);
      return;
    }
    const s = o.scale ?? 1;
    const node = group('boulder', o.x, o.z, parent); node.rotation.y = o.rotation ?? 0;
    const stone = finish(B.MeshBuilder.CreateIcoSphere(`angular-rock-${serial++}`, { radius: .72, subdivisions: 1, flat: true }, scene), C.stone, node);
    stone.position.y = .44 * s; stone.scaling.set(s * 1.14, s * .8, s * .98); stone.rotation.set(.19, 0, .2);
    const moss = ball('moss', .55, -.12 * s, .88 * s, .03, C.darkGrass, node, [1.2, .25, .9], false); moss.rotation.z = .13;
    if (s > 1.2) ball('small-stone', .47, .55 * s, .15, -.25, C.stoneDark, node, [1.1, .64, .9]);
  }
  function grass(x: number, z: number, rotation: number, parent: B.Node, color = C.darkGrass, scale = 1) {
    const node = group('grass-tuft', x, z, parent); node.rotation.y = rotation;
    for (let i = 0; i < 4; i++) {
      const blade = box('blade', .085 * scale, (.30 + i % 2 * .13) * scale, .024, (i - 1.5) * .07 * scale, (.16 + i % 2 * .06) * scale, (i % 2 - .5) * .12, i % 2 ? color : C.pineLight, node, false);
      blade.rotation.z = (i - 1.5) * .24; blade.rotation.y = i * .92;
    }
    return node;
  }
  function flower(x: number, z: number, variant: number, parent: B.Node) {
    const root = group('wildflowers', x, z, parent);
    for (let f = 0; f < 3; f++) {
      const xx = Math.sin(f * 2.4) * .25, zz = Math.cos(f * 2.4) * .25, yy = .25 + (f % 2) * .12;
      box('stem', .035, yy, .035, xx, yy / 2, zz, C.pineLight, root, false);
      for (let p = 0; p < 4; p++) {
        const petal = ball('petal', .145, xx + Math.sin(p * Math.PI / 2) * .075, yy, zz + Math.cos(p * Math.PI / 2) * .075, variant % 3 === 0 ? '#e4c571' : variant % 3 === 1 ? '#e3d8bd' : '#deb198', root, [1, .4, 1], false);
        petal.rotation.y = p;
      }
      ball('pollen', .09, xx, yy + .025, zz, '#d9a75d', root, undefined, false);
    }
    return root;
  }
  function mushroom(x: number, z: number, parent: B.Node) {
    for (let m = 0; m < 2; m++) {
      const xx = x + m * .23, zz = z + m * .15, s = m ? .7 : 1;
      cylinder('mushroom-stem', .1 * s, .13 * s, .27 * s, xx, .14 * s, zz, C.cream, parent, 6, false);
      const cap = ball('mushroom-cap', .43 * s, xx, .3 * s, zz, '#bb7859', parent, [1, .55, 1], false);
      cap.rotation.y = x;
      ball('mushroom-dot', .055, xx -.06, .4 * s, zz, C.cream, parent, [1, .3, 1], false);
    }
  }
  function cabin(o: Obstacle, parent: B.Node) {
    const node = group('fernwick-cottage', o.x, o.z, parent);
    box('stone-foundation', 5, .35, 4, 0, .17, 0, C.stoneDark, node);
    box('plaster', 4.8, 2.05, 3.85, 0, 1.32, 0, '#dfcba0', node);
    for (const xx of [-2.35, 2.35]) for (const zz of [-1.86, 1.86]) box('timber-frame', .18, 2.14, .2, xx, 1.42, zz, C.trunk, node);
    box('lintel', 4.9, .16, .15, 0, 2.28, -1.97, C.trunk, node);
    box('door', 1.05, 1.55, .08, .25, 1.04, -1.97, '#755c42', node);
    for (let p = 0; p < 4; p++) box('door-plank', .025, 1.46, .045, -.12 + p * .25, 1.04, -2.035, '#574c37', node, false);
    ball('brass-handle', .105, .56, 1.05, -2.075, C.gold, node, undefined, false);
    box('doorstep', 1.65, .16, .68, .25, .14, -2.12, C.stoneLight, node);
    for (const xx of [-1.35, 1.52]) {
      box('window-frame', .98, 1.05, .17, xx, 1.39, -1.98, C.trunk, node);
      box('window-warmth', .74, .81, .05, xx, 1.40, -2.085, '#eacb7d', node, false).material = mat('#eacb7d', .2);
      box('window-cross', .06, .9, .06, xx, 1.40, -2.12, C.trunk, node, false);
      box('window-cross', .85, .06, .06, xx, 1.40, -2.12, C.trunk, node, false);
      box('window-box', 1.13, .22, .36, xx, .82, -2.17, '#ad8158', node);
      flower(xx, -2.17, 1, node).position.y = .85;
    }
    const roof = new B.Mesh('cottage-roof', scene);
    const verts = [-2.85,2.3,-2.35, 2.85,2.3,-2.35, 0,4,-2.35, -2.85,2.3,2.35, 2.85,2.3,2.35, 0,4,2.35];
    const indices = [0,2,1,3,4,5,0,3,5,0,5,2,2,5,4,2,4,1,0,1,4,0,4,3];
    const data = new B.VertexData(); data.positions = verts; data.indices = indices; const norms: number[] = []; B.VertexData.ComputeNormals(verts, indices, norms); data.normals = norms; data.applyToMesh(roof);
    finish(roof, '#ab6d49', node); roof.convertToFlatShadedMesh();
    for (let p = 0; p < 6; p++) {
      const zz = -2.23 + p * .87;
      const beam = box('roof-seam', 3.25, .055, .065, -1.40, 3.17, zz, '#975d40', node, false); beam.rotation.z = .536;
      const beam2 = box('roof-seam', 3.25, .055, .065, 1.40, 3.17, zz, '#975d40', node, false); beam2.rotation.z = -.536;
    }
    box('chimney', .7, 1.6, .73, -1.35, 3.4, .7, C.stone, node);
    box('chimney-cap', .88, .18, .87, -1.35, 4.17, .7, C.stoneDark, node);
    cylinder('log', .3, .3, .72, 2.47, .23, -.9, C.trunk, node, 6).rotation.x = Math.PI / 2;
    cylinder('log', .3, .3, .72, 2.65, .24, -.9, C.wood, node, 6).rotation.x = Math.PI / 2;
    cylinder('log', .3, .3, .72, 2.55, .49, -.9, C.trunk, node, 6).rotation.x = Math.PI / 2;
  }
  const worlds = { overworld: group('overworld'), dungeon: group('dungeon') };
  const waterGlints: B.Mesh[] = [];
  const flames: B.Mesh[] = [];
  function decoration(o: Decoration, parent: B.Node, zone: Zone) {
    if (o.kind === 'grass') grass(o.x, o.z, o.rotation ?? 0, parent);
    if (o.kind === 'flower') flower(o.x, o.z, o.variant ?? 0, parent);
    if (o.kind === 'mushroom') mushroom(o.x, o.z, parent);
    if (o.kind === 'path') {
      ground('beaten-path', o.w ?? 1, o.d ?? 1, o.x, o.z, C.dirt, parent, .026);
      const length = Math.max(o.w ?? 1, o.d ?? 1);
      for (let s = 0; s < length * 1.2; s++) {
        const horizontal = (o.w ?? 1) > (o.d ?? 1);
        const t = (s / (length * 1.2) - .5) * length;
        const offset = Math.sin(s * 3.2 + o.x) * .53;
        const pebble = ground('path-speck', .15 + (s % 3) * .07, .10, o.x + (horizontal ? t : offset), o.z + (horizontal ? offset : t), s % 2 ? '#c2aa77' : '#dfcb94', parent, .030);
        pebble.rotation.y = s;
      }
    }
    if (o.kind === 'bridge') {
      const node = group('old-willow-bridge', o.x, o.z, parent);
      const w = o.w ?? 4.5, d = o.d ?? 3.5;
      box('bridge-support', w + .5, .25, d, 0, .08, 0, '#725b42', node);
      for (let p = 0; p < 11; p++) {
        const plank = box('worn-plank', w / 11 - .035, .15, d - .08, -w / 2 + (p + .5) * w / 11, .25 + Math.sin(p) * .015, 0, p % 3 ? C.woodLight : '#b99868', node);
        plank.rotation.z = Math.sin(p * 7) * .012;
        for (const zz of [-d / 2 + .25, d / 2 - .25]) ball('nail', .06, plank.position.x, .34, zz, '#696650', node, undefined, false);
      }
      for (const xx of [-w / 2 + .1, 0, w / 2 - .1]) for (const zz of [-d / 2, d / 2]) cylinder('bridge-post', .14, .19, 1.0, xx, .65, zz, C.trunk, node, 5);
      for (const zz of [-d / 2, d / 2]) box('bridge-railing', w, .12, .13, 0, 1.04, zz, C.wood, node);
    }
    if (o.kind === 'lily') {
      if (o.z > 11.2 && o.z < 15.1) return;
      const pad = cylinder('lily-pad', .4, .4, .015, o.x, .067, o.z, '#497e62', parent, 7, false); pad.rotation.y = o.z;
      if (o.variant === 0) ball('lily-blossom', .17, o.x, .16, o.z, '#e6d4b5', parent, [1, .7, 1], false);
    }
    if (o.kind === 'stump') {
      cylinder('old-stump', .66, .87, .54, o.x, .27, o.z, C.trunk, parent, 7);
      cylinder('stump-rings', .54, .54, .018, o.x, .55, o.z, C.woodLight, parent, 8, false);
      ring('growth-ring', .17, .018, o.x, .563, o.z, '#a78557', parent);
    }
    if (o.kind === 'banner') {
      const node = group('banner', o.x, o.z, parent);
      cylinder('banner-pole', .065, .11, 2.85, 0, 1.43, 0, C.trunk, node, 6);
      box('banner-crossbar', .91, .07, .07, .32, 2.66, 0, C.woodLight, node);
      box('cloth', .66, 1.05, .026, .32, 2.08, 0, zone === 'dungeon' ? '#a56e4a' : '#e5b975', node, false);
      diamond('banner-crest', .32, 2.08, -.035, '#f6df9c', node, .12, .1);
      diamond('finial', 0, 2.94, 0, C.gold, node, .10);
    }
    if (o.kind === 'torch') {
      const node = group('wall-torch', o.x, o.z, parent);
      node.rotation.y = o.rotation ?? 0;
      box('sconce', .16, .42, .14, 0, 1.28, 0, '#3e4744', node);
      cylinder('torch-cup', .34, .13, .27, 0, 1.58, -.12, '#a18059', node, 6);
      const fire = ball('flame', .34, 0, 1.97, -.12, '#f3bc65', node, [.6, 1.5, .7], false); fire.material = mat('#ffbe59', .9); flames.push(fire);
      const core = ball('flame-core', .22, 0, 1.93, -.18, '#fff0be', node, [.55, 1.25, .6], false); core.material = mat('#ffeab0', .9); flames.push(core);
      const halo = ground('torch-pool', 3.3, 3.8, o.x, o.z, '#907548', parent, .027); halo.material = mat('#c28e4d', .15, .10);
    }
  }
  function buildWorld(zone: Zone) {
    const data = WORLDS[zone], root = worlds[zone], dungeon = zone === 'dungeon';
    ground('infinite-horizon', 120, 95, data.width / 2, data.height / 2, dungeon ? '#343f3c' : '#99af72', root, -.14);
    box('earth-base', data.width + .2, .35, data.height + .2, data.width / 2, -.19, data.height / 2, dungeon ? '#424b46' : '#7c8d51', root, false);
    ground('ground', data.width, data.height, data.width / 2, data.height / 2, dungeon ? C.dungeon : C.grass, root);
    for (let x = 1; x < data.width; x += 2) for (let z = 1; z < data.height; z += 2) {
      const r = (x * 19 + z * 13) % 7;
      const color = dungeon ? ['#59645e', '#55615b', '#53605a', '#5d6760'][r % 4] : ['#90aa64', '#95ae6d', '#92ac66', '#94ae69'][r % 4];
      const tile = ground('ground-tile', dungeon ? 1.95 : 1.99, dungeon ? 1.95 : 1.99, x, z, color, root, .017);
      if (!dungeon) tile.rotation.y = 0;
      if (dungeon && r === 2) {
        const crack = ground('stone-crack', .035, .65, x - .35, z + .2, '#444e4a', root, .022); crack.rotation.y = .8;
      }
    }
    for (const o of data.obstacles) {
      if (o.id === 'cabin') cabin(o, root);
      else if (o.kind === 'tree') pine(o.x, o.z, o.scale ?? 1, o.rotation ?? 0, root);
      else if (o.kind === 'rock') rock(o, root, dungeon);
      else if (o.kind === 'water') {
        ground('river-bank', o.w + .65, o.d + .1, o.x, o.z, '#b9b685', root, .024);
        ground('river', o.w, o.d + .03, o.x, o.z, C.water, root, .03);
        for (let w = 0; w < o.d * 3; w++) {
          const xx = o.x + Math.sin(w * 7.6) * (o.w * .42), zz = o.z - o.d / 2 + w / 3;
          const glint = ground('water-ripple', .17 + (w % 4) * .18, .036, xx, zz, '#b2d5bd', root, .044);
          waterGlints.push(glint);
        }
      } else if (o.kind === 'hedge') {
        box('hedge-soil', o.w, .35, o.d, o.x, .17, o.z, C.trunk, root);
        const length = Math.max(o.w, o.d), horizontal = o.w > o.d;
        for (let p = 0; p < length / .55; p++) {
          const offset = -.5 * length + p * .55 + .25;
          const bush = ball('hedge-leaves', .96, o.x + (horizontal ? offset : 0), .64, o.z + (horizontal ? 0 : offset), p % 2 ? C.pineLight : C.pine, root, [.9, .88, .83]); bush.rotation.y = p * .7;
        }
      } else if (o.kind === 'wall') {
        const h = o.id === 'south-wall' ? .52 : o.id.startsWith('divider') ? 1.15 : 2.5;
        box('stone-wall', o.w, h, o.d, o.x, h / 2, o.z, '#778075', root);
        box('wall-coping', o.w + .10, .18, o.d + .10, o.x, h + .04, o.z, '#909887', root);
        const horizontal = o.w > o.d, len = horizontal ? o.w : o.d;
        for (let b = 1; b < len; b += 1.5) {
          const off = -len / 2 + b;
          box('mortar', horizontal ? .026 : o.w + .008, h - .1, horizontal ? o.d + .008 : .026, o.x + (horizontal ? off : 0), h / 2, o.z + (horizontal ? 0 : off), '#697569', root, false);
        }
      }
    }
    data.decorations.forEach(o => decoration(o, root, zone));
    if (!dungeon) {
      const node = group('elder-stone-entrance', data.entrance.x, data.entrance.z, root);
      for (let s = 0; s < 3; s++) box('temple-step', 3.1 - s * .12, .12, .67, 0, .05 + s * .1, -1.9 + s * .6, C.stoneLight, node);
      box('door-darkness', 2.15, 2.85, .3, 0, 1.42, .48, '#314944', node);
      for (const x of [-1.5, 1.5]) {
        box('arch-foot', .92, .3, 1.35, x, .15, .1, C.stoneDark, node);
        for (let y = 0; y < 3; y++) {
          const block = box('arch-stone', .75 + (y % 2) * .1, .87, 1.13, x + Math.sin(y) * .05, .72 + y * .82, .08, y % 2 ? C.stoneLight : C.stone, node); block.rotation.z = x * .014;
        }
      }
      box('arch-lintel', 3.92, .8, 1.45, 0, 3.03, .08, C.stone, node);
      box('arch-cap', 3.25, .35, 1.37, .1, 3.58, .14, C.stoneLight, node).rotation.z = -.03;
      diamond('sun-rune', 0, 3.05, -.68, C.gold, node, .23, .2);
      grass(-1.9, .45, 0, node, C.pineLight, 1.5);
      grass(1.9, -.2, 1, node, C.pineLight, 1.4);
      // A few stepping stones around the cottage make the safe clearing feel lived in.
      for (let i = 0; i < 5; i++) {
        const stone = cylinder('garden-stone', .7, .79, .08, 6.6 + i * .45, .052, 6.15 + Math.sin(i * 1.1) * .28, '#b5b38c', root, 5, false); stone.rotation.y = i;
      }
    } else {
      // The sanctuary carpet and radial seal lead the eye toward the guardian.
      ground('faded-runner', 3.3, 10.8, 10, 7.8, '#7a7258', root, .024);
      for (const x of [8.45, 11.55]) ground('runner-edge', .045, 10.8, x, 7.8, '#ad9560', root, .026);
      ring('guardian-seal', 3.6, .075, 10, .038, 21, '#a39466', root);
      ring('guardian-seal-inner', 3.1, .035, 10, .040, 21, '#7d8266', root);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        const rune = ground('seal-rune', .19, .45, 10 + Math.sin(angle) * 3.35, 21 + Math.cos(angle) * 3.35, '#b09b62', root, .045); rune.rotation.y = angle;
      }
      const key = data.key;
      cylinder('pedestal-base', 1.9, 2.2, .2, key.x, .1, key.z, C.stoneDark, root, 8);
      cylinder('pedestal', .82, 1.08, .66, key.x, .48, key.z, C.stone, root, 6);
      cylinder('pedestal-top', 1.35, 1.17, .17, key.x, .86, key.z, C.stoneLight, root, 6);
      ring('pedestal-inlay', .46, .027, key.x, .958, key.z, C.gold, root);
      for (const x of [8.2, 11.8]) {
        box('gate-pillar', .6, 2.6, 1.2, x, 1.3, 14, C.stoneDark, root);
        diamond('gate-rune', x, 2.0, 13.36, C.gold, root, .12, .15);
      }
      box('gate-lintel', 4.25, .35, 1.15, 10, 2.75, 14, C.stone, root);
      for (let i = 0; i < 3; i++) box('exit-step', 3.3 - i * .15, .12, .6, 10, .04 + i * .08, 1.45 + i * .48, C.stoneLight, root);
    }
    // Merge all static geometry by material. The unmerged transform hierarchy remains
    // useful for the few animated water glints and flames, but costs no draw calls.
    const animated = new Set<B.AbstractMesh>([...waterGlints, ...flames]);
    const byMaterial = new Map<string, { meshes: B.Mesh[]; cast: boolean }>();
    root.getChildMeshes().forEach(mesh => {
      if (!(mesh instanceof B.Mesh) || !mesh.material || animated.has(mesh)) return;
      const cast = Boolean(mesh.metadata?.castsShadow);
      const key = `${mesh.material.uniqueId}:${cast}`;
      const batch = byMaterial.get(key) ?? { meshes: [], cast }; batch.meshes.push(mesh); byMaterial.set(key, batch);
    });
    byMaterial.forEach(({ meshes, cast }) => {
      if (meshes.length < 2) return;
      const merged = B.Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
      if (merged) { merged.parent = root; merged.isPickable = false; merged.receiveShadows = true; if (cast) shadowCasters.push(merged); }
    });
    root.setEnabled(zone === 'overworld');
  }
  buildWorld('overworld'); buildWorld('dungeon');

  const hero = group('little-fernkeeper');
  const heroBody = group('hero-body', 0, 0, hero);
  const leftBoot = box('boot', .24, .19, .38, -.19, .13, .01, '#685645', heroBody);
  const rightBoot = box('boot', .24, .19, .38, .19, .13, .01, '#685645', heroBody);
  cylinder('cream-leggings', .27, .29, .33, -.18, .31, 0, '#e0d0a7', heroBody, 6);
  cylinder('cream-leggings', .27, .29, .33, .18, .31, 0, '#e0d0a7', heroBody, 6);
  cylinder('green-tunic', .54, .76, .62, 0, .66, 0, '#558057', heroBody, 7);
  cylinder('leather-belt', .65, .67, .095, 0, .61, 0, '#76563a', heroBody, 7);
  box('belt-buckle', .15, .13, .05, 0, .63, .34, C.gold, heroBody);
  ball('hood', .68, 0, 1.15, -.055, '#49724d', heroBody, [1, 1.05, .91]);
  ball('face', .46, 0, 1.12, .205, '#edc693', heroBody, [1, 1.02, .62]);
  ball('nose', .11, 0, 1.10, .37, '#e0af7b', heroBody, [1, .9, 1]);
  for (const x of [-.096, .096]) box('eyes', .041, .065, .022, x, 1.16, .35, '#393d31', heroBody, false);
  cylinder('pointed-hood', 0, .57, .70, 0, 1.61, -.15, '#558052', heroBody, 6).rotation.x = -.42;
  cylinder('scarf-collar', .57, .57, .14, 0, .94, .045, C.orange, heroBody, 7);
  const scarf = box('fluttering-scarf', .21, .49, .055, -.16, .72, -.35, C.orange, heroBody); scarf.rotation.z = -.25;
  for (const x of [-.43, .43]) {
    ball('sleeve', .33, x, .77, 0, '#608a59', heroBody, [.8, 1.25, .9]);
    ball('hand', .21, x, .55, .13, '#e9c18b', heroBody, [.8, 1.1, .9]);
  }
  const swordPivot = group('sword-hand', 0, 0, hero);
  swordPivot.position.y = .63;
  box('sword-grip', .085, .085, .30, 0, 0, .37, '#745d42', swordPivot);
  box('sword-guard', .4, .085, .075, 0, 0, .54, '#ddb563', swordPivot);
  const blade = box('sword-blade', .115, .047, .87, 0, 0, 1.0, '#fff0cc', swordPivot); blade.material = mat('#fff0cc', .25);
  const bladeTip = diamond('sword-point', 0, 0, 1.5, '#fff1cd', swordPivot, .1, .2); bladeTip.rotation.x = Math.PI / 2;
  const arc = new B.Mesh('sword-trail', scene);
  const arcPositions: number[] = [], arcIndices: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = -.8 + i / 16 * .83;
    for (const r of [1.16, 1.67]) arcPositions.push(Math.sin(a) * r, 0, Math.cos(a) * r);
    if (i < 16) { const n = i * 2; arcIndices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
  }
  const arcData = new B.VertexData(); arcData.positions = arcPositions; arcData.indices = arcIndices; const arcNormals: number[] = []; B.VertexData.ComputeNormals(arcPositions, arcIndices, arcNormals); arcData.normals = arcNormals; arcData.applyToMesh(arc);
  arc.parent = swordPivot; arc.position.y = .025; arc.material = mat('#fff1c1', .8, .56); arc.isPickable = false;

  const keyNode = group('sun-key', 5, 8, worlds.dungeon);
  const keyRing = ring('key-ring', .24, .08, 0, 0, 0, C.gold, keyNode); keyRing.rotation.x = Math.PI / 2;
  box('key-stem', .09, .5, .09, 0, -.43, 0, C.gold, keyNode, false);
  box('key-tooth', .21, .075, .08, .08, -.60, 0, C.gold, keyNode, false);
  box('key-tooth', .18, .075, .08, .07, -.45, 0, C.gold, keyNode, false);
  const gate = group('sealed-gate', 10, 14, worlds.dungeon);
  for (let i = 0; i < 7; i++) {
    cylinder('iron-bar', .07, .07, 2.55, -1.38 + i * .46, 1.35, 0, '#52564a', gate, 5);
    diamond('bar-tip', -1.38 + i * .46, .12, 0, '#b59c65', gate, .105);
  }
  for (const y of [.65, 1.8]) box('gate-brace', 3.2, .10, .11, 0, y, -.02, '#a18c60', gate);
  diamond('gate-lock', 0, 1.24, -.18, C.gold, gate, .28, .12);
  const chest = group('treasure-chest', 10, 25, worlds.dungeon);
  cylinder('treasure-dais', 2.6, 2.9, .2, 0, .1, 0, C.stoneDark, chest, 8);
  box('chest-body', 1.6, .72, 1.05, 0, .59, 0, '#aa7846', chest);
  for (const x of [-.61, .61]) box('chest-straps', .15, .75, 1.08, x, .59, 0, '#d9b66f', chest);
  box('chest-lock', .25, .31, .08, 0, .73, -.59, C.gold, chest);
  const chestLid = group('chest-lid', 0, .5, chest); chestLid.position.y = .97;
  box('lid', 1.66, .3, 1.08, 0, .1, -.5, '#b58a50', chestLid);
  for (const x of [-.61, .61]) box('lid-straps', .15, .32, 1.12, x, .1, -.5, '#e4c273', chestLid);
  const treasureGlow = cylinder('treasure-glow', 1.7, .9, 1.8, 0, 1.58, 0, '#ffdf80', chest, 8, false);
  treasureGlow.material = mat('#ffe3a0', .8, .17); treasureGlow.setEnabled(false);

  const enemyNodes = new Map<string, { node: B.TransformNode; body: B.Mesh; eyes: B.Mesh[]; danger: B.Mesh | null; originals: Map<B.AbstractMesh, B.Material | null> }>();
  const breakableNodes = new Map<string, B.TransformNode>();
  const pickupNodes = new Map<string, B.TransformNode>();
  const projectileNodes = new Map<number, { node: B.TransformNode; core: B.Mesh; halo: B.Mesh; tails: B.Mesh[] }>();
  const particleNodes = new Map<number, B.Mesh>();
  function projectileNode(id: number) {
    const node = group('guardian-wisp');
    const core = finish(B.MeshBuilder.CreatePolyhedron(`wisp-core-${serial++}`, { type: 1, size: .18 }, scene), '#ccf4ff', node, false, .95);
    const halo = ring('wisp-halo', .27, .045, 0, 0, 0, '#aa89ed', node);
    halo.rotation.x = Math.PI / 2; halo.material = mat('#aa89ed', .8, .8);
    const tails = [0, 1, 2].map(i => {
      const tail = finish(B.MeshBuilder.CreatePolyhedron(`wisp-tail-${serial++}`, { type: 1, size: .105 - i * .02 }, scene), '#8ec6ff', node, false, .7);
      tail.position.z = -.30 - i * .19; tail.scaling.z = 1.55;
      tail.visibility = .66 - i * .18;
      return tail;
    });
    const model = { node, core, halo, tails };
    projectileNodes.set(id, model);
    return model;
  }
  function enemyNode(id: string, boss: boolean) {
    const node = group(boss ? 'ember-guardian' : 'moss-slime');
    const body = ball('slime-body', boss ? 2.28 : 1.05, 0, boss ? .78 : .43, 0, boss ? '#ac704e' : '#889552', node, [1, .73, 1]);
    const browColor = boss ? '#694e3c' : '#657b42';
    ball('slime-brow', boss ? 1.72 : .74, 0, boss ? 1.26 : .65, -.09, browColor, node, [1, .48, .86]);
    const eyes: B.Mesh[] = [];
    for (const x of [-1, 1]) {
      eyes.push(ball('slime-eye', boss ? .24 : .14, x * (boss ? .36 : .17), boss ? .94 : .49, boss ? .99 : .46, '#f4e6ba', node, [.8, 1.1, .52]));
      eyes.push(ball('slime-pupil', boss ? .11 : .065, x * (boss ? .35 : .17), boss ? .92 : .48, boss ? 1.1 : .525, '#3f4735', node, [.8, 1.1, .55], false));
    }
    if (boss) {
      cylinder('guardian-crown', 1.1, 1.28, .2, 0, 1.62, -.05, '#d1af6b', node, 6);
      for (let c = 0; c < 5; c++) {
        const a = c / 5 * Math.PI * 2;
        cylinder('crown-spike', 0, .26, .45, Math.sin(a) * .48, 1.92, Math.cos(a) * .48 -.05, '#e9c581', node, 4);
      }
      diamond('ember-heart', 0, .76, -1.07, '#eea05b', node, .20, .3);
      for (const x of [-1, 1]) ball('guardian-shoulder', .7, x * .93, .67, -.10, '#786c4a', node, [1, .7, 1]);
    } else {
      const sprout = cylinder('slime-sprout', .045, .075, .35, 0, .91, -.04, '#526c3e', node, 4, false); sprout.rotation.z = .25;
      ball('slime-leaf', .29, .12, 1.04, -.03, '#9aae65', node, [1.3, .23, .75], false).rotation.z = .35;
    }
    const danger = boss ? ring('charge-warning', 1.55, .09, 0, .055, 0, '#e6a063', node) : null;
    if (danger) { danger.material = mat('#efa567', .55, .7); danger.setEnabled(false); }
    const originals = new Map<B.AbstractMesh, B.Material | null>(); node.getChildMeshes().forEach(mesh => originals.set(mesh, mesh.material));
    const result = { node, body, eyes, danger, originals }; enemyNodes.set(id, result);
    for (const mesh of node.getChildMeshes()) shadows.addShadowCaster(mesh);
    return result;
  }
  function pot(parent: B.Node) {
    cylinder('clay-pot-foot', .44, .37, .12, 0, .08, 0, '#915a40', parent, 8);
    const body = ball('clay-pot', .82, 0, .38, 0, '#b47a50', parent, [1, .82, 1]); body.rotation.y = .2;
    cylinder('pot-neck', .43, .59, .23, 0, .68, 0, '#c18d60', parent, 8);
    ring('pot-lip', .24, .075, 0, .8, 0, '#d1a474', parent);
    cylinder('pot-inside', .4, .4, .012, 0, .78, 0, '#5d4e38', parent, 8, false);
    ring('pot-stripe', .35, .035, 0, .52, 0, '#e0bb80', parent);
  }
  function makeHeart(parent: B.Node) {
    const mesh = new B.Mesh(`heart-${serial++}`, scene);
    const points = [[0,-.28],[-.30,.02],[-.30,.19],[-.18,.29],[0,.13],[.18,.29],[.30,.19],[.30,.02]];
    const positions: number[] = [0,.03,-.085,0,.03,.085];
    for (const depth of [-.085,.085]) points.forEach(p => positions.push(p[0],p[1],depth));
    const indices: number[] = [];
    for(let i=0;i<8;i++){const j=(i+1)%8;indices.push(0,2+j,2+i,1,10+i,10+j,2+i,2+j,10+i,2+j,10+j,10+i);}
    const data = new B.VertexData();data.positions=positions;data.indices=indices; const normals:number[]=[];B.VertexData.ComputeNormals(positions,indices,normals);data.normals=normals;data.applyToMesh(mesh);finish(mesh,'#d16e50',parent,false,.14);mesh.convertToFlatShadedMesh();return mesh;
  }
  for (const caster of shadowCasters) if (!caster.isDisposed()) shadows.addShadowCaster(caster);
  let activeZone: Zone = 'overworld';
  let cameraX = 3, cameraZ = 8;
  let smoothGate = 0, smoothLid = 0;
  let lastPhase = '';
  let ambientTime = 0;
  function resize() {
    engine.resize();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const halfH = aspect < 1 ? 10.3 : 9.5;
    camera.orthoTop = halfH; camera.orthoBottom = -halfH;
    camera.orthoLeft = -halfH * aspect; camera.orthoRight = halfH * aspect;
  }
  resize();
  function render(state: GameData, dt: number) {
    ambientTime += Math.min(dt, .1);
    const p = state.player, time = state.phase === 'title' ? ambientTime : state.elapsed;
    if (state.zone !== activeZone) {
      activeZone = state.zone; worlds.overworld.setEnabled(activeZone === 'overworld'); worlds.dungeon.setEnabled(activeZone === 'dungeon');
      cameraX = p.x; cameraZ = p.z + 2;
      const dungeon = activeZone === 'dungeon';
      scene.clearColor = B.Color4.FromHexString(dungeon ? '#343f3cff' : '#d3ddaeff');
      hemisphere.intensity = dungeon ? .64 : .68; sun.intensity = dungeon ? .56 : .66;
      hemisphere.groundColor = B.Color3.FromHexString(dungeon ? '#5b655d' : '#7b9876');
    }
    const title = state.phase === 'title';
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const targetX = title ? p.x - (aspect > 1 ? 5.1 : 0) : state.zone === 'dungeon' ? 10 + (p.x - 10) * .27 : Math.max(7, Math.min(41, p.x));
    const targetZ = title ? p.z + 3 : state.zone === 'dungeon' ? Math.max(6.0, Math.min(23.0, p.z + 1.9)) : Math.max(6.6, Math.min(23.0, p.z + 1.7));
    if (lastPhase === 'title' && !title) { cameraX = p.x; cameraZ = p.z + 1.7; }
    lastPhase = state.phase;
    const smoothing = 1 - Math.exp(-dt * 5);
    cameraX += (targetX - cameraX) * smoothing; cameraZ += (targetZ - cameraZ) * smoothing;
    const shakeX = Math.sin(time * 135) * state.shake * .32, shakeZ = Math.cos(time * 111) * state.shake * .28;
    camera.position.set(cameraX + shakeX, 23, cameraZ - 19 + shakeZ);
    camera.setTarget(new B.Vector3(cameraX + shakeX, 0, cameraZ + shakeZ));
    sun.position.set(cameraX + 12, 32, cameraZ - 18);
    hero.position.set(p.x, 0, p.z); hero.rotation.y = title ? Math.PI - .4 : Math.atan2(p.facingX, p.facingZ);
    const moving = Math.hypot(p.vx, p.vz) > .15;
    const stride = moving ? Math.sin(time * 16) : 0;
    heroBody.position.y = moving ? Math.abs(stride) * .048 : Math.sin(time * 2.5) * .012;
    leftBoot.position.z = stride * .14; rightBoot.position.z = -stride * .14;
    scarf.rotation.x = Math.sin(time * 8) * (moving ? .2 : .05);
    hero.getChildMeshes().forEach(mesh => { mesh.visibility = p.invulnerable > 0 && Math.floor(p.invulnerable * 16) % 2 === 0 ? .38 : 1; });
    const attacking = p.attackTime > 0;
    swordPivot.position.x = attacking ? 0 : .37;
    swordPivot.position.z = attacking ? 0 : -.16;
    swordPivot.rotation.y = attacking ? (1 - p.attackTime / .28) * 2.3 - 1.15 : .38;
    swordPivot.scaling.setAll(attacking ? 1 : .67);
    arc.setEnabled(attacking); arc.visibility = attacking ? Math.min(1, p.attackTime * 12) : 0;
    if (state.phase === 'gameover') hero.rotation.z = .95; else hero.rotation.z = 0;
    for (const enemy of state.enemies) {
      const model = enemyNodes.get(enemy.id) ?? enemyNode(enemy.id, enemy.kind === 'boss');
      const enabled = enemy.zone === activeZone && enemy.hp > 0;
      model.node.setEnabled(enabled); if (!enabled) continue;
      model.node.position.set(enemy.x, Math.abs(Math.sin(time * (enemy.mode === 'chase' ? 10 : 3) + enemy.spawnX)) * .055, enemy.z);
      const angle = Math.atan2(p.x - enemy.x, p.z - enemy.z);
      model.node.rotation.y = angle;
      const bounce = Math.sin(time * (enemy.kind === 'boss' ? 7 : 5) + enemy.spawnX) * .035;
      model.body.scaling.y = (enemy.mode === 'windup' ? .57 : .73) + bounce;
      if (model.danger) {
        model.danger.setEnabled(enemy.mode === 'windup' || enemy.mode === 'charge');
        model.danger.scaling.setAll(enemy.mode === 'windup' ? 1 + Math.sin(time * 17) * .12 : .9);
      }
      model.node.scaling.setAll(enemy.mode === 'windup' ? 1 + Math.sin(time * 33) * .035 : 1);
      model.originals.forEach((original, mesh) => { mesh.material = enemy.flash > 0 ? mat('#fff5d5', .3) : original; });
    }
    for (const item of state.breakables) {
      let node = breakableNodes.get(item.id);
      if (!node) {
        node = group(`breakable-${item.kind}`, item.x, item.z);
        if (item.kind === 'grass') { grass(-.18, -.12, .5, node, '#557c45', 1.42); grass(.18, .12, 2, node, '#688b4c', 1.20); }
        else { pot(node); for (const mesh of node.getChildMeshes()) shadows.addShadowCaster(mesh); }
        breakableNodes.set(item.id, node);
      }
      node.setEnabled(item.zone === activeZone && !item.broken);
    }
    const pickupIds = new Set(state.pickups.map(item => item.id));
    pickupNodes.forEach((node, id) => { if (!pickupIds.has(id)) { node.dispose(); pickupNodes.delete(id); } });
    for (const item of state.pickups) {
      let node = pickupNodes.get(item.id);
      if (!node) {
        node = group('pickup');
        if (item.kind === 'rupee') {
          diamond('emerald', 0, 0, 0, '#8ec879', node, .23, .22);
          const gleam = box('gem-gleam', .037, .26, .035, -.085, .05, -.13, '#e8efba', node, false); gleam.rotation.z = -.14;
        } else makeHeart(node);
        pickupNodes.set(item.id, node);
      }
      node.setEnabled(item.zone === activeZone);
      node.position.set(item.x, .65 + Math.sin(time * 4 + item.age) * .12, item.z);
      node.rotation.y = item.kind === 'rupee' ? time * 2.1 : Math.sin(time * 2) * .35;
    }
    // Only project the simulation's live shots; removed or off-zone shots release
    // their geometry immediately, including when the adventure is restarted.
    const visibleProjectiles = state.projectiles.filter(item => item.zone === activeZone);
    const projectileIds = new Set(visibleProjectiles.map(item => item.id));
    projectileNodes.forEach((model, id) => { if (!projectileIds.has(id)) { model.node.dispose(); projectileNodes.delete(id); } });
    for (const item of visibleProjectiles) {
      const model = projectileNodes.get(item.id) ?? projectileNode(item.id);
      model.node.position.set(item.x, .72, item.z);
      model.node.rotation.y = Math.atan2(item.vx, item.vz);
      model.node.scaling.setAll(item.radius / .18);
      model.core.rotation.set(item.age * 7, item.age * 5, item.age * 3);
      model.halo.scaling.setAll(1 + Math.sin(item.age * 18) * .09);
      model.tails.forEach((tail, i) => {
        tail.position.x = Math.sin(item.age * 16 - i * .9) * .045;
        tail.rotation.z = item.age * 5 + i;
        tail.scaling.z = 1.55 * Math.min(1, item.age / .12);
      });
    }
    const particleIds = new Set(state.particles.map(item => item.id));
    particleNodes.forEach((mesh, id) => { if (!particleIds.has(id)) { mesh.dispose(); particleNodes.delete(id); } });
    for (const item of state.particles) {
      let mesh = particleNodes.get(item.id);
      if (!mesh) {
        mesh = item.kind === 'poof' ? ball('poof', 1, 0, 0, 0, item.color, undefined, undefined, false) : box('impact', 1, 1, 1, 0, 0, 0, item.color, undefined, false);
        mesh.material = mat(item.color, item.kind === 'spark' ? .5 : 0); particleNodes.set(item.id, mesh);
      }
      mesh.position.set(item.x, item.y, item.z);
      const fade = Math.max(0, item.life / item.maxLife);
      mesh.scaling.setAll(item.size * (item.kind === 'poof' ? 1.7 - fade * .7 : .65 + fade * .35));
      if (item.kind === 'debris') mesh.scaling.y *= .4;
      mesh.visibility = fade; mesh.rotation.set(time * 6 + item.id, time * 3, item.id);
    }
    keyNode.setEnabled(!state.hasKey && !state.gateOpen); keyNode.position.y = 1.7 + Math.sin(time * 3) * .1; keyNode.rotation.y = Math.sin(time * 1.7) * .38;
    smoothGate += ((state.gateOpen ? 3.2 : 0) - smoothGate) * (1 - Math.exp(-dt * 5)); gate.position.y = smoothGate; gate.setEnabled(smoothGate < 3.1);
    smoothLid += ((state.chestOpen ? 1.28 : 0) - smoothLid) * (1 - Math.exp(-dt * 7)); chestLid.rotation.x = smoothLid;
    treasureGlow.setEnabled(state.bossDefeated); treasureGlow.visibility = .65 + Math.sin(time * 3) * .2;
    waterGlints.forEach((mesh, i) => { mesh.visibility = .4 + (Math.sin(time * 1.4 + i * 1.7) + 1) * .23; });
    flames.forEach((mesh, i) => { mesh.scaling.y = 1.2 + Math.sin(time * 13 + i) * .25; mesh.rotation.z = Math.sin(time * 9 + i) * .12; });
    scene.render();
  }
  function dispose() { scene.dispose(); engine.dispose(); }
  return { render, resize, dispose, ready: () => scene.whenReadyAsync() };
}

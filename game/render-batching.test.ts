import test from 'node:test';
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Shaders/default.vertex';
import '@babylonjs/core/Shaders/default.fragment';
import { mergeOpaqueMeshes } from './render-batching';

function fixture() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const root = new TransformNode('animated-parent', scene);
  const material = (color: string, glow = 0, alpha = 1) => {
    const value = new StandardMaterial(color, scene);
    value.diffuseColor = Color3.FromHexString(color);
    value.emissiveColor = value.diffuseColor.scale(glow);
    value.specularColor = Color3.Black();
    value.alpha = alpha;
    return value;
  };
  const box = (name: string, color: string, cast = true) => {
    const mesh = CreateBox(name, {}, scene);
    mesh.parent = root;
    mesh.material = material(color);
    mesh.metadata = { castsShadow: cast };
    mesh.receiveShadows = true;
    return mesh;
  };
  return { engine, scene, root, material, box };
}

function near(actual: Vector3, expected: Vector3, message: string) {
  assert.ok(Vector3.Distance(actual, expected) < 1e-5, `${message}: ${actual} != ${expected}`);
}

test('palette batching retains colors, flat geometry, and lighting beneath a moving parent', () => {
  const f = fixture();
  try {
    f.root.position.set(7, 2, -3);
    f.root.rotation.set(.1, .7, -.2);
    const left = f.box('left', '#426c52');
    const right = f.box('right', '#e8ba82');
    left.position.set(-1, .4, .2); left.scaling.set(.4, 1.7, .8); left.rotation.set(.3, -.2, .4);
    right.position.set(1, .5, -.3); right.rotation.y = -.4;
    const pieces = [left, right];
    const expected = pieces.map(mesh => {
      const world = mesh.computeWorldMatrix(true).clone();
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      return {
        position: Vector3.TransformCoordinates(Vector3.FromArray(positions), world),
        normal: Vector3.TransformNormal(Vector3.FromArray(normals), Matrix.Transpose(Matrix.Invert(world))).normalize(),
        color: (mesh.material as StandardMaterial).diffuseColor.clone(),
        vertices: mesh.getTotalVertices(),
        indices: mesh.getTotalIndices(),
      };
    });
    const [merged] = mergeOpaqueMeshes(f.root, pieces);
    assert.equal(f.scene.meshes.length, 1);
    assert.equal(merged.parent, f.root);
    assert.equal(merged.getTotalVertices(), expected.reduce((sum, entry) => sum + entry.vertices, 0));
    assert.equal(merged.getTotalIndices(), expected.reduce((sum, entry) => sum + entry.indices, 0));
    assert.equal(merged.subMeshes.length, 1);
    const positions = merged.getVerticesData(VertexBuffer.PositionKind)!;
    const normals = merged.getVerticesData(VertexBuffer.NormalKind)!;
    const colors = merged.getVerticesData(VertexBuffer.ColorKind)!;
    let vertex = 0;
    for (const entry of expected) {
      const world = merged.computeWorldMatrix(true);
      near(Vector3.TransformCoordinates(Vector3.FromArray(positions, vertex * 3), world), entry.position, 'world position');
      near(Vector3.TransformNormal(Vector3.FromArray(normals, vertex * 3), Matrix.Transpose(Matrix.Invert(world))).normalize(), entry.normal, 'world normal');
      near(Vector3.FromArray(colors, vertex * 4), new Vector3(entry.color.r, entry.color.g, entry.color.b), 'palette color');
      vertex += entry.vertices;
    }
    const previousPosition = Vector3.TransformCoordinates(Vector3.FromArray(positions), merged.computeWorldMatrix(true));
    f.root.position.x += 4;
    near(Vector3.TransformCoordinates(Vector3.FromArray(positions), merged.computeWorldMatrix(true)), previousPosition.add(new Vector3(4, 0, 0)), 'follows animation');
    f.root.setEnabled(false);
    assert.equal(merged.isEnabled(), false);
    f.root.setEnabled(true);
    assert.equal(merged.isEnabled(), true);
  } finally { f.engine.dispose(); }
});

test('opaque batches respect shadows while emissive and transparent pieces keep their materials', () => {
  const f = fixture();
  try {
    const casters = [f.box('caster-a', '#426c52'), f.box('caster-b', '#e8ba82')];
    const details = [f.box('detail-a', '#426c52', false), f.box('detail-b', '#e8ba82', false)];
    const glow = f.material('#efd17a', .2);
    const glowing = [f.box('glow-a', '#efd17a', false), f.box('glow-b', '#efd17a', false)];
    glowing.forEach(mesh => { mesh.material = glow; });
    const transparent = f.box('halo', '#efa567', false);
    transparent.material = f.material('#efa567', .55, .7);
    const fading = f.box('fading', '#fff1c1', false); fading.visibility = .4;
    const batches = mergeOpaqueMeshes(f.root, [...casters, ...details, ...glowing, transparent, fading]);
    assert.equal(batches.length, 5);
    assert.ok(batches.includes(transparent));
    assert.ok(batches.includes(fading));
    const emissive = batches.find(mesh => mesh.material === glow)!;
    assert.ok(emissive);
    assert.equal(emissive.isVerticesDataPresent(VertexBuffer.ColorKind), false);
    assert.equal(batches.filter(mesh => mesh.metadata.castsShadow).length, 1);
    assert.ok(batches.every(mesh => mesh.receiveShadows));
  } finally { f.engine.dispose(); }
});

test('static batches freeze only when requested and preserve legacy world normals', () => {
  const f = fixture();
  try {
    const left = f.box('left', '#426c52'), right = f.box('right', '#e8ba82');
    left.scaling.set(.3, 1.4, .8); left.rotation.set(.6, .2, -.3);
    const expected = Vector3.TransformNormal(Vector3.FromArray(left.getVerticesData(VertexBuffer.NormalKind)!), left.computeWorldMatrix(true)).normalize();
    const [merged] = mergeOpaqueMeshes(f.root, [left, right], { freezeWorldMatrix: true, preserveNormals: false });
    assert.equal(merged.isWorldMatrixFrozen, true);
    near(Vector3.FromArray(merged.getVerticesData(VertexBuffer.NormalKind)!), expected, 'existing world normal');
  } finally { f.engine.dispose(); }
});

test('palette shader applies color before StandardMaterial lighting is clamped', async () => {
  const f = fixture();
  try {
    new HemisphericLight('sky', Vector3.Up(), f.scene);
    const [merged] = mergeOpaqueMeshes(f.root, [f.box('left', '#426c52'), f.box('right', '#e8ba82')]);
    const material = merged.material as StandardMaterial;
    await material.forceCompilationAsync(merged);
    assert.ok(material.isReadyForSubMesh(merged, merged.subMeshes[0]));
    const shader = merged.subMeshes[0].effect!.fragmentSourceCode;
    const palettePosition = shader.indexOf('diffuseColor *= vColor.rgb;');
    const lightingPosition = shader.indexOf('vec3 finalDiffuse=clamp(');
    assert.ok(palettePosition >= 0 && palettePosition < lightingPosition, 'Palette must color lighting before clamping, preserving bright surfaces');
    assert.ok(shader.includes('baseColor.rgb = vec3(1.0);'), 'Vertex colors must not tint the surface twice');
  } finally { f.engine.dispose(); }
});

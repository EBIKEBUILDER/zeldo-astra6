import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

/** StandardMaterial normally applies vertex color after clamping its lighting.
 * Use palette colors at the original diffuse-color point so bright surfaces do
 * not become darker when several differently colored meshes share a draw call.
 */
class PaletteMaterialPlugin extends MaterialPluginBase {
  constructor(material: StandardMaterial) {
    super(material, 'DiffusePalette', 200, undefined, true, true);
  }

  getClassName() { return 'DiffusePalette'; }

  getCustomCode(shaderType: string) {
    return shaderType === 'fragment' ? {
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
#ifdef VERTEXCOLOR
diffuseColor *= vColor.rgb;
baseColor.rgb = vec3(1.0);
#endif`,
    } : null;
  }
}

const paletteMaterials = new WeakMap<Scene, Map<string, StandardMaterial>>();

function paletteKey(material: StandardMaterial) {
  // Keep every serialized lighting, rasterization, and image-processing setting
  // in the bucket key; only the diffuse color and material identity may differ.
  const settings = material.serialize();
  for (const field of ['name', 'id', 'uniqueId', 'diffuse', 'metadata']) delete settings[field];
  return JSON.stringify(settings);
}

function paletteMaterial(source: StandardMaterial, key: string) {
  const scene = source.getScene();
  let cache = paletteMaterials.get(scene);
  if (!cache) { cache = new Map(); paletteMaterials.set(scene, cache); }
  let material = cache.get(key);
  if (!material) {
    material = source.clone(`palette-${cache.size}`);
    material.diffuseColor = Color3.White();
    new PaletteMaterialPlugin(material);
    cache.set(key, material);
  }
  return material;
}

export type MeshBatchOptions = {
  /** Only enable for roots which never move, rotate, or scale. */
  freezeWorldMatrix?: boolean;
  /** False retains the old world merger's normal baking, including its look on
   * nonuniformly scaled rocks and foliage. New articulated models use true. */
  preserveNormals?: boolean;
};

/** Batch selected rigid, textureless pieces beneath a common animation root.
 * Callers must exclude pieces which animate independently or are toggled later.
 * Transparent meshes stay separate to preserve sorting. Emissive materials keep
 * their original material, and shadow casters never mix with noncasters.
 * Returns the resulting meshes without registering any shadow render lists.
 */
export function mergeOpaqueMeshes(root: TransformNode, meshes: readonly Mesh[], options: MeshBatchOptions = {}): Mesh[] {
  type Batch = { meshes: Mesh[]; palette: boolean; materialKey: string };
  const batches = new Map<string, Batch>();
  const keys = new Map<StandardMaterial, string>();
  const result: Mesh[] = [];
  for (const mesh of meshes) {
    const material = mesh.material;
    if (!(material instanceof StandardMaterial) || material.getActiveTextures().length || mesh.visibility !== 1
      || !mesh.isVisible || !mesh.isEnabled(false) || material.alpha !== 1 || material.needAlphaBlendingForMesh(mesh)
      || material.needAlphaTestingForMesh(mesh) || mesh.skeleton || mesh.morphTargetManager
      || mesh.isVerticesDataPresent(VertexBuffer.ColorKind) || !mesh.getVerticesData(VertexBuffer.NormalKind)
      || !mesh.getIndices()?.length) {
      result.push(mesh);
      continue;
    }
    const palette = material.emissiveColor.equalsFloats(0, 0, 0) && !material.customShaderNameResolve;
    let materialKey = keys.get(material);
    if (!materialKey) {
      materialKey = palette ? paletteKey(material) : `material:${material.uniqueId}`;
      keys.set(material, materialKey);
    }
    const key = JSON.stringify([materialKey, Boolean(mesh.metadata?.castsShadow), mesh.receiveShadows,
      mesh.sideOrientation, mesh.renderingGroupId, mesh.layerMask, mesh.applyFog, mesh.isPickable, mesh.checkCollisions]);
    const batch = batches.get(key) ?? { meshes: [], palette, materialKey };
    batch.meshes.push(mesh);
    batches.set(key, batch);
  }

  const rootWorld = root.computeWorldMatrix(true).clone();
  const inverseRoot = Matrix.Invert(rootWorld);
  const rootNormal = Matrix.Transpose(rootWorld);
  const point = Vector3.Zero();
  const normal = Vector3.Zero();
  for (const batch of batches.values()) {
    if (batch.meshes.length < 2) { result.push(...batch.meshes); continue; }
    const first = batch.meshes[0];
    const vertexCount = batch.meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0);
    const indexCount = batch.meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const colors = batch.palette ? new Float32Array(vertexCount * 4) : null;
    const indices = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let vertexOffset = 0, indexOffset = 0;
    for (const mesh of batch.meshes) {
      const world = mesh.computeWorldMatrix(true);
      const relative = world.multiply(inverseRoot);
      const normalTransform = options.preserveNormals === false ? relative
        : Matrix.Transpose(Matrix.Invert(world)).multiply(rootNormal);
      const sourcePositions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
      const sourceNormals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
      const color = (mesh.material as StandardMaterial).diffuseColor;
      for (let v = 0; v < mesh.getTotalVertices(); v++) {
        Vector3.TransformCoordinatesFromFloatsToRef(sourcePositions[v * 3], sourcePositions[v * 3 + 1], sourcePositions[v * 3 + 2], relative, point);
        point.toArray(positions, (vertexOffset + v) * 3);
        Vector3.TransformNormalFromFloatsToRef(sourceNormals[v * 3], sourceNormals[v * 3 + 1], sourceNormals[v * 3 + 2], normalTransform, normal);
        normal.normalize().toArray(normals, (vertexOffset + v) * 3);
        if (colors) {
          const offset = (vertexOffset + v) * 4;
          colors[offset] = color.r; colors[offset + 1] = color.g; colors[offset + 2] = color.b; colors[offset + 3] = 1;
        }
      }
      const sourceIndices = mesh.getIndices()!;
      const mirrored = relative.determinant() < 0;
      for (let i = 0; i < sourceIndices.length; i += 3) {
        indices[indexOffset + i] = sourceIndices[i] + vertexOffset;
        indices[indexOffset + i + 1] = sourceIndices[i + (mirrored ? 2 : 1)] + vertexOffset;
        indices[indexOffset + i + 2] = sourceIndices[i + (mirrored ? 1 : 2)] + vertexOffset;
      }
      vertexOffset += mesh.getTotalVertices(); indexOffset += sourceIndices.length;
    }
    const merged = new Mesh(`${root.name}-batch-${result.length}`, root.getScene());
    const data = new VertexData();
    data.positions = positions; data.normals = normals; data.indices = indices; data.colors = colors;
    data.applyToMesh(merged);
    merged.parent = root;
    merged.material = batch.palette ? paletteMaterial(first.material as StandardMaterial, batch.materialKey) : first.material;
    merged.metadata = { ...first.metadata, castsShadow: Boolean(first.metadata?.castsShadow) };
    merged.receiveShadows = first.receiveShadows;
    merged.sideOrientation = first.sideOrientation;
    merged.renderingGroupId = first.renderingGroupId;
    merged.layerMask = first.layerMask;
    merged.applyFog = first.applyFog;
    merged.isPickable = first.isPickable;
    merged.checkCollisions = first.checkCollisions;
    merged.hasVertexAlpha = false;
    for (const mesh of batch.meshes) mesh.dispose();
    result.push(merged);
  }
  if (options.freezeWorldMatrix) for (const mesh of result) mesh.freezeWorldMatrix();
  return result;
}

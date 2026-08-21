// The fruit tree for the Feed errand. Placed in CODE (not the composite) so this
// feature stays a clean, self-contained diff and doesn't drag the Creator Hub's
// asset-packs scaffolding into the scene. feed.ts drives the errand off getTree().

import { engine, Entity, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

const TREE_MODEL = 'models/tree.glb'
// Same transform the tree had when it lived in the composite (entity 601).
const TREE_POSITION = Vector3.create(121.865, 0, 212.853)

let tree: Entity | null = null

export function setupTree(): void {
  if (tree) return
  tree = engine.addEntity()
  Transform.create(tree, { position: TREE_POSITION })
  // Pointer-only collider: the tree just needs to be clickable, not a physics
  // body — the full 3.6 MB canopy as a physics collider is wasteful on mobile.
  GltfContainer.create(tree, { src: TREE_MODEL, visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })
}

/** The tree entity, or null before setupTree() has run. */
export function getTree(): Entity | null {
  return tree
}

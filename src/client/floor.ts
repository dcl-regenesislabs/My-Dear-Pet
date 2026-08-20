// Ground plane for the playable area (see skybox.ts BOUNDARY_PLANES for the
// footprint this matches), textured with a tiled grass texture. Visual only —
// the scene's default terrain still provides collision underneath.

import { engine, Transform, MeshRenderer, Material, TextureWrapMode } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

const GRASS_TEXTURE_SRC = 'assets/images/grasstexture01.png'

// Matches the boundary walls' footprint in skybox.ts: x 67.25..367.25, z 71.5..371.25.
const FLOOR_CENTER = Vector3.create(217.25, 0.02, 221.375)
const FLOOR_SIZE = 300 // metres, square
const FLOOR_TILE_METERS = 4 // grass texture repeats every N metres

export function setupFloor(): void {
  const floor = engine.addEntity()
  Transform.create(floor, {
    position: FLOOR_CENTER,
    scale: Vector3.create(FLOOR_SIZE, FLOOR_SIZE, 1),
    rotation: Quaternion.fromEulerDegrees(-90, 0, 0)
  })

  const repeat = FLOOR_SIZE / FLOOR_TILE_METERS
  const face = [0, 0, repeat, 0, repeat, repeat, 0, repeat]
  MeshRenderer.setPlane(floor, [...face, ...face])

  Material.setPbrMaterial(floor, {
    texture: Material.Texture.Common({
      src: GRASS_TEXTURE_SRC,
      wrapMode: TextureWrapMode.TWM_REPEAT
    }),
    roughness: 1, // 100% — matte grass, no shine
    metallic: 0 // was defaulting to 0.5 — plain diffuse texture, not metallic
  })
}

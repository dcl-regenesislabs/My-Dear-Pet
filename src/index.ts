import { isServer } from '@dcl/sdk/network'

export async function main() {
  if (isServer()) {
    // Headless authoritative server: state, validation, decay, persistence.
    const { server } = await import('./server/server')
    server()
    return
  }

  // Client: UI, pet rendering, input, and message handling.
  const { setupClient } = await import('./client/setup')
  setupClient()
}

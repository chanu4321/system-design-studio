import { useState } from 'react'
import { ApiClient } from './api/client.js'
import { Library } from './routes/Library.js'
import { Workspace } from './routes/Workspace.js'

const client = new ApiClient()

export function App() {
  const [openId, setOpenId] = useState<string | null>(null)

  return openId ? (
    <Workspace client={client} projectId={openId} view="lld" onBack={() => setOpenId(null)} />
  ) : (
    <Library client={client} onOpen={setOpenId} />
  )
}

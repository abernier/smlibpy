import { init, WSClient } from '@buerli.io/classcad'
import { Buerligons } from '@buerli.io/buerligons'
import { createRoot } from 'react-dom/client'

// The page is opened with the invite of the session it shows (?invite=…) and joins it at /session on the address it
// came from, where smlibpy's session server answers. The model is the agent's: the app shows it and can save it.
const invite = new URLSearchParams(location.search).get('invite') ?? undefined
init(id => new WSClient('/session', id, { invite, identity: { app: 'buerligons', kind: 'app' } }))

createRoot(document.getElementById('root')!).render(<Buerligons readOnly />)

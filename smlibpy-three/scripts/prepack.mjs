// Runs before npm pack and npm publish: the package holds the TypeScript compiled afresh to dist and
// the repository's license text, and it depends on the smlibwasm of its release. In the repository the
// dependency is js/ by path; the release workflow names the version first (npm pkg set), and a package
// that still names the path is refused here.
import { execFileSync } from 'node:child_process'
import { cpSync, readFileSync, rmSync } from 'node:fs'

const three = new URL('..', import.meta.url)
const smlibwasm = JSON.parse(readFileSync(new URL('package.json', three), 'utf8')).dependencies['@classcad/smlibwasm']
if (smlibwasm.startsWith('file:'))
  throw new Error(`@classcad/smlibwasm is ${smlibwasm}, a path in the repository: name the release's version first, as the release workflow does (npm pkg set "dependencies.@classcad/smlibwasm=^<version>")`)
rmSync(new URL('dist', three), { recursive: true, force: true })
execFileSync('npm', ['run', 'build'], { cwd: three, stdio: 'inherit' })
cpSync(new URL('../LICENSE', three), new URL('LICENSE', three))

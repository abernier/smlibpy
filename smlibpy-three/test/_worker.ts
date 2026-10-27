// The module of the test worker (worker.test.ts): answers a KernelWorker with the functions of
// _worker_models.ts, loaded after it listens.
import { expose } from '../src/worker.ts'

expose(() => import('./_worker_models.ts'))

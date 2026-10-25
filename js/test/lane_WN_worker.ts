// The module of the test worker (lane_WN.test.ts): answers a KernelWorker with the functions of
// lane_WN_models.ts, loaded after it listens.
import { expose } from '../src/worker.ts'

expose(() => import('./lane_WN_models.ts'))

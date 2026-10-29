// https://github.com/holepunchto/hello-pear-worker v1.2.0

const PearRuntime = require('pear-runtime') // pear-runtime on desktop; pear-mobile on mobile
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Autopass = require('autopass')
const goodbye = require('graceful-goodbye')
const FramedStream = require('framed-stream')
const path = require('bare-path')
const dir = require('bare-storage')
const { isBareKit } = require('which-runtime')

// mobile doesn't have the executable path (argv[0])
// and the worker entry path (argv[1]) in the workers argv‘s
// ... to reuse the same worker in all platforms this logic is needed
const argv = (index) => Bare.argv[index + (isBareKit ? 0 : 2)]

const updaterConfig = {
  updates: argv(0) !== 'false',
  version: argv(1),
  upgrade: argv(2),
  name: argv(3),
  dir: argv(4) || dir.persistent(), // argv[4] is undefined in mobile
  app: argv(5) // argv[5] is undefined in mobile
}

const pipe = new FramedStream(Bare.IPC)
const store = new Corestore(path.join(updaterConfig.dir, 'pear-runtime', 'corestore'))
const passStore = new Corestore(path.join(updaterConfig.dir, 'app-storage', 'autopass'))
const swarm = new Hyperswarm()
const pear = new PearRuntime({ ...updaterConfig, swarm, store })

let pass = null

function toHex(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

function send(message) {
  pipe.write(JSON.stringify(message))
}

pear.updater.on('error', (err) => pipe.write('updater-error ' + err.message))

if (updaterConfig.updates !== false) {
  swarm.on('connection', (connection) => store.replicate(connection))
  swarm.join(pear.updater.drive.core.discoveryKey, {
    client: true,
    server: false
  })
}

// An append on the app's drive doesn't check for an update straight away: the
// updater defers it by a random delay of up to an hour (see PearRuntimeUpdater)
// so that a released fleet doesn't hit the seeder all at once. Forward the
// delay so the app can say it is waiting rather than look inert — without it,
// a staged update is indistinguishable from a broken updater for up to an hour.
pear.updater.on('update-scheduled', (delay) => pipe.write('update-scheduled ' + delay))
pear.updater.on('updating', () => pipe.write('updating'))
pear.updater.on('updated', () => pipe.write('updated'))
pear.on('minver-required', () => pipe.write('minver-required')) // for mobile store update notification

goodbye(async () => {
  if (pass) await pass.close()
  await swarm.destroy()
  await pear.close()
  await store.close()
  await passStore.close()
})

async function openVault() {
  try {
    pass = new Autopass(passStore)
    await pass.ready()
    send({
      type: 'state',
      payload: { status: 'ready', writerKey: toHex(pass.writerKey), room: null }
    })
  } catch (err) {
    send({ type: 'error', payload: { message: err.message } })
  }
}

pipe.on('data', async (data) => {
  const message = data.toString()
  if (message === 'pear:applyUpdate') {
    try {
      await pear.ready()
      await pear.updater.applyUpdate()
      pipe.write('pear:updateApplied')
    } catch (err) {
      pipe.write('pear:updateFailed ' + err.message)
    }
    return
  }

  let parsed = null
  if (message.startsWith('{')) {
    try {
      parsed = JSON.parse(message)
    } catch (err) {
      send({ type: 'error', payload: { message: 'Bad JSON' } })
      return
    }
  }

  if (!parsed || typeof parsed.type !== 'string') {
    pipe.write('unknown-message ' + message)
    return
  }

  if (parsed.type === 'ping') {
    send({ type: 'pong' })
    return
  }

  send({ type: 'error', payload: { message: 'Unknown message ' + parsed.type } })
})

send({ type: 'state', payload: { status: 'loading', writerKey: null, room: null } })
openVault()

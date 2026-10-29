// https://github.com/holepunchto/hello-pear-worker v1.2.0

const PearRuntime = require('pear-runtime') // pear-runtime on desktop; pear-mobile on mobile
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const Autopass = require('autopass')
const goodbye = require('graceful-goodbye')
const FramedStream = require('framed-stream')
const path = require('bare-path')
const fs = require('bare-fs')
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
const localDir = path.join(updaterConfig.dir, 'app-storage', 'autopass')
const joinedDir = path.join(updaterConfig.dir, 'app-storage', 'joined')

function dirExists(dir) {
  try {
    fs.accessSync(dir)
    return true
  } catch (err) {
    return false
  }
}

let passStore = new Corestore(dirExists(joinedDir) ? joinedDir : localDir)
const swarm = new Hyperswarm()
const pear = new PearRuntime({ ...updaterConfig, swarm, store })

let pass = null
let pairing = null

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
  if (pairing) await pairing.close()
  if (pass) await pass.close()
  await swarm.destroy()
  await pear.close()
  await store.close()
  await passStore.close()
})

function onPassUpdate() {
  publishState().catch((err) => send({ type: 'error', payload: { message: err.message } }))
}

function withTimeout(promise, ms, message) {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Autopass leaves finished() hanging when the room is already writable.
function finishWhenWritable(pair) {
  pair._whenWritable = function () {
    const resolve = () => {
      if (this._settled) return
      this._settled = true
      if (this.onresolve) this.onresolve(this.pass)
    }
    if (this.pass && this.pass.base && this.pass.base.writable) {
      resolve()
      return
    }
    const check = () => {
      if (this.pass && this.pass.base && this.pass.base.writable) {
        this.pass.base.off('update', check)
        resolve()
      }
    }
    if (this.pass && this.pass.base) this.pass.base.on('update', check)
  }
}

let folding = false
let foldAgain = false

function listRecords() {
  return pass.list().toArray()
}

async function foldRoom() {
  const records = await listRecords()
  let meta = null
  const players = []

  for (const rec of records) {
    if (!rec || typeof rec.key !== 'string' || typeof rec.value !== 'string') continue
    let value
    try {
      value = JSON.parse(rec.value)
    } catch (err) {
      continue
    }
    if (rec.key === 'meta:room') meta = value
    else if (rec.key.startsWith('player:')) {
      players.push({
        writerKey: rec.key.slice('player:'.length),
        name: value.name || '',
        seat: value.seat
      })
    }
  }

  if (!meta) return null
  players.sort((a, b) => a.seat - b.seat)
  const writerKey = toHex(pass.writerKey)
  return {
    phase: meta.phase,
    round: meta.round,
    players,
    you: { writerKey, isHost: meta.hostKey === writerKey }
  }
}

async function publishState() {
  if (folding) {
    foldAgain = true
    return
  }
  folding = true
  try {
    do {
      foldAgain = false
      const room = await foldRoom()
      send({
        type: 'state',
        payload: { status: 'ready', writerKey: toHex(pass.writerKey), room }
      })
      if (room && room.you.isHost) {
        const invite = await pass.createInvite()
        send({ type: 'invite', payload: { invite } })
      }
    } while (foldAgain)
  } finally {
    folding = false
  }
}

async function createRoom() {
  if (!pass) throw new Error('Vault is not ready')
  const writerKey = toHex(pass.writerKey)
  const records = await listRecords()
  const meta = records.find((rec) => rec && rec.key === 'meta:room')
  if (!meta) {
    await pass.add(
      'meta:room',
      JSON.stringify({ phase: 'lobby', round: 0, turnOrder: [], hostKey: writerKey })
    )
    await pass.add('player:' + writerKey, JSON.stringify({ name: '', seat: 1 }))
  }
  await publishState()
}

async function ensureSeat() {
  const writerKey = toHex(pass.writerKey)
  const records = await listRecords()
  if (records.some((rec) => rec && rec.key === 'player:' + writerKey)) return

  let maxSeat = 0
  for (const rec of records) {
    if (!rec || typeof rec.key !== 'string' || !rec.key.startsWith('player:')) continue
    if (typeof rec.value !== 'string') continue
    try {
      const value = JSON.parse(rec.value)
      if (typeof value.seat === 'number' && value.seat > maxSeat) maxSeat = value.seat
    } catch (err) {
      continue
    }
  }

  await pass.add('player:' + writerKey, JSON.stringify({ name: '', seat: maxSeat + 1 }))
}

async function waitForPlayers() {
  for (let i = 0; i < 20; i++) {
    const room = await foldRoom()
    if (room && room.players.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Joined, but the room has not synced yet')
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch (err) {}
}

async function joinRoom(invite) {
  const code = typeof invite === 'string' ? invite.trim() : ''
  if (!code) throw new Error('Invite is empty')
  if (code.length < 80) {
    throw new Error('That invite looks cut off. On the host, press Copy and paste the whole thing.')
  }
  if (!pass) throw new Error('Vault is not ready')
  if (await foldRoom()) throw new Error('Already in a room')

  pass.removeAllListeners('update')
  const previous = pass
  pass = null
  await previous.close()
  await passStore.close()
  removeDir(joinedDir)

  passStore = new Corestore(joinedDir)
  pairing = Autopass.pair(passStore, code)
  finishWhenWritable(pairing)
  try {
    pass = await withTimeout(
      pairing.finished(),
      45000,
      'Could not join. Keep the host window open and try again.'
    )
    pairing = null
    await pass.ready()
    pass.on('update', onPassUpdate)
    await waitForPlayers()
    await ensureSeat()
    await publishState()
  } catch (err) {
    if (pairing) {
      const pending = pairing
      pairing = null
      await pending.close().catch(() => {})
    }
    if (pass) {
      await pass.close().catch(() => {})
      pass = null
    }
    await passStore.close().catch(() => {})
    removeDir(joinedDir)
    passStore = new Corestore(localDir)
    await openLocalPass()
    throw err
  }
}

async function openLocalPass() {
  pass = new Autopass(passStore)
  pass.on('update', onPassUpdate)
  await pass.ready()
  await publishState()
}

async function openVault() {
  try {
    await openLocalPass()
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

  if (parsed.type === 'createRoom') {
    try {
      await createRoom()
    } catch (err) {
      send({ type: 'error', payload: { message: err.message } })
    }
    return
  }

  if (parsed.type === 'joinRoom') {
    try {
      await joinRoom(parsed.payload && parsed.payload.invite)
    } catch (err) {
      send({ type: 'error', payload: { message: err.message } })
    }
    return
  }

  send({ type: 'error', payload: { message: 'Unknown message ' + parsed.type } })
})

send({ type: 'state', payload: { status: 'loading', writerKey: null, room: null } })
openVault()

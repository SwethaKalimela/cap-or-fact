const bridge = window.bridge
const decoder = new TextDecoder('utf-8')

const workers = {
  main: '/workers/main.js'
}

const pipeLine = document.getElementById('pipe')
const vaultLine = document.getElementById('vault')
const createBtn = document.getElementById('create')
const notice = document.getElementById('notice')
const lobby = document.getElementById('lobby')
const inviteLine = document.getElementById('invite')
const copyBtn = document.getElementById('copy')
const players = document.getElementById('players')

let sentPing = false
let creating = false
let invite = ''

function showError(message) {
  vaultLine.textContent = message
  vaultLine.dataset.state = 'error'
}

function showNotice(message) {
  notice.hidden = false
  notice.textContent = message
}

function showLobby(room) {
  createBtn.hidden = true
  lobby.hidden = false
  players.replaceChildren()
  for (const player of room.players || []) {
    const li = document.createElement('li')
    li.textContent = player.name ? player.name : 'Seat ' + player.seat
    players.appendChild(li)
  }
}

createBtn.onclick = () => {
  creating = true
  createBtn.disabled = true
  notice.hidden = true
  bridge.writeWorkerIPC(workers.main, JSON.stringify({ type: 'createRoom' }))
}

copyBtn.onclick = async () => {
  if (!invite) return
  try {
    await navigator.clipboard.writeText(invite)
    copyBtn.textContent = 'Copied'
  } catch (err) {
    showNotice('Could not copy')
  }
}

function onJson(message) {
  if (message.type === 'pong') {
    pipeLine.textContent = 'Pipe: pong'
    pipeLine.dataset.state = 'ok'
    return
  }

  if (message.type === 'state') {
    const payload = message.payload || {}
    if (payload.status === 'loading') {
      vaultLine.textContent = 'Opening vault...'
      vaultLine.dataset.state = 'loading'
      return
    }
    if (payload.status === 'ready') {
      vaultLine.textContent = 'Vault ready'
      vaultLine.dataset.state = 'ok'
      if (payload.room) showLobby(payload.room)
      else if (!creating) createBtn.disabled = false
      return
    }
  }

  if (message.type === 'invite') {
    invite = (message.payload && message.payload.invite) || ''
    inviteLine.textContent = invite || 'No invite'
    copyBtn.textContent = 'Copy'
    return
  }

  if (message.type === 'error') {
    const payload = message.payload || {}
    const text = payload.message || 'Something went wrong'
    if (vaultLine.dataset.state === 'ok') {
      creating = false
      showNotice(text)
      if (lobby.hidden) createBtn.disabled = false
      return
    }
    showError(text)
  }
}

function onUpdater(message) {
  if (message === 'updating') {
    vaultLine.textContent = 'Updating...'
    vaultLine.dataset.state = 'loading'
    return
  }
  if (message === 'updated') {
    vaultLine.textContent = 'Update ready'
    vaultLine.dataset.state = 'ok'
  }
}

function sendPing() {
  if (sentPing) return
  sentPing = true
  bridge.writeWorkerIPC(workers.main, JSON.stringify({ type: 'ping' }))
}

bridge.startWorker(workers.main)

bridge.onWorkerStdout(workers.main, (data) => {
  console.log('worker stdout', decoder.decode(data))
})

bridge.onWorkerStderr(workers.main, (data) => {
  console.error('worker stderr', decoder.decode(data))
})

bridge.onWorkerIPC(workers.main, (data) => {
  const message = decoder.decode(data)
  console.log('worker ipc', message)
  sendPing()

  if (message.startsWith('{')) {
    try {
      onJson(JSON.parse(message))
    } catch (err) {
      showError('Bad message from worker')
    }
    return
  }

  onUpdater(message)
})

bridge.onWorkerExit(workers.main, (code) => {
  console.log('Worker exited with code', code)
  if (code) showError('Worker stopped (' + code + ')')
})

const bridge = window.bridge
const decoder = new TextDecoder('utf-8')

const workers = {
  main: '/workers/main.js'
}

const pipeLine = document.getElementById('pipe')
const vaultLine = document.getElementById('vault')
const createBtn = document.getElementById('create')
const notice = document.getElementById('notice')
const home = document.getElementById('home')
const joinForm = document.getElementById('join-form')
const inviteInput = document.getElementById('invite-input')
const joinBtn = document.getElementById('join')
const lobby = document.getElementById('lobby')
const inviteBox = document.getElementById('invite-box')
const inviteLine = document.getElementById('invite')
const copyBtn = document.getElementById('copy')
const players = document.getElementById('players')

let sentPing = false
let creating = false
let joining = false
let invite = ''

function showError(message) {
  vaultLine.textContent = message
  vaultLine.dataset.state = 'error'
}

function showNotice(message, state) {
  notice.hidden = false
  notice.textContent = message
  notice.dataset.state = state || 'error'
}

function setHomeEnabled(on) {
  createBtn.disabled = !on
  joinBtn.disabled = !on
  inviteInput.disabled = !on
}

function showLobby(room) {
  home.hidden = true
  lobby.hidden = false
  inviteBox.hidden = !(room.you && room.you.isHost)
  players.replaceChildren()
  const list = room.players || []
  for (const player of list) {
    const li = document.createElement('li')
    li.textContent = player.name ? player.name : 'Seat ' + player.seat
    players.appendChild(li)
  }
  if (list.length < 2) {
    const waiting = document.createElement('li')
    waiting.textContent = 'Waiting for players'
    players.appendChild(waiting)
  }
}

joinForm.onsubmit = (evt) => {
  evt.preventDefault()
  const code = inviteInput.value.trim()
  if (!code) {
    showNotice('Invite is empty')
    return
  }
  joining = true
  setHomeEnabled(false)
  showNotice('Joining...', 'loading')
  bridge.writeWorkerIPC(
    workers.main,
    JSON.stringify({ type: 'joinRoom', payload: { invite: code } })
  )
}

createBtn.onclick = () => {
  creating = true
  setHomeEnabled(false)
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
      else if (!creating && !joining) {
        home.hidden = false
        lobby.hidden = true
        setHomeEnabled(true)
      }
      return
    }
  }

  if (message.type === 'invite') {
    const next = (message.payload && message.payload.invite) || ''
    if (next === invite) return
    invite = next
    inviteLine.value = invite || 'No invite'
    copyBtn.textContent = 'Copy'
    return
  }

  if (message.type === 'error') {
    const payload = message.payload || {}
    const text = payload.message || 'Something went wrong'
    if (vaultLine.dataset.state === 'ok') {
      creating = false
      joining = false
      showNotice(text)
      if (lobby.hidden) setHomeEnabled(true)
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

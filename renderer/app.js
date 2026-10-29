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
const nameForm = document.getElementById('name-form')
const nameInput = document.getElementById('name-input')
const saveNameBtn = document.getElementById('save-name')
const nameStatus = document.getElementById('name-status')
const players = document.getElementById('players')
const startBtn = document.getElementById('start')
const turn = document.getElementById('turn')
const turnTitle = document.getElementById('turn-title')
const queue = document.getElementById('queue')

let sentPing = false
let creating = false
let joining = false
let savingName = false
let starting = false
let invite = ''

function canStart(room) {
  const list = room.players || []
  return list.length === 3 && list.every((player) => player.name && player.name.trim())
}

function authorName(room) {
  const author = (room.turnOrder || []).find((player) => player.writerKey === room.authorKey)
  return (author && author.name) || 'Someone'
}

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

function showQueue(room, listEl) {
  listEl.replaceChildren()
  for (const player of room.turnOrder || []) {
    const li = document.createElement('li')
    li.textContent = 'Seat ' + player.seat + ' · ' + (player.name || 'Seat ' + player.seat)
    if (player.writerKey === room.authorKey) li.className = 'current'
    listEl.appendChild(li)
  }
}

function showTurn(room) {
  home.hidden = true
  lobby.hidden = true
  turn.hidden = false
  starting = false
  const label = 'Round ' + room.round + ' of ' + (room.roundCount || 3)
  turnTitle.textContent = room.you.isAuthor
    ? 'Your turn · ' + label
    : authorName(room) + ' is writing · ' + label
  showQueue(room, queue)
}

function showLobby(room) {
  if (room.phase && room.phase !== 'lobby') {
    showTurn(room)
    return
  }

  home.hidden = true
  lobby.hidden = false
  turn.hidden = true
  inviteBox.hidden = !(room.you && room.you.isHost)
  const list = room.players || []
  const me = list.find((player) => player.writerKey === room.you.writerKey)
  if (me && me.name && document.activeElement !== nameInput) nameInput.value = me.name

  players.replaceChildren()
  for (const player of list) {
    const li = document.createElement('li')
    li.textContent = player.name
      ? 'Seat ' + player.seat + ' · ' + player.name
      : 'Seat ' + player.seat
    players.appendChild(li)
  }
  if (list.length < 2) {
    const waiting = document.createElement('li')
    waiting.textContent = 'Waiting for players'
    players.appendChild(waiting)
  }

  if (savingName && me && me.name) {
    savingName = false
    saveNameBtn.disabled = false
    nameStatus.hidden = false
    nameStatus.textContent = 'Saved'
    nameStatus.dataset.state = 'ok'
  }

  startBtn.hidden = !(room.you && room.you.isHost)
  startBtn.disabled = starting || !canStart(room)
}

nameForm.onsubmit = (evt) => {
  evt.preventDefault()
  const name = nameInput.value.trim()
  if (!name) {
    showNotice('Name is empty')
    return
  }
  savingName = true
  saveNameBtn.disabled = true
  nameStatus.hidden = true
  notice.hidden = true
  bridge.writeWorkerIPC(workers.main, JSON.stringify({ type: 'setName', payload: { name } }))
}

startBtn.onclick = () => {
  starting = true
  startBtn.disabled = true
  notice.hidden = true
  bridge.writeWorkerIPC(workers.main, JSON.stringify({ type: 'startGame' }))
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
    invite = next
    inviteLine.value = invite || 'No invite'
    copyBtn.textContent = 'Copy'
    if (invite) notice.hidden = true
    return
  }

  if (message.type === 'error') {
    const payload = message.payload || {}
    const text = payload.message || 'Something went wrong'
    if (vaultLine.dataset.state === 'ok') {
      creating = false
      joining = false
      if (starting) {
        starting = false
        startBtn.disabled = false
      }
      if (savingName) {
        savingName = false
        saveNameBtn.disabled = false
      }
      showNotice(text)
      if (lobby.hidden && turn.hidden) setHomeEnabled(true)
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

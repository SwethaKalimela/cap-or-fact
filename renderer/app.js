const bridge = window.bridge
const decoder = new TextDecoder('utf-8')

const workers = {
  main: '/workers/main.js'
}

const pipeLine = document.getElementById('pipe')
const vaultLine = document.getElementById('vault')

let sentPing = false

function showError(message) {
  vaultLine.textContent = message
  vaultLine.dataset.state = 'error'
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
      return
    }
  }

  if (message.type === 'error') {
    const payload = message.payload || {}
    showError(payload.message || 'Something went wrong')
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

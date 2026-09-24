// Demo agent client — drives the 5 tools exactly like an AI would.
//
//   1. map()                  -> recognize pages that exist
//   2. routine()              -> find transition edges (the path)
//   3. snapshot()             -> get handles of the FOCUSED page
//   4. act(actionId, value?)  -> fire the fixed handler (only!)
//   5. wait_for_ui()          -> until the focused page is ready (ready == !loading)
//
// The agent keeps NO page state of its own; it re-reads each step.
//
// The demo login has two declared branches:
//   success -> home          when username=admin and password=demoP@ssw0rd
//   failure -> login-error   otherwise
//
// The page is also a real URL app (vue-router hash history): each branch
// pushes a route, so the address bar changes (#/login -> #/login-error ->
// #/login -> #/home) and browser back/forward works alongside the agent.
//
// NOTE on timing: `wait_for_ui` only waits for the focused page's `ready` flag
// (page loading). Focus changes are a separate fact the agent must RE-READ via
// `map()`/`snapshot()`. After a `act` with transitionsTo, we poll `map()` until
// the target page reports `focused:true` (the page has finished settling) before
// snapshotting it. We also sleep 1s between steps so a human can watch the UI.

const BASE = 'http://127.0.0.1:7798'
const STEP_PAUSE_MS = 1000 // pause between operations so the UI is observable

async function call(method: string, params: any = {}): Promise<any> {
  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error.message)
  return j.result
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function pause(label: string) {
  console.log(`   …暂停 ${STEP_PAUSE_MS / 1000}s（${label}）`)
  await sleep(STEP_PAUSE_MS)
}

function findAction(page: any, pred: (a: any) => boolean): any {
  const walk = (nodes: any[]): any => {
    for (const n of nodes) {
      if (n.kind === 'action' && pred(n)) return n
      if (n.children) { const r = walk(n.children); if (r) return r }
    }
    return null
  }
  return walk(page.children ?? [])
}

async function snapshot(): Promise<any> {
  const s = await call('snapshot')
  if (!s.page) throw new Error('no focused page')
  return s.page
}

// After a transition, wait until `targetId` is the focused page (re-read via map).
async function waitForFocus(targetId: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pages = await call('map')
    const t = pages.find((p: any) => p.id === targetId)
    if (t?.focused) return
    await sleep(120)
  }
  const pages = await call('map')
  throw new Error(`focus did not move to "${targetId}". current map: ${JSON.stringify(pages)}`)
}

// Fill the login form and click the submit action. The button's metadata has
// success/failure branches; we only click, then read the returned outcome.
async function submitLogin(username: string, password: string): Promise<any> {
  const page = await snapshot()
  const userInput = findAction(page, (a: any) => a.type === 'input' && a.placeholder === 'username')
  const passwordInput = findAction(page, (a: any) => a.type === 'input' && a.placeholder === 'password')
  if (!userInput) throw new Error('username input not found in login page: ' + JSON.stringify(page))
  if (!passwordInput) throw new Error('password input not found in login page: ' + JSON.stringify(page))

  console.log('found username input:', userInput.id)
  console.log(`act(username, "${username}")`, await call('act', { actionId: userInput.id, value: username }))
  console.log('found password input:', passwordInput.id)
  console.log(`act(password, "${password}")`, await call('act', { actionId: passwordInput.id, value: password }))

  // Flat `transitionsTo` mirrors the success branch, so this also matches old metadata.
  const submit = findAction(page, (a: any) => a.transitionsTo === 'home' || a.success?.transitionsTo === 'home')
  if (!submit) throw new Error('submit action not found in login page: ' + JSON.stringify(page))
  console.log('submit action:', submit.id)
  return call('act', { actionId: submit.id })
}

async function main() {
  console.log('=== 1) map() ===')
  console.log(await call('map'))

  console.log('\n=== 2) routine() ===')
  console.log(await call('routine'))

  // ---- login attempt 1: wrong credentials -> failure branch ----
  await pause('before reading login (wrong credentials)')
  console.log('\n=== 3) snapshot(login) ===')
  console.log('=== 4) act(wrong credentials) -> failure -> login-error ===')
  console.log(await submitLogin('alice', 'wrong-password'))
  console.log('=== 5) wait_for_ui() ===')
  console.log(await call('wait_for_ui', { timeoutMs: 3000 }))
  await waitForFocus('login-error')
  await pause('after the failure branch (login-error)')

  // ---- login-error: back -> login ----
  console.log('\n=== 3) snapshot(login-error) ===')
  let page = await snapshot()
  const back = findAction(page, (a: any) => a.transitionsTo === 'login')
  if (!back) throw new Error('back action not found in login-error page: ' + JSON.stringify(page))
  console.log('=== 4) act(back) ===')
  console.log(await call('act', { actionId: back.id }))
  console.log('=== 5) wait_for_ui() ===')
  console.log(await call('wait_for_ui', { timeoutMs: 3000 }))
  await waitForFocus('login')
  await pause('after going back to login')

  // ---- login attempt 2: correct credentials -> success branch ----
  console.log('\n=== 3) snapshot(login) ===')
  console.log('=== 4) act(admin / demoP@ssw0rd) -> success -> home ===')
  console.log(await submitLogin('admin', 'demoP@ssw0rd'))
  console.log('=== 5) wait_for_ui() ===')
  console.log(await call('wait_for_ui', { timeoutMs: 3000 }))
  await waitForFocus('home')
  await pause('after the success branch (home)')

  // ---- on home: open dialog (transitionsTo logout-confirm-dialog) ----
  console.log('\n=== 3) snapshot(home) ===')
  page = await snapshot()
  const openDialog = findAction(page, (a: any) => a.transitionsTo === 'logout-confirm-dialog')
  if (!openDialog) throw new Error('open-dialog action not found in home page: ' + JSON.stringify(page))
  console.log('=== 4) act(openDialog) ===')
  console.log(await call('act', { actionId: openDialog.id }))
  console.log('=== 5) wait_for_ui() ===')
  console.log(await call('wait_for_ui', { timeoutMs: 3000 }))
  await waitForFocus('logout-confirm-dialog')
  await pause('after opening dialog')

  // ---- dialog focused: confirm -> transitionsTo login ----
  console.log('\n=== 3) snapshot(logout-confirm-dialog, focused) ===')
  page = await snapshot()
  const confirm = findAction(page, (a: any) => a.transitionsTo === 'login')
  if (!confirm) throw new Error('confirm action not found in dialog page: ' + JSON.stringify(page, null, 2))
  console.log('=== 4) act(confirm) ===')
  console.log(await call('act', { actionId: confirm.id }))
  console.log('=== 5) wait_for_ui() ===')
  console.log(await call('wait_for_ui', { timeoutMs: 3000 }))
  await waitForFocus('login')
  await pause('after confirming (back to login)')

  console.log('\n=== final map() — back at login ===')
  console.log(await call('map'))
}

main().catch((e) => { console.error('AGENT ERROR:', e.message); process.exit(1) })

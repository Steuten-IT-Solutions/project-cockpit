<script setup lang="ts">
// Switches web push on or off for this device (PHP: public/assets/push.js). Pushes carry
// no payload; the service worker (public/sw.js) shows a fixed notification and opens /alerts.
const props = defineProps<{ publicKey: string }>()

const supported = ref(false)
const subscribed = ref(false)
const status = ref('')
const busy = ref(false)
let registration: Promise<ServiceWorkerRegistration> | undefined

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '===='.slice(base64url.length % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function sameKey(buffer: ArrayBuffer | null, bytes: Uint8Array): boolean {
  if (buffer === null) return true
  const a = new Uint8Array(buffer)
  return a.length === bytes.length && a.every((v, i) => v === bytes[i])
}

/** Tells the server; a 4xx means it does not accept this subscription. */
async function tell(path: string, endpoint: string): Promise<void> {
  await cockpitPost(path, { endpoint })
}

onMounted(async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return
  }
  supported.value = true
  registration = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready)
  try {
    const sub = await (await registration).pushManager.getSubscription()
    // Made with an older VAPID key: no longer deliverable, switch it off so it can be renewed.
    if (sub && !sameKey(sub.options.applicationServerKey, keyBytes(props.publicKey))) {
      await sub.unsubscribe()
      status.value = 'Der Schlüssel des Cockpits hat sich geändert. Bitte Push neu einschalten.'
      return
    }
    subscribed.value = sub !== null
    status.value = sub ? 'Dieses Gerät bekommt Push-Nachrichten.' : ''
    // Tell the server again: it may have dropped the subscription (e.g. gone at the push service).
    if (sub) {
      tell('/api/push/subscribe', sub.endpoint).catch(async (e: { statusCode?: number }) => {
        if (e.statusCode !== undefined && e.statusCode >= 400 && e.statusCode < 500) {
          await sub.unsubscribe()
          subscribed.value = false
          status.value = 'Dieses Gerät kann keine Push-Nachrichten des Cockpits bekommen.'
        }
      })
    }
  }
  catch {
    status.value = 'Push ist in diesem Browser nicht verfügbar.'
  }
})

async function enable() {
  busy.value = true
  try {
    if (await Notification.requestPermission() !== 'granted') {
      throw new Error('Benachrichtigungen sind für diese Seite nicht erlaubt.')
    }
    const reg = await registration!
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(props.publicKey) })
    try {
      await tell('/api/push/subscribe', sub.endpoint)
    }
    catch (e) {
      // Not stored on the server: leave no subscription behind that never gets anything.
      await sub.unsubscribe()
      throw new Error(errorMessage(e), { cause: e })
    }
    subscribed.value = true
    status.value = 'Dieses Gerät bekommt Push-Nachrichten.'
  }
  catch (e) {
    subscribed.value = false
    status.value = `Nicht eingeschaltet: ${(e as Error).message}`
  }
  finally {
    busy.value = false
  }
}

async function disable() {
  busy.value = true
  try {
    const sub = await (await registration!).pushManager.getSubscription()
    if (sub) {
      const endpoint = sub.endpoint
      await sub.unsubscribe()
      await tell('/api/push/unsubscribe', endpoint)
    }
    subscribed.value = false
    status.value = 'Push auf diesem Gerät ausgeschaltet.'
  }
  catch (e) {
    status.value = `Fehler: ${(e as Error).message}`
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="supported" class="mt-2 space-y-1">
    <UButton v-if="!subscribed" size="sm" color="neutral" variant="outline" :loading="busy" @click="enable">
      Push auf diesem Gerät einschalten
    </UButton>
    <UButton v-else size="sm" color="neutral" variant="outline" :loading="busy" @click="disable">
      Push auf diesem Gerät ausschalten
    </UButton>
    <p v-if="status" class="text-xs text-muted">
      {{ status }}
    </p>
  </div>
</template>

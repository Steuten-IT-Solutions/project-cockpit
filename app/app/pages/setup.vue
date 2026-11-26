<script setup lang="ts">
// The first account of a fresh installation (PHP: templates/setup*.php). Reachable only with
// the setup token from the settings and while no account exists; otherwise "not found".
definePageMeta({ layout: false })
useHead({ title: 'Einrichtung · Cockpit' })

const route = useRoute()
const token = computed(() => String(route.query.token ?? ''))
const { error: unavailable } = await useFetch('/api/setup', { query: { token } })
if (unavailable.value) {
  throw createError({ statusCode: 404, statusMessage: 'Diese Seite gibt es nicht.', fatal: true })
}

const step = ref<'account' | 'totp' | 'done'>('account')
const username = ref('')
const password = ref('')
const passwordConfirm = ref('')
const code = ref('')
const qr = ref('')
const secret = ref('')
const codes = ref<string[]>([])
const error = ref<string | null>(null)
const busy = ref(false)

async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = null
  try {
    await action()
  }
  catch (e) {
    error.value = errorMessage(e)
  }
  finally {
    busy.value = false
  }
}

const start = () => run(async () => {
  const result = await cockpitPost<{ qr: string, secret: string }>('/api/setup/start', {
    token: token.value, username: username.value, password: password.value, passwordConfirm: passwordConfirm.value,
  })
  qr.value = result.qr
  secret.value = result.secret
  password.value = ''
  passwordConfirm.value = ''
  step.value = 'totp'
})

const confirm = () => run(async () => {
  const result = await cockpitPost<{ codes: string[] }>('/api/setup/confirm', { token: token.value, code: code.value })
  codes.value = result.codes
  step.value = 'done'
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-default px-4 py-8">
    <UCard class="w-full max-w-md">
      <template v-if="step === 'account'">
        <h1 class="mb-2 text-lg font-semibold text-highlighted">
          Einrichtung
        </h1>
        <p class="mb-4 text-sm">
          Lege dein Konto an. Danach richtest du den zweiten Faktor ein. Diese Seite ist nur erreichbar, solange noch kein Konto existiert.
        </p>
        <form class="space-y-4" @submit.prevent="start">
          <UAlert v-if="error" color="error" variant="subtle" :title="error" />
          <UFormField label="Benutzername" name="username">
            <UInput v-model="username" autocomplete="username" autocapitalize="none" :spellcheck="false" required :minlength="3" :maxlength="64" class="w-full" />
          </UFormField>
          <UFormField label="Passwort (mindestens 12 Zeichen)" name="password">
            <UInput v-model="password" type="password" autocomplete="new-password" required :minlength="12" class="w-full" />
          </UFormField>
          <UFormField label="Passwort wiederholen" name="passwordConfirm">
            <UInput v-model="passwordConfirm" type="password" autocomplete="new-password" required :minlength="12" class="w-full" />
          </UFormField>
          <UButton type="submit" block :loading="busy">
            Weiter
          </UButton>
        </form>
      </template>

      <template v-else-if="step === 'totp'">
        <h1 class="mb-2 text-lg font-semibold text-highlighted">
          Zwei-Faktor einrichten
        </h1>
        <ol class="mb-4 list-decimal space-y-1 pl-5 text-sm">
          <li>Öffne deine Authenticator-App und füge ein neues Konto hinzu.</li>
          <li>Scanne den QR-Code – oder tippe auf dem Handy den Schlüssel unten ab.</li>
          <li>Gib den angezeigten 6-stelligen Code ein.</li>
        </ol>
        <img :src="qr" alt="QR-Code für die Authenticator-App" width="220" height="220" class="mx-auto mb-3 rounded bg-white">
        <p class="text-sm text-muted">
          Schlüssel zum Abtippen:
        </p>
        <p class="mb-4 break-all font-mono text-sm">
          {{ secret }}
        </p>
        <form class="space-y-4" @submit.prevent="confirm">
          <UAlert v-if="error" color="error" variant="subtle" :title="error" />
          <UFormField label="Code aus der App" name="code">
            <UInput v-model="code" inputmode="numeric" pattern="\d{3}\s?\d{3}" autocomplete="one-time-code" required class="w-full" />
          </UFormField>
          <UButton type="submit" block :loading="busy">
            Bestätigen
          </UButton>
        </form>
      </template>

      <template v-else>
        <h1 class="mb-2 text-lg font-semibold text-highlighted">
          Einrichtung abgeschlossen
        </h1>
        <p class="mb-3 text-sm">
          <strong>Speichere diese Wiederherstellungscodes jetzt</strong> – zum Beispiel im Passwort-Manager.
          Jeder Code funktioniert genau einmal, falls du keinen Zugriff auf die Authenticator-App hast.
          Sie werden nur dieses eine Mal angezeigt.
        </p>
        <ul class="mb-4 grid grid-cols-2 gap-1 font-mono text-sm">
          <li v-for="c in codes" :key="c">
            {{ c }}
          </li>
        </ul>
        <p class="mb-4 text-sm">
          Entferne danach den Wert <code>NUXT_SETUP_TOKEN</code> aus der Einstellungsdatei des Servers.
        </p>
        <UButton to="/login" block>
          Zur Anmeldung
        </UButton>
      </template>
    </UCard>
  </div>
</template>

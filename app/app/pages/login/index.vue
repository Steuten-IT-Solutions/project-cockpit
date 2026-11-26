<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: 'Anmelden · Cockpit' })

const session = useCockpitSession()
const username = ref('')
const password = ref('')
const error = ref<string | null>(null)
// e.g. "Die Anmeldung ist abgelaufen …" from the second step
const flash = ref(session.value?.flash ?? null)
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = null
  flash.value = null
  try {
    const result = await cockpitPost<{ next: string }>('/api/login', { username: username.value, password: password.value })
    await refreshCockpitSession()
    await navigateTo(result.next)
  }
  catch (e) {
    error.value = errorMessage(e)
    password.value = ''
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-default px-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-lg font-semibold text-highlighted">
          Anmelden
        </h1>
      </template>
      <form class="space-y-4" @submit.prevent="submit">
        <UAlert v-if="flash" color="warning" variant="subtle" :title="flash" />
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <UFormField label="Benutzername" name="username">
          <UInput v-model="username" autocomplete="username" autofocus required class="w-full" />
        </UFormField>
        <UFormField label="Passwort" name="password">
          <UInput v-model="password" type="password" autocomplete="current-password" required class="w-full" />
        </UFormField>
        <UButton type="submit" block :loading="busy">
          Weiter
        </UButton>
      </form>
    </UCard>
  </div>
</template>

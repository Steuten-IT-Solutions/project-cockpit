<script setup lang="ts">
definePageMeta({ layout: false })
useHead({ title: 'Bestätigungscode · Cockpit' })

const code = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = null
  try {
    const result = await cockpitPost<{ next: string }>('/api/login/code', { code: code.value })
    await refreshCockpitSession()
    await navigateTo(result.next)
  }
  catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 409) {
      // The pending login expired: back to the first step, which shows the message.
      await refreshCockpitSession()
      await navigateTo('/login')
      return
    }
    error.value = errorMessage(e)
    code.value = ''
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
          Bestätigungscode
        </h1>
      </template>
      <form class="space-y-4" @submit.prevent="submit">
        <p class="text-sm text-muted">
          Gib den sechsstelligen Code aus deiner Authenticator-App ein oder einen Wiederherstellungscode.
        </p>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <UFormField label="Code" name="code">
          <UInput v-model="code" autocomplete="one-time-code" inputmode="text" autofocus required class="w-full" />
        </UFormField>
        <UButton type="submit" block :loading="busy">
          Anmelden
        </UButton>
        <UButton to="/login" variant="link" color="neutral" block>
          Zurück
        </UButton>
      </form>
    </UCard>
  </div>
</template>

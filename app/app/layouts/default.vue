<script setup lang="ts">
// Frame of every page: a header with the user and the logout button, then the page.
const session = useCockpitSession()
const busy = ref(false)

async function logout() {
  busy.value = true
  try {
    await cockpitPost('/api/logout')
    await refreshCockpitSession()
    await navigateTo('/login')
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-default">
    <header class="border-b border-default">
      <div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <NuxtLink to="/" class="font-semibold text-highlighted">
          Cockpit
        </NuxtLink>
        <div v-if="session?.user" class="flex items-center gap-3">
          <span class="text-sm text-muted">{{ session.user.username }}</span>
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-log-out"
            :loading="busy"
            @click="logout"
          >
            Abmelden
          </UButton>
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
// Frame of every page: a header with the user and the logout button, then the page.
const session = useCockpitSession()
const busy = ref(false)
const LINKS = [
  { to: '/', label: 'Projekte' },
  { to: '/alerts', label: 'Warnungen' },
  { to: '/costs', label: 'Kosten' },
]

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
      <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <NuxtLink to="/" class="font-semibold text-highlighted">
          Cockpit
        </NuxtLink>
        <nav v-if="session?.user" class="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Hauptnavigation">
          <NuxtLink v-for="link in LINKS" :key="link.to" :to="link.to" class="text-sm text-muted hover:text-highlighted" active-class="text-highlighted font-medium">
            {{ link.label }}
          </NuxtLink>
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
        </nav>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-6">
      <slot />
    </main>
  </div>
</template>

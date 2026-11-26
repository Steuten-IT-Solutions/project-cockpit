<script setup lang="ts">
useHead({ title: 'Übersicht · Cockpit' })

const session = useCockpitSession()
// Shown once, e.g. after logging in with a recovery code.
const flash = ref(session.value?.flash ?? null)
if (session.value !== null) {
  session.value.flash = null
}
</script>

<template>
  <div class="space-y-4">
    <UAlert v-if="flash" color="warning" variant="subtle" :title="flash" />
    <h1 class="text-2xl font-semibold text-highlighted">
      Hallo {{ session?.user?.username }}
    </h1>
    <p class="text-muted">
      Das neue Cockpit entsteht gerade. Die Seiten des bisherigen Cockpits ziehen Schritt für Schritt hierher um.
    </p>
  </div>
</template>

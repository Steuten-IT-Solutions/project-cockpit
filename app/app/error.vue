<script setup lang="ts">
import type { NuxtError } from '#app'

// Shown for unknown pages and failed page loads, in German like the rest.
const props = defineProps<{ error: NuxtError }>()
const notFound = computed(() => props.error.statusCode === 404)
useHead({ title: computed(() => `${notFound.value ? 'Nicht gefunden' : 'Fehler'} · Cockpit`) })
</script>

<template>
  <UApp>
    <main class="mx-auto max-w-xl space-y-4 px-4 py-16">
      <h1 class="text-2xl font-semibold text-highlighted">
        {{ notFound ? 'Nicht gefunden' : 'Etwas ist schiefgelaufen' }}
      </h1>
      <p class="text-muted">
        {{ notFound ? 'Diese Seite gibt es nicht.' : 'Bitte lade die Seite neu und versuche es noch einmal.' }}
      </p>
      <UButton color="neutral" variant="outline" @click="clearError({ redirect: '/' })">
        Zur Übersicht
      </UButton>
    </main>
  </UApp>
</template>

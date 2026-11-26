<script setup lang="ts">
import type { Tone } from '#shared/lib/projects'

// A small coloured label, optionally a link that opens in a new tab (e.g. to a CI run).
const props = defineProps<{ label: string, tone: Tone, href?: string | null }>()

const color = computed(() => ({ ok: 'success', fail: 'error', warn: 'warning', neutral: 'neutral', live: 'info' } as const)[props.tone])
</script>

<template>
  <a v-if="href" :href="href" target="_blank" rel="noopener noreferrer" class="inline-flex">
    <UBadge :color="color" variant="subtle" :label="label" />
  </a>
  <UBadge v-else :color="color" variant="subtle" :label="label" />
</template>

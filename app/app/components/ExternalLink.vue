<script setup lang="ts">
// A link to another site: new tab, no referrer, no access to this page.
defineProps<{ href: string }>()
</script>

<template>
  <a :href="href" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline"><slot /></a>
</template>

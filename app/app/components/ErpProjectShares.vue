<script setup lang="ts">
import { equalShares, parsePercent, percentText, type ShareForm } from '#shared/lib/erp'
import type { Choice } from '#shared/types/erp'

// The projects an incoming invoice belongs to. One project takes the whole amount; for
// several, each gets a share in percent, and the shares must add up to 100 %. The
// evaluation then counts each project's share of the net amount as its expenses.
const rows = defineModel<ShareForm[]>({ required: true })
const props = defineProps<{ projects: Choice[], disabled?: boolean }>()

const NONE = 'none'
const items = computed(() => [{ value: NONE, label: '– kein Projekt –' }, ...props.projects.map(p => ({ value: String(p.id), label: p.name }))])
const split = computed(() => rows.value.length > 1)
const sum = computed(() => rows.value.reduce((a, r) => a + (parsePercent(r.share) ?? 0), 0))

function spread() {
  equalShares(rows.value.length).forEach((bp, i) => { rows.value[i]!.share = percentText(bp) })
}
function add() {
  rows.value.push({ projectId: NONE, share: '' })
  spread()
}
function remove(i: number) {
  rows.value.splice(i, 1)
  if (rows.value.length === 1) rows.value[0]!.share = ''
  else spread()
}
</script>

<template>
  <div class="space-y-2">
    <div v-for="(row, i) in rows" :key="i" class="flex items-center gap-2">
      <USelect v-model="row.projectId" :items="items" class="min-w-0 flex-1" :disabled="disabled" :aria-label="`Projekt ${i + 1}`" />
      <template v-if="split">
        <UInput v-model="row.share" inputmode="decimal" class="w-24" :disabled="disabled" :aria-label="`Anteil Projekt ${i + 1} in Prozent`">
          <template #trailing>
            <span class="text-xs text-muted">%</span>
          </template>
        </UInput>
        <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :disabled="disabled" aria-label="Projekt entfernen" @click="remove(i)" />
      </template>
    </div>
    <div v-if="!disabled" class="flex flex-wrap items-center gap-2">
      <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-plus" @click="add">
        Weiteres Projekt
      </UButton>
      <UButton v-if="split" size="xs" color="neutral" variant="ghost" @click="spread">
        Gleichmäßig aufteilen
      </UButton>
      <span v-if="split" class="text-xs" :class="sum === 10000 ? 'text-muted' : 'text-warning'">
        Summe {{ percentText(sum) || '0' }} %{{ sum === 10000 ? '' : ' (muss 100 % sein)' }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { day, euro, INVOICE_STATES, REMINDER_LEVELS } from '#shared/lib/erp'
import type { InvoiceSummary } from '#shared/types/erp'

// All invoices with filters; the open items (offene Posten) are the filter "Offen".
useHead({ title: 'Rechnungen · Cockpit' })
const { data } = await useFetch<{ invoices: InvoiceSummary[], today: string }>('/api/erp/invoices')

const FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'unpaid', label: 'Offen' },
  { value: 'overdue', label: 'Überfällig' },
  { value: 'draft', label: 'Entwürfe' },
  { value: 'paid', label: 'Bezahlt' },
]
// Filter and search live in the address (?filter=unpaid&q=…), so going back from an invoice
// shows the list as it was; the overview links here with ?filter=… too.
const state = useListState({ filter: 'all', q: '' }, { filter: FILTERS.map(f => f.value) })
const { last, rowId, open: remember } = useLastOpened('invoices')
const list = computed(() => (data.value?.invoices ?? []).filter((i) => {
  if (state.filter === 'unpaid' && i.state !== 'open' && i.state !== 'overdue') return false
  if (state.filter !== 'all' && state.filter !== 'unpaid' && i.state !== state.filter) return false
  const q = state.q.trim().toLowerCase()
  return q === '' || `${i.number ?? ''} ${i.customerName}`.toLowerCase().includes(q)
}))
const open = computed(() => (data.value?.invoices ?? []).filter(i => i.state === 'open' || i.state === 'overdue'))
const openSum = computed(() => open.value.reduce((s, i) => s + i.grossCents - i.paidCents, 0))
const overdueSum = computed(() => open.value.filter(i => i.state === 'overdue').reduce((s, i) => s + i.grossCents - i.paidCents, 0))
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold text-highlighted">
        Rechnungen
      </h1>
      <UButton to="/erp/invoice?id=new" icon="i-lucide-plus">
        Neue Rechnung
      </UButton>
    </div>
    <p class="text-sm text-muted">
      Offen <strong class="text-highlighted">{{ euro(openSum) }}</strong> · davon überfällig <strong :class="overdueSum > 0 ? 'text-error' : 'text-highlighted'">{{ euro(overdueSum) }}</strong>
    </p>
    <div class="flex flex-wrap gap-2">
      <UButton v-for="f in FILTERS" :key="f.value" size="sm" :color="state.filter === f.value ? 'primary' : 'neutral'" :variant="state.filter === f.value ? 'solid' : 'outline'" @click="state.filter = f.value">
        {{ f.label }}
      </UButton>
      <UInput v-model="state.q" size="sm" icon="i-lucide-search" placeholder="Nummer oder Kunde" class="w-56" aria-label="Suchen" />
    </div>
    <UCard>
      <p v-if="list.length === 0" class="text-sm text-muted">
        Keine Rechnungen.
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="i in list" :id="rowId(i.id)" :key="i.id">
          <NuxtLink
            :to="`/erp/invoice?id=${i.id}`" class="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-elevated/50"
            :class="last === i.id ? 'bg-primary/10 ring-1 ring-primary/40 rounded-md px-2 -mx-2' : ''" @click="remember(i.id)"
          >
            <div class="text-sm">
              <strong>{{ i.number ?? 'Entwurf' }}</strong>
              <span class="ml-2">{{ i.customerName }}</span>
              <p class="text-xs text-muted">
                {{ i.issueDate ? `vom ${day(i.issueDate)}` : `Leistung ${day(i.deliveryDate)}` }}<span v-if="i.dueDate && i.type === '380' && i.state !== 'paid' && i.state !== 'cancelled'"> · fällig {{ day(i.dueDate) }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <UBadge v-if="i.reminderLevel > 0" color="warning" variant="subtle" :label="REMINDER_LEVELS[i.reminderLevel]" />
              <UBadge :color="INVOICE_STATES[i.state]!.tone" variant="subtle" :label="INVOICE_STATES[i.state]!.label" />
              <strong class="w-28 text-right">{{ euro(i.grossCents) }}</strong>
            </div>
          </NuxtLink>
        </li>
      </ul>
    </UCard>
  </div>
</template>

<script setup lang="ts">
import { day, euro, ORDER_STATES, QUOTE_STATES } from '#shared/lib/erp'
import type { SalesDocument } from '#shared/types/erp'

// Quotes and order confirmations.
useHead({ title: 'Angebote & Aufträge · Cockpit' })
const { data } = await useFetch<{ documents: Omit<SalesDocument, 'lines'>[], today: string }>('/api/erp/sales')
// The chosen tab lives in the address (?kind=order), so going back from a document keeps it.
const state = useListState({ kind: 'quote' }, { kind: ['quote', 'order'] })
const { last, rowId, open: remember } = useLastOpened('sales')
const list = computed(() => (data.value?.documents ?? []).filter(d => d.kind === state.kind))
const COLORS: Record<string, 'neutral' | 'info' | 'success' | 'error'> = { draft: 'neutral', sent: 'info', accepted: 'success', rejected: 'error', invoiced: 'success' }
const label = (d: Omit<SalesDocument, 'lines'>) => (d.kind === 'quote' ? QUOTE_STATES : ORDER_STATES)[d.status] ?? d.status
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold text-highlighted">
        Angebote & Aufträge
      </h1>
      <div class="flex gap-2">
        <UButton to="/erp/sales-document?id=new&kind=quote" icon="i-lucide-plus">
          Neues Angebot
        </UButton>
        <UButton to="/erp/sales-document?id=new&kind=order" icon="i-lucide-plus" color="neutral" variant="outline">
          Auftragsbestätigung
        </UButton>
      </div>
    </div>
    <div class="flex gap-2">
      <UButton size="sm" :color="state.kind === 'quote' ? 'primary' : 'neutral'" :variant="state.kind === 'quote' ? 'solid' : 'outline'" @click="state.kind = 'quote'">
        Angebote
      </UButton>
      <UButton size="sm" :color="state.kind === 'order' ? 'primary' : 'neutral'" :variant="state.kind === 'order' ? 'solid' : 'outline'" @click="state.kind = 'order'">
        Auftragsbestätigungen
      </UButton>
    </div>
    <UCard>
      <p v-if="list.length === 0" class="text-sm text-muted">
        Noch keine.
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="d in list" :id="rowId(d.id)" :key="d.id">
          <NuxtLink
            :to="`/erp/sales-document?id=${d.id}`" class="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-elevated/50"
            :class="last === d.id ? 'bg-primary/10 ring-1 ring-primary/40 rounded-md px-2 -mx-2' : ''" @click="remember(d.id)"
          >
            <div class="text-sm">
              <strong>{{ d.number ?? 'Entwurf' }}</strong> <span class="ml-1">{{ d.customerName }}</span>
              <p class="text-xs text-muted">
                <template v-if="d.issueDate">
                  vom {{ day(d.issueDate) }}
                </template>
                <span v-if="d.kind === 'quote' && d.validUntil && d.status === 'sent'" :class="d.validUntil < data.today ? 'text-error' : ''"> · gültig bis {{ day(d.validUntil) }}</span>
                <span v-if="d.invoiceNumber"> · Rechnung {{ d.invoiceNumber }}</span>
              </p>
            </div>
            <div class="flex items-center gap-2 text-sm">
              <UBadge :color="COLORS[d.status] ?? 'neutral'" variant="subtle" :label="label(d)" />
              <strong class="w-28 text-right">{{ euro(d.grossCents) }}</strong>
            </div>
          </NuxtLink>
        </li>
      </ul>
    </UCard>
  </div>
</template>

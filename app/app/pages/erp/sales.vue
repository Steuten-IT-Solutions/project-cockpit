<script setup lang="ts">
import { day, euro, ORDER_STATES, QUOTE_STATES } from '#shared/lib/erp'
import type { SalesDocument } from '#shared/types/erp'

// Quotes and order confirmations.
useHead({ title: 'Angebote & Aufträge · Cockpit' })
const { data } = await useFetch<{ documents: Omit<SalesDocument, 'lines'>[], today: string }>('/api/erp/sales')
const kind = ref<'quote' | 'order'>('quote')
const list = computed(() => (data.value?.documents ?? []).filter(d => d.kind === kind.value))
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
      <UButton size="sm" :color="kind === 'quote' ? 'primary' : 'neutral'" :variant="kind === 'quote' ? 'solid' : 'outline'" @click="kind = 'quote'">
        Angebote
      </UButton>
      <UButton size="sm" :color="kind === 'order' ? 'primary' : 'neutral'" :variant="kind === 'order' ? 'solid' : 'outline'" @click="kind = 'order'">
        Auftragsbestätigungen
      </UButton>
    </div>
    <UCard>
      <p v-if="list.length === 0" class="text-sm text-muted">
        Noch keine.
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="d in list" :key="d.id">
          <NuxtLink :to="`/erp/sales-document?id=${d.id}`" class="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-elevated/50">
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

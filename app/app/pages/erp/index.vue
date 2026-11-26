<script setup lang="ts">
import { day, euro, quantity, REMINDER_LEVELS } from '#shared/lib/erp'

// The ERP's start page: what needs attention today.
useHead({ title: 'ERP · Cockpit' })
interface Overview {
  hasSettings: boolean
  drafts: number
  unpaid: { count: number, cents: number }
  overdue: { count: number, cents: number }
  incoming: { count: number, cents: number, dueSoon: number }
  subscriptions: { id: number, name: string, customerName: string, nextDate: string }[]
  time: { count: number, hoursMilli: number }
  overdueList: { id: number, number: string | null, customerName: string, dueDate: string | null, openCents: number, reminderLevel: number }[]
  today: string
}
const { data } = await useFetch<Overview>('/api/erp/overview')
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold text-highlighted">
        ERP
      </h1>
      <div class="flex flex-wrap gap-2">
        <UButton to="/erp/invoice?id=new" icon="i-lucide-plus">
          Rechnung
        </UButton>
        <UButton to="/erp/sales-document?id=new&kind=quote" icon="i-lucide-plus" color="neutral" variant="outline">
          Angebot
        </UButton>
        <UButton to="/erp/time" icon="i-lucide-clock" color="neutral" variant="outline">
          Zeit erfassen
        </UButton>
      </div>
    </div>
    <UAlert v-if="!data.hasSettings" color="warning" variant="subtle" title="Zuerst die Firmendaten eintragen" description="Name, Anschrift, Steuernummer oder USt-IdNr., IBAN und E-Mail-Absender stehen auf jeder Rechnung.">
      <template #actions>
        <UButton to="/erp/settings" size="sm">
          Zu den Einstellungen
        </UButton>
      </template>
    </UAlert>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UCard>
        <p class="text-sm text-muted">
          Offene Rechnungen
        </p>
        <p class="text-2xl font-semibold text-highlighted">
          {{ euro(data.unpaid.cents) }}
        </p>
        <NuxtLink to="/erp/invoices?filter=unpaid" class="text-xs text-muted underline">
          {{ data.unpaid.count }} Rechnungen
        </NuxtLink>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">
          Überfällig
        </p>
        <p class="text-2xl font-semibold" :class="data.overdue.count > 0 ? 'text-error' : 'text-highlighted'">
          {{ euro(data.overdue.cents) }}
        </p>
        <NuxtLink to="/erp/invoices?filter=overdue" class="text-xs text-muted underline">
          {{ data.overdue.count }} Rechnungen
        </NuxtLink>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">
          Eingangsrechnungen offen
        </p>
        <p class="text-2xl font-semibold text-highlighted">
          {{ euro(data.incoming.cents) }}
        </p>
        <NuxtLink to="/erp/incoming" class="text-xs text-muted underline">
          {{ data.incoming.count }} offen<span v-if="data.incoming.dueSoon > 0">, {{ data.incoming.dueSoon }} in 7 Tagen fällig</span>
        </NuxtLink>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">
          Nicht abgerechnet
        </p>
        <p class="text-2xl font-semibold text-highlighted">
          {{ quantity(data.time.hoursMilli) }} Std.
        </p>
        <NuxtLink to="/erp/time" class="text-xs text-muted underline">
          {{ data.time.count }} Einträge
        </NuxtLink>
      </UCard>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Überfällige Rechnungen
          </h2>
        </template>
        <p v-if="data.overdueList.length === 0" class="text-sm text-muted">
          Keine.
        </p>
        <ul v-else class="divide-y divide-default text-sm">
          <li v-for="i in data.overdueList" :key="i.id" class="flex justify-between gap-2 py-1">
            <NuxtLink :to="`/erp/invoice?id=${i.id}`" class="underline">
              {{ i.number }} · {{ i.customerName }}
            </NuxtLink>
            <span>{{ euro(i.openCents) }} · seit {{ day(i.dueDate) }}<span v-if="i.reminderLevel > 0" class="text-muted"> · {{ REMINDER_LEVELS[i.reminderLevel] }}</span></span>
          </li>
        </ul>
        <p v-if="data.drafts > 0" class="mt-3 text-sm">
          <NuxtLink to="/erp/invoices?filter=draft" class="underline">
            {{ data.drafts }} {{ data.drafts === 1 ? 'Rechnungsentwurf wartet' : 'Rechnungsentwürfe warten' }} aufs Festschreiben.
          </NuxtLink>
        </p>
      </UCard>
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Nächste wiederkehrende Rechnungen
          </h2>
        </template>
        <p v-if="data.subscriptions.length === 0" class="text-sm text-muted">
          Keine.
        </p>
        <ul v-else class="divide-y divide-default text-sm">
          <li v-for="s in data.subscriptions" :key="s.id" class="flex justify-between gap-2 py-1">
            <span>{{ s.name }} · {{ s.customerName }}</span><span>{{ day(s.nextDate) }}</span>
          </li>
        </ul>
      </UCard>
    </div>
  </div>
</template>

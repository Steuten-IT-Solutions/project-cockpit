<script setup lang="ts">
import { euro, INCOMING_CATEGORIES } from '#shared/lib/erp'

// Evaluation of a year and the export for the tax adviser.
useHead({ title: 'Auswertung · Cockpit' })
interface Report {
  year: number
  months: { month: number, invoiced: number, received: number, expensesPaid: number, expensesInvoiced: number }[]
  customers: { name: string, net: number }[]
  projects: { name: string, revenue: number, expenses: number }[]
  categories: { category: string, gross: number }[]
  totals: { invoicedNet: number, invoicedTax: number, received: number, expensesPaid: number, expensesInvoiced: number, paymentDifferences: number, openReceivables: number, openPayables: number }
  smallBusiness: { previousYearReceived: number, currentYearReceived: number, limits: { previousYear: number, currentYear: number } }
}
const year = ref<number | null>(null)
const { data } = await useFetch<{ report: Report, currentYear: number }>('/api/erp/report', { query: computed(() => (year.value === null ? {} : { year: year.value })) })
const yearItems = computed(() => {
  const current = data.value?.currentYear ?? new Date().getFullYear()
  return Array.from({ length: 6 }, (_, i) => current - i)
})
const selectedYear = computed({
  get: () => data.value?.report.year ?? data.value?.currentYear ?? new Date().getFullYear(),
  set: (v: number) => { year.value = v },
})
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

const from = ref('')
const to = ref('')
watch(selectedYear, (y) => {
  from.value = `${y}-01-01`
  to.value = `${y}-12-31`
}, { immediate: true })
const exportUrl = computed(() => `/api/erp/export?from=${encodeURIComponent(from.value)}&to=${encodeURIComponent(to.value)}`)
const sb = computed(() => data.value?.report.smallBusiness)
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold text-highlighted">
        Auswertung {{ data.report.year }}
      </h1>
      <USelect v-model="selectedYear" :items="yearItems" class="w-28" aria-label="Jahr" />
    </div>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UCard>
        <p class="text-sm text-muted">
          Umsatz netto (nach Rechnungsdatum)
        </p>
        <p class="text-2xl font-semibold text-highlighted">
          {{ euro(data.report.totals.invoicedNet) }}
        </p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">
          Zahlungseingänge (Zufluss)
        </p>
        <p class="text-2xl font-semibold text-highlighted">
          {{ euro(data.report.totals.received) }}
        </p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">
          Ausgaben bezahlt (Abfluss)
        </p>
        <p class="text-2xl font-semibold text-highlighted">
          {{ euro(data.report.totals.expensesPaid) }}
        </p>
        <p v-if="data.report.totals.paymentDifferences !== 0" class="mt-1 text-xs text-muted">
          davon Abweichungen zur Rechnung (Bankgebühren, Kursdifferenzen) {{ euro(data.report.totals.paymentDifferences) }}
        </p>
      </UCard>
      <UCard>
        <p class="text-sm text-muted">
          Überschuss (Zufluss − Abfluss)
        </p>
        <p class="text-2xl font-semibold text-highlighted">
          {{ euro(data.report.totals.received - data.report.totals.expensesPaid) }}
        </p>
      </UCard>
    </div>
    <p class="text-xs text-muted">
      Zufluss und Abfluss zählen nach dem Tag der Zahlung, wie bei der Einnahmenüberschussrechnung. Erfasst sind nur Zahlungen zu Rechnungen im Cockpit und als bezahlt markierte Eingangsrechnungen; Abschreibungen, Privatanteile und Belege außerhalb des Cockpits fehlen. Es ersetzt keine Buchhaltung.
    </p>

    <UCard v-if="sb">
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Kleinunternehmergrenzen (§ 19 UStG)
        </h2>
      </template>
      <div class="space-y-2 text-sm">
        <p>
          Vorjahr {{ data.report.year - 1 }}: {{ euro(sb.previousYearReceived) }} von höchstens {{ euro(sb.limits.previousYear) }}
          <UBadge v-if="sb.previousYearReceived > sb.limits.previousYear" color="error" variant="subtle" label="überschritten" />
        </p>
        <UProgress :model-value="Math.min(100, (sb.currentYearReceived / sb.limits.currentYear) * 100)" :color="sb.currentYearReceived > sb.limits.currentYear * 0.8 ? 'warning' : 'primary'" />
        <p>
          Jahr {{ data.report.year }}: {{ euro(sb.currentYearReceived) }} von höchstens {{ euro(sb.limits.currentYear) }}
        </p>
        <p class="text-xs text-muted">
          Gezählt werden die vereinnahmten Entgelte (UStAE 19.2). Wer im Vorjahr über 25.000 € lag, ist im laufenden Jahr kein Kleinunternehmer; im laufenden Jahr ist schon der Umsatz steuerpflichtig, mit dem 100.000 € überschritten werden (UStAE 19.1). Umsätze außerhalb des Cockpits zählen mit; im Zweifel bitte die Steuerberatung fragen.
        </p>
      </div>
    </UCard>

    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Nach Monat
          </h2>
        </template>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-muted">
                <th class="py-1 font-normal">
                  Monat
                </th>
                <th class="py-1 text-right font-normal">
                  Umsatz
                </th>
                <th class="py-1 text-right font-normal">
                  Eingang
                </th>
                <th class="py-1 text-right font-normal">
                  Ausgaben
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in data.report.months" :key="m.month" class="border-t border-default">
                <td class="py-1">
                  {{ MONTHS[m.month - 1] }}
                </td>
                <td class="py-1 text-right">
                  {{ euro(m.invoiced) }}
                </td>
                <td class="py-1 text-right">
                  {{ euro(m.received) }}
                </td>
                <td class="py-1 text-right">
                  {{ euro(m.expensesPaid) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
      <div class="space-y-4">
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Umsatz nach Kunde
            </h2>
          </template>
          <p v-if="data.report.customers.length === 0" class="text-sm text-muted">
            Keine Rechnungen.
          </p>
          <ul class="divide-y divide-default text-sm">
            <li v-for="c in data.report.customers" :key="c.name" class="flex justify-between py-1">
              <span>{{ c.name }}</span><span>{{ euro(c.net) }}</span>
            </li>
          </ul>
        </UCard>
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Nach Projekt (netto)
            </h2>
          </template>
          <p v-if="data.report.projects.length === 0" class="text-sm text-muted">
            Nichts.
          </p>
          <ul class="divide-y divide-default text-sm">
            <li v-for="p in data.report.projects" :key="p.name" class="flex justify-between gap-2 py-1">
              <span>{{ p.name }}</span><span>{{ euro(p.revenue) }} Umsatz · {{ euro(p.expenses) }} Ausgaben</span>
            </li>
          </ul>
        </UCard>
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Ausgaben nach Kategorie (brutto, nach Rechnungsdatum)
            </h2>
          </template>
          <p v-if="data.report.categories.length === 0" class="text-sm text-muted">
            Keine Eingangsrechnungen.
          </p>
          <ul class="divide-y divide-default text-sm">
            <li v-for="c in data.report.categories" :key="c.category" class="flex justify-between py-1">
              <span>{{ INCOMING_CATEGORIES[c.category] ?? c.category }}</span><span>{{ euro(c.gross) }}</span>
            </li>
          </ul>
        </UCard>
      </div>
    </div>
    <p class="text-sm text-muted">
      Stand Jahresende: offene Forderungen {{ euro(data.report.totals.openReceivables) }}, offene Verbindlichkeiten {{ euro(data.report.totals.openPayables) }}.
    </p>

    <UCard>
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Export für die Steuerberatung
        </h2>
      </template>
      <p class="mb-3 text-sm text-muted">
        Eine ZIP-Datei mit allen Ausgangsrechnungen (PDF und XML), allen erhaltenen Eingangsrechnungen, Angeboten und Auftragsbestätigungen des Zeitraums, jeweils unverändert, dazu Listen als CSV für Excel.
      </p>
      <div class="flex flex-wrap items-end gap-3">
        <UFormField label="Von">
          <UInput v-model="from" type="date" />
        </UFormField>
        <UFormField label="Bis">
          <UInput v-model="to" type="date" />
        </UFormField>
        <UButton :to="exportUrl" external icon="i-lucide-download">
          ZIP herunterladen
        </UButton>
      </div>
    </UCard>
  </div>
</template>

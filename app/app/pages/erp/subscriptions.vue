<script setup lang="ts">
import { day, euro, type LineForm, lineToForm, period, SUBSCRIPTION_INTERVALS, totals } from '#shared/lib/erp'
import type { CatalogItem, Choice, Subscription } from '#shared/types/erp'

// Recurring invoices: on each date the cockpit writes a draft for the period starting
// then. You check and finalize the draft as usual.
useHead({ title: 'Wiederkehrende Rechnungen · Cockpit' })
interface Page {
  subscriptions: Subscription[]
  customers: (Choice & { projectId: number | null })[]
  projects: Choice[]
  catalog: CatalogItem[]
  smallBusiness: boolean
  today: string
}
const { data, refresh } = await useFetch<Page>('/api/erp/subscriptions')
const { busy, run } = useAction()

const NONE = 'none'
const empty = () => ({ customerId: '', projectId: NONE, name: '', intervalMonths: 1, nextDate: data.value?.today ?? '', endDate: '', note: '', active: true, lines: [] as LineForm[] })
const form = reactive(empty())
const editId = ref<number | null>(null)
const error = ref<string | null>(null)
const customerItems = computed(() => (data.value?.customers ?? []).map(c => ({ value: String(c.id), label: c.name })))
const projectItems = computed(() => [{ value: NONE, label: '– kein Projekt –' }, ...(data.value?.projects ?? []).map(p => ({ value: String(p.id), label: p.name }))])
const intervalItems = Object.entries(SUBSCRIPTION_INTERVALS).map(([value, label]) => ({ value: Number(value), label }))
const nextPeriod = computed(() => (form.nextDate ? period(form.nextDate, form.intervalMonths) : null))

function edit(s: Subscription) {
  Object.assign(form, {
    customerId: String(s.customerId), projectId: s.projectId !== null ? String(s.projectId) : NONE, name: s.name, intervalMonths: s.intervalMonths,
    nextDate: s.nextDate, endDate: s.endDate ?? '', note: s.note ?? '', active: s.active, lines: s.lines.map(lineToForm),
  })
  editId.value = s.id
  error.value = null
  document.getElementById('subscription-form')?.scrollIntoView({ behavior: 'smooth' })
}
function reset() {
  Object.assign(form, empty())
  editId.value = null
  error.value = null
}
async function save() {
  error.value = null
  busy.value = 'save'
  try {
    const body = { ...form, projectId: form.projectId === NONE ? '' : form.projectId }
    const result = editId.value === null
      ? await cockpitSend<{ message: string }>('POST', '/api/erp/subscriptions', body)
      : await cockpitSend<{ message: string }>('PUT', `/api/erp/subscriptions/${editId.value}`, body)
    useNotice().ok(result.message)
    reset()
    await refresh()
  }
  catch (e) {
    error.value = errorMessage(e)
  }
  finally {
    busy.value = null
  }
}
async function bill(s: Subscription) {
  const result = await run(`bill-${s.id}`, () => cockpitPost<{ invoiceId: number, message: string }>(`/api/erp/subscriptions/${s.id}/bill`))
  if (result !== null) await navigateTo(`/erp/invoice?id=${result.invoiceId}`)
}
async function remove(s: Subscription) {
  if (await run(`delete-${s.id}`, () => cockpitSend('DELETE', `/api/erp/subscriptions/${s.id}`)) !== null) {
    if (editId.value === s.id) reset()
    await refresh()
  }
}
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <h1 class="text-2xl font-semibold text-highlighted">
      Wiederkehrende Rechnungen
    </h1>
    <UCard>
      <p v-if="data.subscriptions.length === 0" class="text-sm text-muted">
        Noch keine, z. B. ein monatlicher Wartungsvertrag.
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="s in data.subscriptions" :key="s.id" class="flex flex-wrap items-start justify-between gap-2 py-2">
          <div class="text-sm" :class="s.active ? '' : 'opacity-60'">
            <strong>{{ s.name }}</strong> · {{ s.customerName }}
            <p class="text-xs text-muted">
              {{ SUBSCRIPTION_INTERVALS[s.intervalMonths] }} {{ euro(totals(s.lines).gross) }}
              · <template v-if="s.active">
                nächste Rechnung {{ day(s.nextDate) }}
              </template><template v-else>
                pausiert oder beendet
              </template><span v-if="s.endDate"> · bis {{ day(s.endDate) }}</span>
            </p>
          </div>
          <div class="flex gap-2">
            <UButton size="xs" color="neutral" variant="outline" :disabled="!s.active" :loading="busy === `bill-${s.id}`" @click="bill(s)">
              Jetzt abrechnen
            </UButton>
            <UButton size="xs" color="neutral" variant="outline" @click="edit(s)">
              Bearbeiten
            </UButton>
            <UButton size="xs" color="neutral" variant="ghost" :loading="busy === `delete-${s.id}`" @click="remove(s)">
              Löschen
            </UButton>
          </div>
        </li>
      </ul>
    </UCard>

    <UCard id="subscription-form">
      <template #header>
        <h2 class="font-semibold text-highlighted">
          {{ editId !== null ? 'Bearbeiten' : 'Neu anlegen' }}
        </h2>
      </template>
      <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" role="alert" />
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid gap-3 md:grid-cols-3">
          <UFormField label="Name" required>
            <UInput v-model="form.name" :maxlength="100" placeholder="Wartungsvertrag" class="w-full" />
          </UFormField>
          <UFormField label="Kunde" required>
            <USelect v-model="form.customerId" :items="customerItems" placeholder="Kunde wählen" class="w-full" />
          </UFormField>
          <UFormField label="Projekt" hint="optional">
            <USelect v-model="form.projectId" :items="projectItems" class="w-full" />
          </UFormField>
          <UFormField label="Intervall">
            <USelect v-model="form.intervalMonths" :items="intervalItems" class="w-full" />
          </UFormField>
          <UFormField label="Nächste Rechnung am" required :help="nextPeriod ? `Zeitraum ${day(nextPeriod.from)} – ${day(nextPeriod.to)}` : undefined">
            <UInput v-model="form.nextDate" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Endet am" hint="optional">
            <UInput v-model="form.endDate" type="date" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Hinweis auf jeder Rechnung" hint="optional; der Leistungszeitraum steht automatisch darauf">
          <UTextarea v-model="form.note" :rows="2" :maxlength="2000" autoresize class="w-full" />
        </UFormField>
        <USwitch v-model="form.active" label="Aktiv" />
        <h3 class="font-medium text-highlighted">
          Positionen
        </h3>
        <ErpLines v-model="form.lines" :catalog="data.catalog" :small-business="data.smallBusiness" />
        <div class="flex gap-2">
          <UButton type="submit" :loading="busy === 'save'">
            {{ editId !== null ? 'Speichern' : 'Anlegen' }}
          </UButton>
          <UButton v-if="editId !== null" color="neutral" variant="ghost" @click="reset">
            Abbrechen
          </UButton>
        </div>
      </form>
    </UCard>
  </div>
</template>

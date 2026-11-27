<script setup lang="ts">
import { day, euro, lineNet, priceText, quantity, UNITS } from '#shared/lib/erp'
import type { CatalogItem, Choice, TimeEntry } from '#shared/types/erp'

// Time and services to bill later. Tick the open entries of one customer and turn them
// into a draft invoice.
useHead({ title: 'Zeiten · Cockpit' })
interface Page {
  entries: TimeEntry[]
  orders: (Choice & { customerId: number })[]
  customers: (Choice & { projectId: number | null })[]
  projects: Choice[]
  catalog: CatalogItem[]
  smallBusiness: boolean
  today: string
}
const { data, refresh } = await useFetch<Page>('/api/erp/time')
const { busy, run } = useAction()

const NONE = 'none'
const empty = () => ({ workDate: data.value?.today ?? '', customerId: '', projectId: NONE, orderId: NONE, description: '', quantity: '1', unit: 'HUR', price: '', vatRate: data.value?.smallBusiness === false ? 19 : 0 })
const form = reactive(empty())
/** After saving, the next entry keeps date, customer, project and price: usually the same day's work. */
function next() {
  Object.assign(form, { ...empty(), workDate: form.workDate, customerId: form.customerId, projectId: form.projectId, price: form.price })
  editId.value = null
}
const editId = ref<number | null>(null)
const error = ref<string | null>(null)

const customerItems = computed(() => (data.value?.customers ?? []).map(c => ({ value: String(c.id), label: c.name })))
const projectItems = computed(() => [{ value: NONE, label: '– kein Projekt –' }, ...(data.value?.projects ?? []).map(p => ({ value: String(p.id), label: p.name }))])
const orderItems = computed(() => [{ value: NONE, label: '– kein Auftrag –' }, ...(data.value?.orders ?? []).filter(o => String(o.customerId) === form.customerId).map(o => ({ value: String(o.id), label: o.name }))])
const unitItems = Object.entries(UNITS).map(([value, label]) => ({ value, label }))
const catalogItems = computed(() => (data.value?.catalog ?? []).map(c => ({ value: c.id, label: `${c.name} · ${euro(c.unitPriceCents)}` })))
const pick = ref<number | undefined>(undefined)
watch(pick, (id) => {
  const item = data.value?.catalog.find(c => c.id === id)
  if (item) {
    Object.assign(form, { unit: item.unit, price: priceText(item.unitPriceCents), vatRate: data.value?.smallBusiness ? 0 : item.vatRate })
    if (form.description === '') form.description = item.name
    pick.value = undefined
  }
})
watch(() => form.customerId, (value) => {
  const customer = data.value?.customers.find(c => String(c.id) === value)
  if (customer?.projectId != null && form.projectId === NONE) form.projectId = String(customer.projectId)
})

function payload() {
  return { ...form, projectId: form.projectId === NONE ? '' : form.projectId, orderId: form.orderId === NONE ? '' : form.orderId }
}
async function save() {
  error.value = null
  busy.value = 'save'
  try {
    const result = editId.value === null
      ? await cockpitSend<{ message: string }>('POST', '/api/erp/time', payload())
      : await cockpitSend<{ message: string }>('PUT', `/api/erp/time/${editId.value}`, payload())
    useNotice().ok(result.message)
    next()
    await refresh()
  }
  catch (e) {
    error.value = errorMessage(e)
  }
  finally {
    busy.value = null
  }
}
function edit(e: TimeEntry) {
  Object.assign(form, {
    workDate: e.workDate, customerId: String(e.customerId), projectId: e.projectId !== null ? String(e.projectId) : NONE,
    orderId: e.orderId !== null ? String(e.orderId) : NONE, description: e.description, quantity: quantity(e.quantityMilli),
    unit: e.unit, price: priceText(e.unitPriceCents), vatRate: e.vatRate,
  })
  editId.value = e.id
  document.getElementById('time-form')?.scrollIntoView({ behavior: 'smooth' })
}
async function remove(e: TimeEntry) {
  if (await run(`delete-${e.id}`, () => cockpitSend('DELETE', `/api/erp/time/${e.id}`)) !== null) await refresh()
}

const open = computed(() => (data.value?.entries ?? []).filter(e => e.invoiceId === null))
const billed = computed(() => (data.value?.entries ?? []).filter(e => e.invoiceId !== null))
const selected = ref<number[]>([])
const selectedEntries = computed(() => open.value.filter(e => selected.value.includes(e.id)))
const selectedSum = computed(() => selectedEntries.value.reduce((s, e) => s + lineNet(e), 0))
function toggle(id: number, on: boolean) {
  selected.value = on ? [...selected.value, id] : selected.value.filter(v => v !== id)
}
async function bill() {
  const result = await run('bill', () => cockpitPost<{ invoiceId: number, message: string }>('/api/erp/time/bill', { ids: selected.value }))
  if (result !== null) await navigateTo(`/erp/invoice?id=${result.invoiceId}`)
}
const hours = (list: TimeEntry[]) => quantity(list.filter(e => e.unit === 'HUR').reduce((s, e) => s + e.quantityMilli, 0))
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <h1 class="text-2xl font-semibold text-highlighted">
      Zeiten und Leistungen
    </h1>
    <UCard id="time-form">
      <template #header>
        <h2 class="font-semibold text-highlighted">
          {{ editId !== null ? 'Eintrag bearbeiten' : 'Erfassen' }}
        </h2>
      </template>
      <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" role="alert" />
      <form class="space-y-3" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UFormField label="Datum" required>
            <UInput v-model="form.workDate" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Kunde" required>
            <USelect v-model="form.customerId" :items="customerItems" placeholder="Kunde wählen" class="w-full" />
          </UFormField>
          <UFormField label="Projekt">
            <USelect v-model="form.projectId" :items="projectItems" class="w-full" />
          </UFormField>
          <UFormField label="Auftrag">
            <USelect v-model="form.orderId" :items="orderItems" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Was hast du gemacht?" required help="Die erste Zeile wird zur Bezeichnung der Rechnungsposition.">
          <UTextarea v-model="form.description" :rows="2" :maxlength="500" autoresize class="w-full" />
        </UFormField>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <UFormField label="Menge">
            <UInput v-model="form.quantity" inputmode="decimal" class="w-full" />
          </UFormField>
          <UFormField label="Einheit">
            <USelect v-model="form.unit" :items="unitItems" class="w-full" />
          </UFormField>
          <UFormField label="Preis (€)">
            <UInput v-model="form.price" inputmode="decimal" placeholder="90,00" class="w-full" />
          </UFormField>
          <UFormField v-if="!data.smallBusiness" label="USt. (%)">
            <UInput v-model.number="form.vatRate" type="number" class="w-full" />
          </UFormField>
          <UFormField v-if="catalogItems.length > 0" label="Artikel übernehmen">
            <USelect v-model="pick" :items="catalogItems" placeholder="…" class="w-full" />
          </UFormField>
        </div>
        <div class="flex gap-2">
          <UButton type="submit" :loading="busy === 'save'">
            {{ editId !== null ? 'Speichern' : 'Erfassen' }}
          </UButton>
          <UButton v-if="editId !== null" color="neutral" variant="ghost" @click="next">
            Abbrechen
          </UButton>
        </div>
      </form>
    </UCard>

    <UCard>
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold text-highlighted">
            Offen ({{ hours(open) }} Std.)
          </h2>
          <UButton :disabled="selected.length === 0" icon="i-lucide-receipt" :loading="busy === 'bill'" @click="bill">
            {{ selected.length === 0 ? 'Auswählen und abrechnen' : `${selected.length} abrechnen (${euro(selectedSum)} netto)` }}
          </UButton>
        </div>
      </template>
      <p v-if="open.length === 0" class="text-sm text-muted">
        Nichts offen.
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="e in open" :key="e.id" class="flex flex-wrap items-start gap-3 py-2">
          <UCheckbox :model-value="selected.includes(e.id)" :aria-label="`${e.description} auswählen`" @update:model-value="toggle(e.id, $event === true)" />
          <div class="min-w-0 flex-1 text-sm">
            <strong>{{ day(e.workDate) }}</strong> · {{ e.customerName }}<span v-if="e.orderNumber" class="text-muted"> · {{ e.orderNumber }}</span>
            <p class="whitespace-pre-line">
              {{ e.description }}
            </p>
            <p class="text-xs text-muted">
              {{ quantity(e.quantityMilli) }} {{ UNITS[e.unit] }} × {{ euro(e.unitPriceCents) }} = {{ euro(lineNet(e)) }}
            </p>
          </div>
          <div class="flex gap-2">
            <UButton size="xs" color="neutral" variant="outline" @click="edit(e)">
              Bearbeiten
            </UButton>
            <UButton size="xs" color="neutral" variant="ghost" :loading="busy === `delete-${e.id}`" @click="remove(e)">
              Löschen
            </UButton>
          </div>
        </li>
      </ul>
    </UCard>

    <UCard v-if="billed.length > 0">
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Abgerechnet (letzte 12 Monate)
        </h2>
      </template>
      <ul class="divide-y divide-default text-sm">
        <li v-for="e in billed" :key="e.id" class="flex flex-wrap justify-between gap-2 py-1">
          <span>{{ day(e.workDate) }} · {{ e.customerName }} · {{ e.description.split('\n')[0] }}</span>
          <NuxtLink :to="`/erp/invoice?id=${e.invoiceId}`" class="text-muted underline">
            {{ e.invoiceNumber ?? 'Entwurf' }}
          </NuxtLink>
        </li>
      </ul>
    </UCard>
  </div>
</template>

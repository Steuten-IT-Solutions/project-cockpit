<script setup lang="ts">
import { day, euro, INCOMING_CATEGORIES } from '#shared/lib/erp'
import type { Choice, IncomingInvoice, Supplier } from '#shared/types/erp'

// Incoming invoices: upload, open ones to pay, all received.
useHead({ title: 'Eingangsrechnungen · Cockpit' })
const { data, refresh } = await useFetch<{ invoices: IncomingInvoice[], suppliers: Supplier[], projects: Choice[], today: string }>('/api/erp/incoming')
const { busy } = useAction()

const NONE = 'none'
const NEW = 'new'
const categoryItems = Object.entries(INCOMING_CATEGORIES).map(([value, label]) => ({ value, label }))
const projectItems = computed(() => [{ value: NONE, label: '– kein Projekt –' }, ...(data.value?.projects ?? []).map(p => ({ value: String(p.id), label: p.name }))])
const supplierItems = computed(() => [{ value: NEW, label: '+ neuer Lieferant' }, ...(data.value?.suppliers ?? []).map(s => ({ value: String(s.id), label: s.name }))])

const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const showManual = ref(false)
const form = reactive({ category: 'other', projectId: NONE, supplierId: NEW, supplierName: '', number: '', issueDate: '', dueDate: '', net: '', tax: '0', iban: '', note: '' })
const error = ref<string | null>(null)
const warnings = ref<string[]>([])

function pickFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  error.value = null
}

async function upload() {
  if (file.value === null) {
    error.value = 'Bitte eine Datei wählen.'
    return
  }
  error.value = null
  warnings.value = []
  busy.value = 'upload'
  const body = new FormData()
  body.append('file', file.value)
  for (const [key, value] of Object.entries(form)) {
    if (key === 'projectId' || key === 'supplierId') body.append(key, value === NONE || value === NEW ? '' : value)
    else if (showManual.value || key === 'category') body.append(key, value)
  }
  try {
    const result = await $fetch<{ id: number, warnings: string[], message: string }>('/api/erp/incoming', {
      method: 'POST', body, headers: { 'X-CSRF-Token': useCockpitSession().value?.csrf ?? '' },
    })
    useNotice().ok(result.message)
    warnings.value = result.warnings
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    showManual.value = false
    Object.assign(form, { supplierId: NEW, supplierName: '', number: '', issueDate: '', dueDate: '', net: '', tax: '0', iban: '', note: '' })
    await refresh()
    if (result.warnings.length === 0) await navigateTo(`/erp/incoming-invoice?id=${result.id}`)
  }
  catch (e) {
    error.value = errorMessage(e)
    // A file without e-invoice data needs the fields typed in.
    if (error.value.includes('keine E-Rechnung')) showManual.value = true
  }
  finally {
    busy.value = null
  }
}

const filter = ref('open')
const list = computed(() => (data.value?.invoices ?? []).filter(i => filter.value === 'all' || i.status === filter.value))
const openSum = computed(() => (data.value?.invoices ?? []).filter(i => i.status === 'open').reduce((s, i) => s + i.grossCents, 0))
const STATUS: Record<string, { label: string, color: 'info' | 'success' | 'neutral' }> = {
  open: { label: 'Offen', color: 'info' }, paid: { label: 'Bezahlt', color: 'success' }, discarded: { label: 'Verworfen', color: 'neutral' },
}
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <h1 class="text-2xl font-semibold text-highlighted">
      Eingangsrechnungen
    </h1>
    <div class="grid gap-4 lg:grid-cols-5">
      <UCard class="lg:col-span-3">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm text-muted">
            Offen zu zahlen <strong class="text-highlighted">{{ euro(openSum) }}</strong>
          </p>
          <div class="flex gap-1">
            <UButton
v-for="f in [['open', 'Offen'], ['paid', 'Bezahlt'], ['discarded', 'Verworfen'], ['all', 'Alle']]" :key="f[0]" size="xs"
              :color="filter === f[0] ? 'primary' : 'neutral'" :variant="filter === f[0] ? 'solid' : 'outline'" @click="filter = f[0]!">
              {{ f[1] }}
            </UButton>
          </div>
        </div>
        <p v-if="list.length === 0" class="text-sm text-muted">
          Keine Rechnungen.
        </p>
        <ul v-else class="divide-y divide-default">
          <li v-for="i in list" :key="i.id">
            <NuxtLink :to="`/erp/incoming-invoice?id=${i.id}`" class="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-elevated/50">
              <div class="text-sm">
                <strong>{{ i.supplierName }}</strong> <span class="text-muted">{{ i.number }}</span>
                <p class="text-xs text-muted">
                  {{ day(i.issueDate) }} · {{ INCOMING_CATEGORIES[i.category] }}<span v-if="i.dueDate && i.status === 'open'" :class="i.dueDate < data.today ? 'text-error' : ''"> · fällig {{ day(i.dueDate) }}</span>
                  <span v-if="i.format !== 'other'"> · E-Rechnung</span>
                </p>
              </div>
              <div class="flex items-center gap-2 text-sm">
                <UBadge :color="STATUS[i.status]!.color" variant="subtle" :label="STATUS[i.status]!.label" />
                <strong class="w-24 text-right">{{ euro(i.grossCents) }}</strong>
              </div>
            </NuxtLink>
          </li>
        </ul>
      </UCard>

      <UCard class="lg:col-span-2">
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Rechnung erfassen
          </h2>
        </template>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-3" role="alert" />
        <UAlert v-for="(w, i) in warnings" :key="i" color="warning" variant="subtle" :title="w" class="mb-3" />
        <form class="space-y-3" @submit.prevent="upload">
          <p class="text-xs text-muted">
            E-Rechnungen (ZUGFeRD-PDF, XRechnung im CII-Format) werden automatisch gelesen. Bei anderen PDFs oder Fotos trägst du die Angaben selbst ein.
          </p>
          <input ref="fileInput" type="file" accept=".pdf,.xml,application/pdf,application/xml,text/xml,image/png,image/jpeg" class="block w-full text-sm" aria-label="Datei" @change="pickFile">
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Kategorie">
              <USelect v-model="form.category" :items="categoryItems" class="w-full" />
            </UFormField>
            <UFormField label="Projekt">
              <USelect v-model="form.projectId" :items="projectItems" class="w-full" />
            </UFormField>
          </div>
          <USwitch v-model="showManual" label="Angaben von Hand eintragen (keine E-Rechnung)" />
          <template v-if="showManual">
            <UFormField label="Lieferant">
              <USelect v-model="form.supplierId" :items="supplierItems" class="w-full" />
            </UFormField>
            <UFormField v-if="form.supplierId === NEW" label="Name des neuen Lieferanten">
              <UInput v-model="form.supplierName" :maxlength="100" class="w-full" />
            </UFormField>
            <div class="grid grid-cols-2 gap-3">
              <UFormField label="Rechnungsnummer">
                <UInput v-model="form.number" :maxlength="60" class="w-full" />
              </UFormField>
              <UFormField label="Rechnungsdatum">
                <UInput v-model="form.issueDate" type="date" class="w-full" />
              </UFormField>
              <UFormField label="Netto (€)">
                <UInput v-model="form.net" inputmode="decimal" class="w-full" />
              </UFormField>
              <UFormField label="Umsatzsteuer (€)">
                <UInput v-model="form.tax" inputmode="decimal" class="w-full" />
              </UFormField>
              <UFormField label="Fällig am" hint="optional">
                <UInput v-model="form.dueDate" type="date" class="w-full" />
              </UFormField>
              <UFormField label="IBAN" hint="optional">
                <UInput v-model="form.iban" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Notiz" hint="optional">
              <UInput v-model="form.note" :maxlength="500" class="w-full" />
            </UFormField>
          </template>
          <UButton type="submit" icon="i-lucide-upload" :loading="busy === 'upload'">
            Hochladen
          </UButton>
        </form>
      </UCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { day, euro, INCOMING_CATEGORIES, priceText, type ShareForm, sharesBody } from '#shared/lib/erp'
import type { Choice, IncomingInvoice, IncomingMailFile, Supplier } from '#shared/types/erp'
import { emptyFilter, FILTER_CHOICES, type IncomingFilter, isFiltered, matchesIncoming } from '#shared/lib/incomingFilter'

// Incoming invoices: upload, attachments from the mailbox to enter, open ones to pay, all received.
useHead({ title: 'Eingangsrechnungen · Cockpit' })
const { data, refresh } = await useFetch<{ invoices: IncomingInvoice[], suppliers: Supplier[], projects: Choice[], mailFiles: IncomingMailFile[], ignoredMailFiles: IncomingMailFile[], mailbox: string | null, today: string }>('/api/erp/incoming')
const { busy, run } = useAction()

const NONE = 'none'
const NEW = 'new'
const categoryItems = Object.entries(INCOMING_CATEGORIES).map(([value, label]) => ({ value, label }))
const supplierItems = computed(() => [{ value: NEW, label: '+ neuer Lieferant' }, ...(data.value?.suppliers ?? []).map(s => ({ value: String(s.id), label: s.name }))])

const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const showManual = ref(false)
const form = reactive({ category: 'other', supplierId: NEW, supplierName: '', number: '', issueDate: '', dueDate: '', net: '', tax: '0', iban: '', note: '', currency: 'EUR', euroGross: '', kind: 'invoice', relatedId: NONE })
// "€", or the code of another currency the amounts are typed in.
const sign = computed(() => form.currency === 'EUR' ? '€' : form.currency)
// The projects the invoice is split across (components/ErpProjectShares.vue).
const shares = ref<ShareForm[]>([{ projectId: NONE, share: '' }])
const error = ref<string | null>(null)
const warnings = ref<string[]>([])

function pickFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  mailFile.value = null
  error.value = null
  if (file.value !== null) void suggest(file.value, null)
}

// Suggestions from the file's text (server/lib/erp/extract.ts): for a file without
// e-invoice data the form opens with what was found; the user checks it before saving.
interface Suggestion {
  einvoice: boolean
  source: 'pdf' | 'ocr' | null
  problem: string | null
  fields: { number: string | null, issueDate: string | null, dueDate: string | null, netCents: number | null, taxCents: number | null,
    iban: string | null, supplierId: number | null, currency: string, kind: 'invoice' | 'credit' } | null
}
const suggestion = ref<Suggestion | null>(null)
async function suggest(selected: File, senderName: string | null) {
  suggestion.value = null
  const body = new FormData()
  body.append('file', selected)
  const result = await run('suggest', () => $fetch<Suggestion>('/api/erp/incoming/extract', {
    method: 'POST', body, headers: { 'X-CSRF-Token': useCockpitSession().value?.csrf ?? '' },
  }))
  // The user may have picked another file meanwhile.
  if (result === null || file.value !== selected) return
  suggestion.value = result
  if (result.einvoice) return
  showManual.value = true
  const f = result.fields
  if (f === null) return
  Object.assign(form, {
    supplierId: f.supplierId !== null ? String(f.supplierId) : NEW,
    supplierName: f.supplierId === null && form.supplierName === '' ? (senderName ?? '') : form.supplierName,
    number: f.number ?? form.number,
    issueDate: f.issueDate ?? form.issueDate,
    dueDate: f.dueDate ?? form.dueDate,
    net: f.netCents !== null ? priceText(f.netCents) : form.net,
    tax: f.taxCents !== null ? priceText(f.taxCents) : form.tax,
    iban: f.iban ?? form.iban,
    // Amounts in another currency stay as printed; the euro amount is entered by hand.
    currency: f.currency,
    euroGross: '',
    kind: f.kind,
  })
}
const suggestionNote = computed(() => {
  const s = suggestion.value
  if (s === null || s.einvoice) return s?.einvoice ? 'E-Rechnung erkannt: Die Angaben werden beim Speichern automatisch gelesen.' : null
  if (s.problem !== null) return s.problem
  if (s.fields === null) return 'In der Datei wurde kein Text gefunden. Bitte trage die Angaben selbst ein.'
  const found = [s.fields.number, s.fields.issueDate, s.fields.netCents].filter(v => v !== null).length
  const how = s.source === 'ocr' ? 'per Texterkennung (OCR) gelesen' : 'aus dem Text der PDF gelesen'
  return found === 0
    ? `Keine Angaben sicher erkannt (${s.source === 'ocr' ? 'Texterkennung' : 'Text der PDF'}). Bitte trage sie selbst ein.`
    : `Vorschlag ${how}. Bitte prüfe alle Angaben vor dem Speichern.`
})

// An attachment from the mailbox goes into the form above: the file is loaded from the
// server and sent back with the typed-in fields; the upload then marks it as entered.
const mailFile = ref<IncomingMailFile | null>(null)
async function enterMailFile(item: IncomingMailFile) {
  const blob = await run('mail-load', () => $fetch<Blob>(`/api/erp/incoming/mail/${item.id}`, { responseType: 'blob' }))
  if (blob === null) return
  const loaded = new File([blob], item.fileName, { type: item.fileType })
  file.value = loaded
  if (fileInput.value) fileInput.value.value = ''
  mailFile.value = item
  showManual.value = true
  error.value = item.problem
  warnings.value = []
  document.getElementById('erfassen')?.scrollIntoView({ behavior: 'smooth' })
  // "Name <address>" of the original sender, as a name for a new supplier.
  void suggest(loaded, item.sender?.replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '').trim() || null)
}
// "Beleg öffnen" while typing in the fields: the mailbox file from the server, a file
// picked on this device as a local blob: URL. Only PDFs and images keep their type; any
// other file (XML) opens as plain text, so nothing in it can run on the cockpit's origin.
const localUrl = ref<string | null>(null)
watch(file, (selected) => {
  if (localUrl.value !== null) URL.revokeObjectURL(localUrl.value)
  localUrl.value = null
  if (selected === null || mailFile.value !== null) return
  const type = ['application/pdf', 'image/png', 'image/jpeg'].includes(selected.type) ? selected.type : 'text/plain'
  localUrl.value = URL.createObjectURL(new Blob([selected], { type }))
}, { flush: 'post' })
onBeforeUnmount(() => {
  if (localUrl.value !== null) URL.revokeObjectURL(localUrl.value)
})
const fileUrl = computed(() => mailFile.value !== null ? `/api/erp/incoming/mail/${mailFile.value.id}` : localUrl.value)

async function ignoreMailFile(item: IncomingMailFile) {
  if (await run(`ignore-${item.id}`, () => cockpitSend('POST', `/api/erp/incoming/mail/${item.id}/ignore`)) !== null) await refresh()
}
const showIgnored = ref(false)
async function restoreMailFile(item: IncomingMailFile) {
  if (await run(`restore-${item.id}`, () => cockpitSend('POST', `/api/erp/incoming/mail/${item.id}/restore`)) !== null) await refresh()
}
async function fetchNow() {
  if (await run('fetch', () => cockpitSend('POST', '/api/erp/mailbox/fetch')) !== null) await refresh()
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
  if (mailFile.value !== null) body.append('mailFileId', String(mailFile.value.id))
  body.append('projects', JSON.stringify(sharesBody(shares.value)))
  for (const [key, value] of Object.entries(form)) {
    if (key === 'supplierId') body.append(key, value === NEW ? '' : value)
    else if (key === 'relatedId') body.append(key, value === NONE ? '' : value)
    else if (showManual.value || key === 'category') body.append(key, value)
  }
  try {
    const result = await $fetch<{ id: number, warnings: string[], message: string }>('/api/erp/incoming', {
      method: 'POST', body, headers: { 'X-CSRF-Token': useCockpitSession().value?.csrf ?? '' },
    })
    useNotice().ok(result.message)
    warnings.value = result.warnings
    file.value = null
    mailFile.value = null
    if (fileInput.value) fileInput.value.value = ''
    showManual.value = false
    suggestion.value = null
    Object.assign(form, { supplierId: NEW, supplierName: '', number: '', issueDate: '', dueDate: '', net: '', tax: '0', iban: '', note: '', currency: 'EUR', euroGross: '', kind: 'invoice', relatedId: NONE })
    shares.value = [{ projectId: NONE, share: '' }]
    await refresh()
    if (result.warnings.length === 0) await navigateTo(`/erp/incoming-invoice?id=${result.id}`)
  }
  catch (e) {
    error.value = errorMessage(e)
    // A file without e-invoice data needs the fields typed in.
    if (error.value.includes('keine E-Rechnung')) showManual.value = true
    // The very same file is in the books: the mailbox file counts as entered, so the list changes.
    // Any other refusal (e.g. a number already used) keeps the file here to correct and retry.
    if (error.value.includes('Diese Datei wurde bereits erfasst')) {
      mailFile.value = null
      await refresh()
    }
  }
  finally {
    busy.value = null
  }
}

// A credit note or refund of a supplier: it may refer to an earlier invoice of that supplier.
const kindItems = [{ value: 'invoice', label: 'Rechnung' }, { value: 'credit', label: 'Gutschrift / Erstattung' }]
const relatedItems = computed(() => [{ value: NONE, label: '– keine –' }, ...(data.value?.invoices ?? [])
  .filter(i => i.kind === 'invoice' && i.status !== 'discarded' && (form.supplierId === NEW || String(i.supplierId) === form.supplierId))
  .map(i => ({ value: String(i.id), label: `${i.supplierName} · ${i.number} · ${day(i.issueDate)} · ${euro(i.grossCents)}` }))])
// Gross of the credit notes that refer to each invoice, for the hint in the list.
const creditsOf = computed(() => {
  const sums = new Map<number, number>()
  for (const i of data.value?.invoices ?? []) {
    if (i.kind === 'credit' && i.relatedId !== null && i.status !== 'discarded') sums.set(i.relatedId, (sums.get(i.relatedId) ?? 0) + i.grossCents)
  }
  return sums
})
const signed = (i: IncomingInvoice) => i.kind === 'credit' ? -i.grossCents : i.grossCents
const refundSum = computed(() => (data.value?.invoices ?? []).filter(i => i.status === 'open' && i.kind === 'credit').reduce((s, i) => s + i.grossCents, 0))

// Search and filters (shared/lib/incomingFilter.ts); status and kind as buttons, the rest below.
// Kept in the address, so going back from an invoice shows the list as it was.
const search = useListState<IncomingFilter>(emptyFilter(), FILTER_CHOICES)
const showFilters = ref(search.supplierId !== '' || search.category !== '' || search.projectId !== '' || search.from !== '' || search.to !== '')
const { last, rowId, open: remember } = useLastOpened('incoming')
const list = computed(() => (data.value?.invoices ?? []).filter(i => matchesIncoming(i, search)))
function resetFilters() {
  Object.assign(search, { ...emptyFilter(), status: search.status, kind: search.kind })
}
// USelect cannot hold an empty value, so "all" is a placeholder mapped to ''.
const ALL = 'all'
const filterSupplierItems = computed(() => [{ value: ALL, label: 'Alle Lieferanten' },
  ...(data.value?.suppliers ?? []).map(s => ({ value: String(s.id), label: s.name })).sort((a, b) => a.label.localeCompare(b.label, 'de'))])
const filterCategoryItems = [{ value: ALL, label: 'Alle Kategorien' }, ...Object.entries(INCOMING_CATEGORIES).map(([value, label]) => ({ value, label }))]
const filterProjectItems = computed(() => [{ value: ALL, label: 'Alle Projekte' }, { value: 'none', label: '– ohne Projekt –' },
  ...(data.value?.projects ?? []).map(p => ({ value: String(p.id), label: p.name }))])
const selectModel = (key: 'supplierId' | 'category' | 'projectId') => computed({
  get: () => search[key] === '' ? ALL : search[key],
  set: (v: string) => { search[key] = v === ALL ? '' : v },
})
const supplierFilter = selectModel('supplierId')
const categoryFilter = selectModel('category')
const projectFilter = selectModel('projectId')
const listSum = computed(() => list.value.reduce((s, i) => s + signed(i), 0))
const openSum = computed(() => (data.value?.invoices ?? []).filter(i => i.status === 'open' && i.kind === 'invoice').reduce((s, i) => s + i.grossCents, 0))
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
    <UCard v-if="data.mailbox || data.mailFiles.length > 0 || data.ignoredMailFiles.length > 0">
      <template #header>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold text-highlighted">
            Aus dem Postfach
          </h2>
          <UButton v-if="data.mailbox" size="xs" color="neutral" variant="outline" icon="i-lucide-mail" :loading="busy === 'fetch'" @click="fetchNow">
            Jetzt abrufen
          </UButton>
        </div>
      </template>
      <p class="mb-2 text-xs text-muted">
        E-Mails an {{ data.mailbox ?? 'das Postfach' }} werden alle 15 Minuten abgerufen. E-Rechnungen werden sofort erfasst; andere PDFs und Fotos warten hier, bis du sie erfasst oder ignorierst.
      </p>
      <p v-if="data.mailFiles.length === 0" class="text-sm text-muted">
        Nichts zu erfassen.
      </p>
      <ul v-else class="divide-y divide-default">
        <li v-for="m in data.mailFiles" :key="m.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
          <div class="min-w-0 text-sm">
            <a :href="`/api/erp/incoming/mail/${m.id}`" target="_blank" rel="noopener" class="font-medium text-primary hover:underline">{{ m.fileName }}</a>
            <p class="truncate text-xs text-muted">
              {{ m.sender ?? 'Unbekannter Absender' }}<span v-if="m.subject"> · {{ m.subject }}</span><span v-if="m.receivedAt"> · {{ day(m.receivedAt.slice(0, 10)) }}</span>
            </p>
            <p v-if="m.problem" class="text-xs text-warning">
              {{ m.problem }}
            </p>
          </div>
          <div class="flex gap-2">
            <UButton size="xs" icon="i-lucide-pencil" :loading="busy === 'mail-load'" @click="enterMailFile(m)">
              Erfassen
            </UButton>
            <UButton size="xs" color="neutral" variant="ghost" :loading="busy === `ignore-${m.id}`" @click="ignoreMailFile(m)">
              Ignorieren
            </UButton>
          </div>
        </li>
      </ul>
      <div v-if="data.ignoredMailFiles.length > 0" class="mt-3 border-t border-default pt-2">
        <UButton size="xs" color="neutral" variant="link" :icon="showIgnored ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="px-0" @click="showIgnored = !showIgnored">
          Ignorierte Dateien ({{ data.ignoredMailFiles.length }})
        </UButton>
        <ul v-if="showIgnored" class="divide-y divide-default">
          <li v-for="m in data.ignoredMailFiles" :key="m.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
            <div class="min-w-0 text-sm">
              <a :href="`/api/erp/incoming/mail/${m.id}`" target="_blank" rel="noopener" class="text-primary hover:underline">{{ m.fileName }}</a>
              <p class="truncate text-xs text-muted">
                {{ m.sender ?? 'Unbekannter Absender' }}<span v-if="m.subject"> · {{ m.subject }}</span><span v-if="m.problem"> · {{ m.problem }}</span>
              </p>
            </div>
            <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-undo-2" :loading="busy === `restore-${m.id}`" @click="restoreMailFile(m)">
              Wiederherstellen
            </UButton>
          </li>
        </ul>
      </div>
    </UCard>
    <div class="grid gap-4 lg:grid-cols-5">
      <UCard class="lg:col-span-3">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm text-muted">
            Offen zu zahlen <strong class="text-highlighted">{{ euro(openSum) }}</strong>
            <span v-if="refundSum > 0"> · Erstattungen offen <strong class="text-highlighted">{{ euro(refundSum) }}</strong></span>
          </p>
          <div class="flex flex-col items-start gap-1">
            <div class="flex gap-1">
              <UButton
v-for="f in [['open', 'Offen'], ['paid', search.kind === 'credit' ? 'Erstattet' : 'Bezahlt'], ['discarded', 'Verworfen'], ['all', 'Alle']]" :key="f[0]" size="xs"
                :color="search.status === f[0] ? 'primary' : 'neutral'" :variant="search.status === f[0] ? 'solid' : 'outline'" @click="search.status = f[0] as IncomingFilter['status']">
                {{ f[1] }}
              </UButton>
            </div>
            <div class="flex gap-1">
              <UButton
v-for="f in [['all', 'Alle Arten'], ['invoice', 'Rechnungen'], ['credit', 'Gutschriften']]" :key="f[0]" size="xs"
                :color="search.kind === f[0] ? 'primary' : 'neutral'" :variant="search.kind === f[0] ? 'solid' : 'outline'" @click="search.kind = f[0] as IncomingFilter['kind']">
                {{ f[1] }}
              </UButton>
            </div>
          </div>
        </div>
        <div class="mb-3 space-y-2">
          <div class="flex gap-2">
            <UInput v-model="search.query" icon="i-lucide-search" placeholder="Suchen: Lieferant, Nummer, Notiz, Betrag" class="flex-1" />
            <UButton color="neutral" :variant="showFilters || isFiltered(search) ? 'soft' : 'outline'" icon="i-lucide-sliders-horizontal" @click="showFilters = !showFilters">
              Filter
            </UButton>
          </div>
          <div v-if="showFilters" class="grid gap-2 sm:grid-cols-2">
            <USelect v-model="supplierFilter" :items="filterSupplierItems" class="w-full" aria-label="Lieferant" />
            <USelect v-model="categoryFilter" :items="filterCategoryItems" class="w-full" aria-label="Kategorie" />
            <USelect v-model="projectFilter" :items="filterProjectItems" class="w-full" aria-label="Projekt" />
            <div class="flex items-center gap-1">
              <UInput v-model="search.from" type="date" class="flex-1" aria-label="Rechnungsdatum von" />
              <span class="text-muted">–</span>
              <UInput v-model="search.to" type="date" class="flex-1" aria-label="Rechnungsdatum bis" />
            </div>
          </div>
          <p v-if="isFiltered(search)" class="flex items-center justify-between text-xs text-muted">
            <span>{{ list.length }} Treffer · Summe {{ euro(listSum) }}</span>
            <UButton size="xs" color="neutral" variant="link" @click="resetFilters">
              Filter zurücksetzen
            </UButton>
          </p>
        </div>
        <p v-if="list.length === 0" class="text-sm text-muted">
          {{ isFiltered(search) ? 'Keine Treffer.' : 'Keine Rechnungen.' }}
        </p>
        <ul v-else class="divide-y divide-default">
          <li v-for="i in list" :id="rowId(i.id)" :key="i.id">
            <NuxtLink
              :to="`/erp/incoming-invoice?id=${i.id}`" class="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-elevated/50"
              :class="last === i.id ? 'bg-primary/10 ring-1 ring-primary/40 rounded-md px-2 -mx-2' : ''" @click="remember(i.id)"
            >
              <div class="text-sm">
                <strong>{{ i.supplierName }}</strong> <span class="text-muted">{{ i.number }}</span>
                <p class="text-xs text-muted">
                  {{ day(i.issueDate) }} · {{ INCOMING_CATEGORIES[i.category] }}<span v-if="i.dueDate && i.status === 'open'" :class="i.dueDate < data.today ? 'text-error' : ''"> · fällig {{ day(i.dueDate) }}</span>
                  <span v-if="i.format !== 'other'"> · E-Rechnung</span>
                  <span v-if="creditsOf.get(i.id)"> · Gutschriften {{ euro(-creditsOf.get(i.id)!) }}</span>
                  <span v-if="i.kind === 'credit' && i.relatedId !== null"> · zu {{ data.invoices.find(r => r.id === i.relatedId)?.number ?? 'Rechnung' }}</span>
                </p>
              </div>
              <div class="flex items-center gap-2 text-sm">
                <UBadge v-if="i.kind === 'credit'" color="neutral" variant="outline" label="Gutschrift" />
                <UBadge :color="STATUS[i.status]!.color" variant="subtle" :label="i.kind === 'credit' && i.status === 'paid' ? 'Erstattet' : STATUS[i.status]!.label" />
                <strong class="w-24 text-right">{{ euro(signed(i)) }}</strong>
              </div>
            </NuxtLink>
          </li>
        </ul>
        <p v-if="list.length > 1 && search.kind === 'credit' && !isFiltered(search)" class="mt-2 flex justify-between border-t border-default pt-2 text-sm">
          <span>Summe der angezeigten Gutschriften</span>
          <strong>{{ euro(listSum) }}</strong>
        </p>
      </UCard>

      <UCard id="erfassen" class="lg:col-span-2">
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Rechnung erfassen
          </h2>
        </template>
        <div v-if="file" class="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p class="min-w-0 truncate">
            {{ mailFile ? 'Datei aus dem Postfach:' : 'Datei:' }} <strong>{{ file.name }}</strong>
          </p>
          <UButton v-if="fileUrl" :to="fileUrl" target="_blank" rel="noopener" external size="xs" color="neutral" variant="outline" icon="i-lucide-external-link">
            Beleg öffnen
          </UButton>
        </div>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-3" role="alert" />
        <UAlert v-for="(w, i) in warnings" :key="i" color="warning" variant="subtle" :title="w" class="mb-3" />
        <form class="space-y-3" @submit.prevent="upload">
          <p class="text-xs text-muted">
            E-Rechnungen (ZUGFeRD-PDF, XRechnung im CII-Format) werden automatisch gelesen. Bei anderen PDFs und Fotos liest das Cockpit den Text und schlägt die Angaben vor.
          </p>
          <input v-show="!mailFile" ref="fileInput" type="file" accept=".pdf,.xml,application/pdf,application/xml,text/xml,image/png,image/jpeg" class="block w-full text-sm" aria-label="Datei" @change="pickFile">
          <UFormField label="Kategorie">
            <USelect v-model="form.category" :items="categoryItems" class="w-full" />
          </UFormField>
          <UFormField label="Projekt">
            <ErpProjectShares v-model="shares" :projects="data.projects" />
          </UFormField>
          <p v-if="busy === 'suggest'" class="text-xs text-muted">
            Datei wird gelesen …
          </p>
          <UAlert v-else-if="suggestionNote" :color="suggestion?.fields && !suggestion.problem ? 'info' : 'neutral'" variant="subtle" :title="suggestionNote" />
          <USwitch v-model="showManual" label="Angaben von Hand eintragen (keine E-Rechnung)" />
          <template v-if="showManual">
            <UFormField label="Art">
              <USelect v-model="form.kind" :items="kindItems" class="w-full" />
            </UFormField>
            <UFormField label="Lieferant">
              <USelect v-model="form.supplierId" :items="supplierItems" class="w-full" />
            </UFormField>
            <UFormField v-if="form.kind === 'credit'" label="Gehört zur Rechnung" hint="optional">
              <USelect v-model="form.relatedId" :items="relatedItems" class="w-full" />
            </UFormField>
            <UFormField v-if="form.supplierId === NEW" label="Name des neuen Lieferanten">
              <UInput v-model="form.supplierName" :maxlength="100" class="w-full" />
            </UFormField>
            <div class="grid grid-cols-2 gap-3">
              <UFormField :label="form.kind === 'credit' ? 'Nummer der Gutschrift' : 'Rechnungsnummer'">
                <UInput v-model="form.number" :maxlength="60" class="w-full" />
              </UFormField>
              <UFormField :label="form.kind === 'credit' ? 'Datum der Gutschrift' : 'Rechnungsdatum'">
                <UInput v-model="form.issueDate" type="date" class="w-full" />
              </UFormField>
              <UFormField :label="`Netto (${sign})`">
                <UInput v-model="form.net" inputmode="decimal" class="w-full" />
              </UFormField>
              <UFormField :label="`Umsatzsteuer (${sign})`">
                <UInput v-model="form.tax" inputmode="decimal" class="w-full" />
              </UFormField>
              <UFormField :label="form.kind === 'credit' ? 'Erstattung bis' : 'Fällig am'" hint="optional">
                <UInput v-model="form.dueDate" type="date" class="w-full" />
              </UFormField>
              <UFormField label="IBAN" hint="optional">
                <UInput v-model="form.iban" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Währung">
              <ErpCurrency v-model:currency="form.currency" v-model:euro-gross="form.euroGross" :net="form.net" :tax="form.tax" />
            </UFormField>
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

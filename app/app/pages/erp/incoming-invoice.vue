<script setup lang="ts">
import { day, euro, ibanText, INCOMING_CATEGORIES, priceText, type ShareForm, shareForms, sharesBody, splitCents, UNITS } from '#shared/lib/erp'
import type { Choice, IncomingInvoice, Supplier } from '#shared/types/erp'

// One incoming invoice: what the e-invoice says, the stored file, payment and corrections.
interface Parsed {
  number: string
  lines: { name: string, quantity: number, unit: string, netCents: number, vatRate: number }[]
  taxes: { category: string, rate: number, basisCents: number, taxCents: number }[]
  supplier: { name: string, vatId: string | null, street: string | null, postcode: string | null, city: string | null }
}
interface Page { invoice: IncomingInvoice, supplier: Supplier | null, otherIbans: string[], parsed: Parsed | null, projects: Choice[], siblings: IncomingInvoice[], today: string }

const route = useRoute()
const id = computed(() => String(route.query.id ?? ''))
const { data, refresh, error } = await useFetch<Page>(() => `/api/erp/incoming/${encodeURIComponent(id.value)}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Diese Eingangsrechnung gibt es nicht.', fatal: true })
}
useHead({ title: computed(() => `${data.value?.invoice.supplierName ?? 'Eingangsrechnung'} · Cockpit`) })
const { busy, run } = useAction()

const form = reactive({ number: '', issueDate: '', dueDate: '', net: '', tax: '', category: 'other', iban: '', note: '', currency: 'EUR', euroGross: '', kind: 'invoice', relatedId: 'none' })
const sign = computed(() => form.currency === 'EUR' ? '€' : form.currency)
const shares = ref<ShareForm[]>([])
function fill() {
  const i = data.value?.invoice
  if (!i) return
  Object.assign(form, {
    // An invoice in another currency is edited in its own amounts (converted on saving).
    number: i.number, issueDate: i.issueDate, dueDate: i.dueDate ?? '', net: priceText(i.originalNetCents ?? i.netCents), tax: priceText(i.originalTaxCents ?? i.taxCents),
    category: i.category, iban: i.iban ?? '', note: i.note ?? '', currency: i.currency, euroGross: i.currency === 'EUR' ? '' : priceText(i.grossCents),
    kind: i.kind, relatedId: i.relatedId !== null ? String(i.relatedId) : 'none',
  })
  shares.value = shareForms(i.projects)
}
fill()
watch(() => data.value?.invoice, fill)
// A credit note or refund lowers the expenses; it may refer to an invoice of the same supplier.
const isCredit = computed(() => data.value?.invoice.kind === 'credit')
const kindItems = [{ value: 'invoice', label: 'Rechnung' }, { value: 'credit', label: 'Gutschrift / Erstattung' }]
const relatedItems = computed(() => [{ value: 'none', label: '– keine –' }, ...(data.value?.siblings ?? [])
  .filter(i => i.kind === 'invoice' && i.status !== 'discarded')
  .map(i => ({ value: String(i.id), label: `${i.number} · ${day(i.issueDate)} · ${euro(i.grossCents)}` }))])
const related = computed(() => data.value?.siblings.find(i => i.id === data.value?.invoice.relatedId) ?? null)
const credits = computed(() => (data.value?.siblings ?? []).filter(i => i.relatedId === data.value?.invoice.id && i.status !== 'discarded'))
const creditSum = computed(() => credits.value.reduce((s, c) => s + c.grossCents, 0))
const categoryItems = Object.entries(INCOMING_CATEGORIES).map(([value, label]) => ({ value, label }))
// The stored split in euros, as the evaluation counts it.
const projectParts = computed(() => {
  const i = data.value?.invoice
  if (!i || i.projects.length < 2) return []
  const cents = splitCents(i.netCents, i.projects.map(p => p.shareBp))
  return i.projects.map((p, k) => ({ name: data.value!.projects.find(c => c.id === p.projectId)?.name ?? `Projekt ${p.projectId}`, cents: cents[k]! }))
})
const ibanChanged = computed(() => {
  const iban = data.value?.invoice.iban
  return iban != null && data.value!.otherIbans.length > 0 && !data.value!.otherIbans.includes(iban)
})

async function save() {
  if (await run('save', () => cockpitSend('PUT', `/api/erp/incoming/${id.value}`, { ...form, relatedId: form.relatedId === 'none' ? '' : form.relatedId, projects: sharesBody(shares.value) })) !== null) await refresh()
}
const paidOn = ref('')
watch(() => data.value?.today, (t) => { paidOn.value = t ?? '' }, { immediate: true })
// The amount actually debited, when the bank took a little more or less (fees, exchange).
const paidAmount = ref('')
const paidDifference = computed(() => {
  const i = data.value?.invoice
  return i?.paidCents != null ? i.paidCents - i.grossCents : 0
})
async function setPaid(date: string) {
  if (await run('paid', () => cockpitPost(`/api/erp/incoming/${id.value}/paid`, { paidOn: date, paidAmount: date === '' ? '' : paidAmount.value })) !== null) {
    paidAmount.value = ''
    await refresh()
  }
}
const discardReason = ref('')
const confirmDiscard = ref(false)
async function discard() {
  if (await run('discard', () => cockpitPost(`/api/erp/incoming/${id.value}/discard`, { reason: discardReason.value })) !== null) {
    confirmDiscard.value = false
    await refresh()
  }
}
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <NuxtLink to="/erp/incoming" class="text-sm text-muted hover:underline">
      ← Alle Eingangsrechnungen
    </NuxtLink>
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold text-highlighted">
        {{ data.invoice.supplierName }} · {{ data.invoice.number }}
      </h1>
      <UBadge v-if="isCredit" color="warning" variant="subtle" label="Gutschrift" />
      <UBadge v-if="data.invoice.status === 'paid'" color="success" variant="subtle" :label="`${isCredit ? 'Erstattet' : 'Bezahlt'} am ${day(data.invoice.paidOn)}`" />
      <UBadge v-else-if="data.invoice.status === 'discarded'" color="neutral" variant="subtle" label="Verworfen" />
      <UBadge v-else color="info" variant="subtle" label="Offen" />
    </div>
    <UAlert
v-if="ibanChanged" color="error" variant="subtle" icon="i-lucide-shield-alert"
      :title="`Die IBAN ${ibanText(data.invoice.iban!)} weicht von früheren Rechnungen dieses Lieferanten ab.`"
      description="Bitte vor dem Bezahlen beim Lieferanten über eine bekannte Telefonnummer nachfragen. Geänderte Bankverbindungen sind eine häufige Betrugsmasche." />
    <UAlert v-if="data.invoice.status === 'discarded'" color="neutral" variant="subtle" :title="`Verworfen: ${data.invoice.discardedReason}`" />

    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <h2 class="font-semibold text-highlighted">
              {{ data.parsed ? 'Inhalt der E-Rechnung' : 'Beleg' }}
            </h2>
            <UButton size="sm" :to="`/api/erp/incoming/${data.invoice.id}/file`" target="_blank" external color="neutral" variant="outline" icon="i-lucide-file">
              Originaldatei
            </UButton>
          </div>
        </template>
        <template v-if="data.parsed">
          <p class="text-sm">
            {{ data.parsed.supplier.name }}<span v-if="data.parsed.supplier.vatId"> · {{ data.parsed.supplier.vatId }}</span><br>
            <span class="text-muted">{{ [data.parsed.supplier.street, [data.parsed.supplier.postcode, data.parsed.supplier.city].filter(v => v).join(' ')].filter(v => v).join(', ') }}</span>
          </p>
          <ul class="mt-3 divide-y divide-default text-sm">
            <li v-for="(l, i) in data.parsed.lines" :key="i" class="flex justify-between gap-4 py-1">
              <span>{{ l.name }} <span class="text-xs text-muted">{{ String(l.quantity).replace('.', ',') }} {{ UNITS[l.unit] ?? l.unit }} · {{ l.vatRate }} %</span></span>
              <span>{{ euro(l.netCents) }}</span>
            </li>
          </ul>
          <ul class="mt-2 text-xs text-muted">
            <li v-for="(t, i) in data.parsed.taxes" :key="i">
              USt. {{ t.rate }} % ({{ t.category }}) auf {{ euro(t.basisCents) }}: {{ euro(t.taxCents) }}
            </li>
          </ul>
        </template>
        <p v-else class="text-sm text-muted">
          Keine E-Rechnung; die Angaben rechts wurden von Hand eingetragen. Maßgeblich ist die Originaldatei.
        </p>
        <p class="mt-3 text-xs text-muted">
          Datei: {{ data.invoice.fileName }} · erfasst {{ day(data.invoice.createdAt) }}. Sie wird unverändert aufbewahrt.
        </p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Angaben
          </h2>
        </template>
        <form class="space-y-3" @submit.prevent="save">
          <div class="grid grid-cols-2 gap-3">
            <UFormField :label="form.kind === 'credit' ? 'Nummer der Gutschrift' : 'Rechnungsnummer'">
              <UInput v-model="form.number" :maxlength="60" class="w-full" :disabled="data.invoice.status === 'discarded'" />
            </UFormField>
            <UFormField :label="form.kind === 'credit' ? 'Datum der Gutschrift' : 'Rechnungsdatum'">
              <UInput v-model="form.issueDate" type="date" class="w-full" :disabled="data.invoice.status === 'discarded'" />
            </UFormField>
            <UFormField :label="`Netto (${sign})`">
              <UInput v-model="form.net" inputmode="decimal" class="w-full" :disabled="data.invoice.status === 'discarded'" />
            </UFormField>
            <UFormField :label="`Umsatzsteuer (${sign})`">
              <UInput v-model="form.tax" inputmode="decimal" class="w-full" :disabled="data.invoice.status === 'discarded'" />
            </UFormField>
            <UFormField :label="form.kind === 'credit' ? 'Erstattung bis' : 'Fällig am'">
              <UInput v-model="form.dueDate" type="date" class="w-full" :disabled="data.invoice.status === 'discarded'" />
            </UFormField>
            <UFormField label="IBAN">
              <UInput v-model="form.iban" class="w-full" :disabled="data.invoice.status === 'discarded'" />
            </UFormField>
            <UFormField label="Kategorie">
              <USelect v-model="form.category" :items="categoryItems" class="w-full" :disabled="data.invoice.status === 'discarded'" />
            </UFormField>
            <UFormField label="Art" :help="data.invoice.format !== 'other' ? 'Steht so in der E-Rechnung.' : undefined">
              <USelect v-model="form.kind" :items="kindItems" class="w-full" :disabled="data.invoice.status === 'discarded' || data.invoice.format !== 'other'" />
            </UFormField>
            <UFormField v-if="form.kind === 'credit'" label="Gehört zur Rechnung">
              <USelect v-model="form.relatedId" :items="relatedItems" class="w-full" :disabled="data.invoice.status === 'discarded'" />
            </UFormField>
          </div>
          <p v-if="isCredit && related" class="text-sm">
            Gutschrift zur Rechnung <NuxtLink :to="`/erp/incoming-invoice?id=${related.id}`" class="text-primary hover:underline">{{ related.number }}</NuxtLink>
            vom {{ day(related.issueDate) }} über {{ euro(related.grossCents) }}.
          </p>
          <UFormField v-if="data.invoice.format === 'other' || data.invoice.currency !== 'EUR'" label="Währung">
            <ErpCurrency v-model:currency="form.currency" v-model:euro-gross="form.euroGross" :net="form.net" :tax="form.tax" :disabled="data.invoice.status === 'discarded'" />
          </UFormField>
          <UFormField label="Projekt">
            <ErpProjectShares v-model="shares" :projects="data.projects" :disabled="data.invoice.status === 'discarded'" />
          </UFormField>
          <p v-if="projectParts.length > 0" class="text-xs text-muted">
            Netto je Projekt: <span v-for="(p, k) in projectParts" :key="p.name">{{ k > 0 ? ' · ' : '' }}{{ p.name }} {{ euro(p.cents) }}</span>
          </p>
          <UFormField label="Notiz">
            <UInput v-model="form.note" :maxlength="500" class="w-full" :disabled="data.invoice.status === 'discarded'" />
          </UFormField>
          <p class="text-sm">
            Brutto <strong>{{ euro(data.invoice.grossCents) }}</strong>
            <span v-if="data.invoice.currency !== 'EUR'" class="text-muted">
              ({{ isCredit ? 'Gutschrift' : 'Rechnung' }} über {{ priceText((data.invoice.originalNetCents ?? 0) + (data.invoice.originalTaxCents ?? 0)) }} {{ data.invoice.currency }})
            </span>
          </p>
          <UButton v-if="data.invoice.status !== 'discarded'" type="submit" :loading="busy === 'save'">
            Speichern
          </UButton>
        </form>
      </UCard>
    </div>

    <UCard v-if="credits.length > 0">
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Gutschriften und Erstattungen zu dieser Rechnung
        </h2>
      </template>
      <ul class="divide-y divide-default text-sm">
        <li v-for="c in credits" :key="c.id" class="flex flex-wrap items-center justify-between gap-2 py-1">
          <span>
            <NuxtLink :to="`/erp/incoming-invoice?id=${c.id}`" class="text-primary hover:underline">{{ c.number }}</NuxtLink>
            <span class="text-muted"> vom {{ day(c.issueDate) }} · {{ c.status === 'paid' ? `erstattet am ${day(c.paidOn)}` : 'noch nicht erstattet' }}</span>
          </span>
          <span>{{ euro(-c.grossCents) }}</span>
        </li>
      </ul>
      <p class="mt-2 flex justify-between text-sm">
        <span>Rechnung {{ euro(data.invoice.grossCents) }} abzüglich Gutschriften</span>
        <strong>{{ euro(data.invoice.grossCents - creditSum) }}</strong>
      </p>
    </UCard>

    <UCard v-if="data.invoice.status !== 'discarded'">
      <div class="flex flex-wrap items-end gap-3">
        <template v-if="data.invoice.status === 'open'">
          <UFormField :label="isCredit ? 'Erstattet am' : 'Bezahlt am'">
            <UInput v-model="paidOn" type="date" />
          </UFormField>
          <UFormField :label="isCredit ? 'Gutgeschrieben (€)' : 'Abgebucht (€)'" hint="nur wenn abweichend">
            <UInput v-model="paidAmount" inputmode="decimal" :placeholder="priceText(data.invoice.grossCents)" class="w-36" />
          </UFormField>
          <UButton icon="i-lucide-check" :loading="busy === 'paid'" @click="setPaid(paidOn)">
            {{ isCredit ? 'Als erstattet markieren' : 'Als bezahlt markieren' }}
          </UButton>
        </template>
        <p v-else-if="paidDifference !== 0" class="text-sm">
          {{ isCredit ? 'Gutgeschrieben' : 'Abgebucht' }} {{ euro(data.invoice.paidCents!) }},
          Abweichung zur Rechnung {{ euro(paidDifference) }} (z. B. Bankgebühr oder Kursdifferenz).
        </p>
        <UButton v-if="data.invoice.status !== 'open'" color="neutral" variant="outline" :loading="busy === 'paid'" @click="setPaid('')">
          Wieder auf offen setzen
        </UButton>
        <UButton v-if="!confirmDiscard" color="error" variant="ghost" @click="confirmDiscard = true">
          Verwerfen …
        </UButton>
      </div>
      <form v-if="confirmDiscard" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="discard">
        <UFormField label="Grund" help="Die Datei bleibt aufbewahrt (GoBD), die Rechnung zählt aber nicht mehr mit.">
          <UInput v-model="discardReason" :maxlength="255" placeholder="z. B. doppelt erfasst" class="w-72" />
        </UFormField>
        <UButton type="submit" color="error" :loading="busy === 'discard'">
          Verwerfen
        </UButton>
        <UButton color="neutral" variant="ghost" @click="confirmDiscard = false">
          Abbrechen
        </UButton>
      </form>
    </UCard>
  </div>
</template>

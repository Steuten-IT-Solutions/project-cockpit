<script setup lang="ts">
import { addDays, day, euro, type LineForm, lineToForm, ORDER_STATES, percentText, QUOTE_STATES, QUOTE_VALID_DAYS, quantity, UNITS } from '#shared/lib/erp'
import type { CatalogItem, Choice, SalesDocument } from '#shared/types/erp'

// One quote or order confirmation: edit the draft, issue it (number and PDF), send it,
// record the customer's answer and turn it into an order or an invoice.
interface Page {
  document?: SalesDocument
  customers: (Choice & { email: string | null, projectId: number | null })[]
  projects: Choice[]
  catalog: CatalogItem[]
  smallBusiness: boolean
  hasSettings: boolean
  today: string
}
const route = useRoute()
const id = computed(() => String(route.query.id ?? 'new'))
const isNew = computed(() => id.value === 'new')
const { data, refresh, error } = await useFetch<Page>(() => (isNew.value ? '/api/erp/sales/form' : `/api/erp/sales/${encodeURIComponent(id.value)}`))
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Dieses Dokument gibt es nicht.', fatal: true })
}
const doc = computed(() => data.value?.document ?? null)
const kind = computed<'quote' | 'order'>(() => doc.value?.kind ?? (route.query.kind === 'order' ? 'order' : 'quote'))
const title = computed(() => (kind.value === 'quote' ? 'Angebot' : 'Auftragsbestätigung'))
useHead({ title: computed(() => `${doc.value?.number ?? title.value} · Cockpit`) })
const { busy, run } = useAction()

const NONE = 'none'
const form = reactive({ customerId: '', projectId: NONE, validUntil: '', deliveryDate: '', note: '', lines: [] as LineForm[] })
function fill() {
  const d = doc.value
  const today = data.value?.today ?? ''
  Object.assign(form, {
    customerId: d ? String(d.customerId) : '', projectId: d?.projectId != null ? String(d.projectId) : NONE,
    validUntil: d?.validUntil ?? (kind.value === 'quote' && today ? addDays(today, QUOTE_VALID_DAYS) : ''),
    deliveryDate: d?.deliveryDate ?? '', note: d?.note ?? '', lines: d ? d.lines.map(lineToForm) : [],
  })
}
fill()
watch(() => data.value?.document?.id, fill)
const customerItems = computed(() => (data.value?.customers ?? []).map(c => ({ value: String(c.id), label: c.name })))
const projectItems = computed(() => [{ value: NONE, label: '– kein Projekt –' }, ...(data.value?.projects ?? []).map(p => ({ value: String(p.id), label: p.name }))])
const formError = ref<string | null>(null)

async function save(): Promise<number | null> {
  formError.value = null
  busy.value = 'save'
  try {
    const body = { kind: kind.value, ...form, projectId: form.projectId === NONE ? '' : form.projectId }
    if (isNew.value) {
      const result = await cockpitSend<{ id: number, message: string }>('POST', '/api/erp/sales', body)
      useNotice().ok(result.message)
      await navigateTo(`/erp/sales-document?id=${result.id}`, { replace: true })
      return result.id
    }
    useNotice().ok((await cockpitSend<{ message: string }>('PUT', `/api/erp/sales/${id.value}`, body)).message)
    await refresh()
    return Number(id.value)
  }
  catch (e) {
    formError.value = errorMessage(e)
    return null
  }
  finally {
    busy.value = null
  }
}
async function preview() {
  const tab = window.open('', '_blank')
  const saved = await save()
  if (saved === null) {
    tab?.close()
    return
  }
  if (tab !== null) tab.location.href = `/api/erp/sales/${saved}/preview`
}
async function issue() {
  const saved = await save()
  if (saved !== null && await run('issue', () => cockpitPost(`/api/erp/sales/${saved}/issue`)) !== null) await refresh()
}
async function remove() {
  if (await run('delete', () => cockpitSend('DELETE', `/api/erp/sales/${id.value}`)) !== null) await navigateTo('/erp/sales')
}

const sendTo = ref('')
watch(doc, (d) => { sendTo.value = d?.customerEmail ?? '' }, { immediate: true })
async function send() {
  await run('send', () => cockpitPost(`/api/erp/sales/${id.value}/send`, { to: sendTo.value }))
}
async function decide(status: 'accepted' | 'rejected' | 'sent') {
  if (await run(`decide-${status}`, () => cockpitPost(`/api/erp/sales/${id.value}/decide`, { status })) !== null) await refresh()
}
async function toOrder() {
  const result = await run('order', () => cockpitPost<{ id: number, message: string }>(`/api/erp/sales/${id.value}/order`))
  if (result !== null) await navigateTo(`/erp/sales-document?id=${result.id}`)
}
async function toInvoice() {
  const result = await run('invoice', () => cockpitPost<{ invoiceId: number, message: string }>(`/api/erp/sales/${id.value}/invoice`))
  if (result !== null) await navigateTo(`/erp/invoice?id=${result.invoiceId}`)
}
const statusLabel = computed(() => (kind.value === 'quote' ? QUOTE_STATES : ORDER_STATES)[doc.value?.status ?? 'draft'])
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <NuxtLink to="/erp/sales" class="text-sm text-muted hover:underline">
      ← Angebote & Aufträge
    </NuxtLink>
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold text-highlighted">
        {{ title }} {{ doc?.number ?? (isNew ? '(neu)' : '(Entwurf)') }}
      </h1>
      <UBadge v-if="doc" variant="subtle" color="neutral" :label="statusLabel" />
    </div>
    <p v-if="doc?.quoteNumber" class="text-sm text-muted">
      Aus Angebot <NuxtLink :to="`/erp/sales-document?id=${doc.quoteId}`" class="underline">
        {{ doc.quoteNumber }}
      </NuxtLink>
    </p>

    <UCard v-if="doc === null || doc.status === 'draft'">
      <UAlert v-if="!data.hasSettings" color="warning" variant="subtle" title="Bitte trage zuerst deine Firmendaten unter Einstellungen ein." class="mb-4" />
      <UAlert v-if="formError" color="error" variant="subtle" :title="formError" class="mb-4" role="alert" />
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid gap-3 md:grid-cols-3">
          <UFormField label="Kunde" required>
            <USelect v-model="form.customerId" :items="customerItems" placeholder="Kunde wählen" class="w-full" />
          </UFormField>
          <UFormField label="Projekt" hint="optional">
            <USelect v-model="form.projectId" :items="projectItems" class="w-full" />
          </UFormField>
          <UFormField v-if="kind === 'quote'" label="Gültig bis">
            <UInput v-model="form.validUntil" type="date" class="w-full" />
          </UFormField>
          <UFormField v-else label="Leistung bis" hint="geplantes Ende">
            <UInput v-model="form.deliveryDate" type="date" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Hinweis" hint="optional, steht auf dem Dokument">
          <UTextarea v-model="form.note" :rows="2" :maxlength="2000" autoresize class="w-full" />
        </UFormField>
        <ErpLines v-model="form.lines" :catalog="data.catalog" :small-business="data.smallBusiness" />
        <div class="flex flex-wrap gap-2 border-t border-default pt-4">
          <UButton type="submit" :loading="busy === 'save'">
            Speichern
          </UButton>
          <UButton color="neutral" variant="outline" icon="i-lucide-eye" @click="preview">
            Vorschau (PDF)
          </UButton>
          <UButton color="primary" variant="outline" icon="i-lucide-stamp" :loading="busy === 'issue'" @click="issue">
            Ausstellen
          </UButton>
          <UButton v-if="!isNew" color="error" variant="ghost" icon="i-lucide-trash-2" :loading="busy === 'delete'" @click="remove">
            Löschen
          </UButton>
        </div>
        <p class="text-xs text-muted">
          Ausstellen vergibt die Nummer und speichert das PDF so, wie es verschickt wird. Danach lässt sich das Dokument nicht mehr ändern.
        </p>
      </form>
    </UCard>

    <template v-else>
      <div class="grid gap-4 lg:grid-cols-3">
        <UCard class="lg:col-span-2">
          <p class="text-sm">
            {{ doc.customerName }} · vom {{ day(doc.issueDate) }}
            <span v-if="kind === 'quote'"> · gültig bis {{ day(doc.validUntil) }}</span>
            <span v-else-if="doc.deliveryDate"> · Leistung bis {{ day(doc.deliveryDate) }}</span>
          </p>
          <ul class="mt-3 divide-y divide-default text-sm">
            <li v-for="(l, i) in doc.lines" :key="i" class="py-2">
              <strong>{{ l.name }}</strong>
              <p v-if="l.description" class="whitespace-pre-line text-muted">
                {{ l.description }}
              </p>
              <p class="text-xs text-muted">
                {{ quantity(l.quantityMilli) }} {{ UNITS[l.unit] }} × {{ euro(l.unitPriceCents) }}<span v-if="l.discountBp > 0"> · {{ percentText(l.discountBp) }} % Rabatt</span>
              </p>
            </li>
          </ul>
          <p class="mt-2 text-right font-semibold text-highlighted">
            Gesamt {{ euro(doc.grossCents) }}
          </p>
        </UCard>
        <div class="space-y-4">
          <UCard>
            <UButton :to="`/api/erp/sales/${doc.id}/pdf`" target="_blank" external color="neutral" variant="outline" icon="i-lucide-file-text">
              PDF ansehen
            </UButton>
            <form class="mt-3 space-y-2" @submit.prevent="send">
              <UInput v-model="sendTo" type="email" placeholder="kunde@example.org" class="w-full" aria-label="Empfänger" />
              <UButton type="submit" icon="i-lucide-send" :loading="busy === 'send'">
                Per E-Mail senden
              </UButton>
            </form>
          </UCard>
          <UCard>
            <div class="flex flex-wrap gap-2">
              <template v-if="kind === 'quote' && doc.invoiceId === null">
                <UButton v-if="doc.status !== 'accepted'" size="sm" color="success" variant="outline" :loading="busy === 'decide-accepted'" @click="decide('accepted')">
                  Angenommen
                </UButton>
                <UButton v-if="doc.status !== 'rejected'" size="sm" color="error" variant="outline" :loading="busy === 'decide-rejected'" @click="decide('rejected')">
                  Abgelehnt
                </UButton>
                <UButton v-if="doc.status !== 'sent'" size="sm" color="neutral" variant="ghost" :loading="busy === 'decide-sent'" @click="decide('sent')">
                  Wieder offen
                </UButton>
              </template>
              <UButton v-if="kind === 'quote' && doc.orderId === null && doc.status !== 'rejected'" size="sm" :loading="busy === 'order'" @click="toOrder">
                Auftragsbestätigung erstellen
              </UButton>
              <UButton v-if="doc.orderId !== null" size="sm" color="neutral" variant="outline" :to="`/erp/sales-document?id=${doc.orderId}`">
                Zur Auftragsbestätigung
              </UButton>
              <UButton v-if="doc.invoiceId === null && doc.status !== 'rejected'" size="sm" :loading="busy === 'invoice'" @click="toInvoice">
                Rechnung erstellen
              </UButton>
              <UButton v-else-if="doc.invoiceId !== null" size="sm" color="neutral" variant="outline" :to="`/erp/invoice?id=${doc.invoiceId}`">
                Zur Rechnung {{ doc.invoiceNumber ?? '(Entwurf)' }}
              </UButton>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>

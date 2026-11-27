<script setup lang="ts">
import { MAIL_SENDERS } from '#shared/lib/erp'
import type { CompanySettings } from '#shared/types/erp'

// Own company data, printed on every document and copied into each invoice when it
// is finalized (later changes do not touch issued invoices). Also the logo and the
// e-mail sender and text.
useHead({ title: 'ERP-Einstellungen · Cockpit' })
const { data, refresh } = await useFetch<{ settings: CompanySettings | null, defaultMailText: string }>('/api/erp/settings')
const { busy, run } = useAction()

const form = reactive({
  name: '', contactName: '', street: '', postcode: '', city: '', country: 'DE', email: '', phone: '', website: '',
  taxNumber: '', vatId: '', iban: '', bic: '', bankName: '', smallBusiness: true, paymentDays: '14',
  exemptionReason: '', mailFrom: '', mailFromInvoice: '', mailFromCancellation: '', mailFromReminder: '', mailFromQuote: '',
  mailFromOrder: '', mailText: '',
})
function fill() {
  const s = data.value?.settings
  if (!s) {
    form.mailText = data.value?.defaultMailText ?? ''
    return
  }
  for (const key of Object.keys(form) as (keyof typeof form)[]) {
    const value = s[key as keyof CompanySettings]
    if (key === 'smallBusiness') form.smallBusiness = Boolean(value)
    else if (key === 'paymentDays') form.paymentDays = String(value)
    else (form as Record<string, unknown>)[key] = value ?? ''
  }
  if (form.mailText === '') form.mailText = data.value?.defaultMailText ?? ''
}
fill()

const error = ref<string | null>(null)
async function save() {
  error.value = null
  busy.value = 'save'
  try {
    const result = await cockpitSend<{ message: string }>('PUT', '/api/erp/settings', { ...form, paymentDays: Number(form.paymentDays) })
    useNotice().ok(result.message)
    await refresh()
  }
  catch (e) {
    error.value = errorMessage(e)
  }
  finally {
    busy.value = null
  }
}

// The logo is sent as a file upload (multipart), not as JSON.
const logoVersion = ref(Date.now())
const csrf = computed(() => useCockpitSession().value?.csrf ?? '')
async function uploadLogo(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file === undefined) return
  const body = new FormData()
  body.append('logo', file)
  const result = await run('logo', () => $fetch<{ message: string }>('/api/erp/logo', { method: 'POST', body, headers: { 'X-CSRF-Token': csrf.value } }))
  input.value = ''
  if (result !== null) {
    logoVersion.value = Date.now()
    await refresh()
  }
}
async function removeLogo() {
  if (await run('logo-delete', () => cockpitSend('DELETE', '/api/erp/logo')) !== null) await refresh()
}
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <h1 class="text-2xl font-semibold text-highlighted">
      Einstellungen
    </h1>
    <UAlert v-if="error" color="error" variant="subtle" :title="error" role="alert" />
    <form class="grid gap-4 lg:grid-cols-2" @submit.prevent="save">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Firma
          </h2>
        </template>
        <div class="space-y-3">
          <UFormField label="Name des Unternehmens" required>
            <UInput v-model="form.name" :maxlength="100" class="w-full" />
          </UFormField>
          <UFormField label="Inhaber / Ansprechpartner" hint="optional">
            <UInput v-model="form.contactName" :maxlength="100" class="w-full" />
          </UFormField>
          <UFormField label="Straße und Hausnummer" required>
            <UInput v-model="form.street" :maxlength="100" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-3 gap-3">
            <UFormField label="PLZ" required>
              <UInput v-model="form.postcode" :maxlength="10" class="w-full" />
            </UFormField>
            <UFormField label="Ort" required class="col-span-2">
              <UInput v-model="form.city" :maxlength="100" class="w-full" />
            </UFormField>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="E-Mail" hint="für Rückfragen">
              <UInput v-model="form.email" type="email" class="w-full" />
            </UFormField>
            <UFormField label="Telefon" hint="optional">
              <UInput v-model="form.phone" :maxlength="50" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Website" hint="optional">
            <UInput v-model="form.website" :maxlength="190" class="w-full" />
          </UFormField>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Steuern und Bank
          </h2>
        </template>
        <div class="space-y-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Steuernummer" hint="oder USt-IdNr.">
              <UInput v-model="form.taxNumber" :maxlength="30" class="w-full" />
            </UFormField>
            <UFormField label="USt-IdNr.">
              <UInput v-model="form.vatId" :maxlength="20" placeholder="DE…" class="w-full" />
            </UFormField>
          </div>
          <USwitch v-model="form.smallBusiness" label="Kleinunternehmer nach § 19 UStG (keine Umsatzsteuer)" />
          <UFormField v-if="!form.smallBusiness" label="Befreiungsgrund für Positionen mit 0 %" hint="z. B. Steuerbefreiung nach § 4 Nr. … UStG">
            <UInput v-model="form.exemptionReason" :maxlength="255" class="w-full" />
          </UFormField>
          <UFormField label="Zahlungsziel (Tage)" help="Vorschlag für neue Rechnungen.">
            <UInput v-model="form.paymentDays" type="number" min="0" max="120" class="w-full" />
          </UFormField>
          <UFormField label="IBAN" required>
            <UInput v-model="form.iban" :maxlength="42" class="w-full" />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="BIC" hint="optional">
              <UInput v-model="form.bic" :maxlength="11" class="w-full" />
            </UFormField>
            <UFormField label="Bank" hint="optional">
              <UInput v-model="form.bankName" :maxlength="100" class="w-full" />
            </UFormField>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            E-Mail-Versand
          </h2>
        </template>
        <div class="space-y-3">
          <UFormField label="Absender" help="Muss ein Postfach auf deinem Mailserver sein, z. B. Steuten IT Solutions <rechnung@steuten-it-solutions.de>.">
            <UInput v-model="form.mailFrom" :maxlength="190" class="w-full" />
          </UFormField>
          <!-- Optional own sender per kind of document; empty uses the general sender above. -->
          <fieldset class="space-y-3">
            <legend class="text-sm font-medium text-highlighted">
              Eigener Absender je Beleg
            </legend>
            <p class="text-xs text-muted">
              Leer lassen, dann gilt der Absender oben. Nimm nur Adressen, die dein Mailserver für den Versand erlaubt, sonst landen die Mails im Spam.
            </p>
            <UFormField v-for="sender in MAIL_SENDERS" :key="sender.kind" :label="sender.label" hint="optional">
              <UInput v-model="form[sender.field]" :maxlength="190" :placeholder="form.mailFrom || 'Name <adresse@…>'" class="w-full" />
            </UFormField>
          </fieldset>
          <UFormField label="Text der E-Mail" help="Platzhalter: {dokument}, {nummer}, {betrag}, {faellig}, {absender}">
            <UTextarea v-model="form.mailText" :rows="7" :maxlength="2000" autoresize class="w-full" />
          </UFormField>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Logo
          </h2>
        </template>
        <div class="space-y-3">
          <img v-if="data.settings?.hasLogo" :src="`/api/erp/logo?v=${logoVersion}`" alt="Logo" class="max-h-20 max-w-64 rounded border border-default bg-white p-2">
          <p v-else class="text-sm text-muted">
            Noch kein Logo. Es erscheint oben links auf Rechnungen, Angeboten und Auftragsbestätigungen.
          </p>
          <p class="text-xs text-muted">
            PNG, JPEG oder SVG, höchstens 1 MB. Gedruckt wird es höchstens 70 × 25 mm groß; am besten ein breites Bild mit transparentem oder weißem Hintergrund. Ein SVG wird beim Hochladen in ein scharfes PNG (600 dpi) umgewandelt; Schrift darin am besten vorher in Pfade umwandeln.
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <label class="cursor-pointer">
              <span class="sr-only">Logo hochladen</span>
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,.svg" class="text-sm" :disabled="!data.settings || busy === 'logo'" @change="uploadLogo">
            </label>
            <UButton v-if="data.settings?.hasLogo" size="sm" color="neutral" variant="ghost" :loading="busy === 'logo-delete'" @click="removeLogo">
              Entfernen
            </UButton>
          </div>
          <p v-if="!data.settings" class="text-xs text-muted">
            Speichere zuerst die Firmendaten.
          </p>
        </div>
      </UCard>

      <div class="lg:col-span-2">
        <UButton type="submit" :loading="busy === 'save'">
          Speichern
        </UButton>
      </div>
    </form>
  </div>
</template>

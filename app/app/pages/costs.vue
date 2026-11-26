<script setup lang="ts">
import type { Cost } from '#shared/types/cockpit'
import { type Charge, CHARGE_CATEGORIES, chargeSummary, type CostForm, costToForm, costTotals, CURRENCIES, INTERVALS, money, moneyList } from '#shared/lib/costs'

// Fixed costs entered by hand and the month's Vercel charges (PHP: templates/costs.php).
useHead({ title: 'Kosten · Cockpit' })

interface CostsPage {
  costs: Cost[]
  projects: { id: number, name: string }[]
  vercelConfigured: boolean
  billing: { periodFrom: string | null, periodTo: string | null, syncedAt: string | null, error: string | null, errorAt: string | null } | null
  charges: Charge[]
}

const notice = useNotice()
const { time } = useFormat()
const { data, refresh } = await useFetch<CostsPage>('/api/costs')

const totals = computed(() => costTotals(data.value?.costs ?? []))
const charges = computed(() => chargeSummary(data.value?.charges ?? []))

const empty = (): CostForm => ({ name: '', provider: '', amount: '', currency: 'EUR', interval: 'month', project: '', note: '' })
const form = reactive<CostForm>(empty())
const editId = ref<number | null>(null)
const error = ref<string | null>(null)
const saving = ref(false)

const currencyItems = Object.keys(CURRENCIES)
const intervalItems = Object.entries(INTERVALS).map(([value, label]) => ({ value, label }))
// The select needs a non-empty value for "none"; it is mapped back to '' below.
const NO_PROJECT = 'none'
const projectItems = computed(() => [{ value: NO_PROJECT, label: '– keins –' }, ...(data.value?.projects ?? []).map(p => ({ value: String(p.id), label: p.name }))])
const project = computed({
  get: () => (form.project === '' ? NO_PROJECT : form.project),
  set: (v: string) => { form.project = v === NO_PROJECT ? '' : v },
})

function edit(cost: Cost) {
  Object.assign(form, costToForm(cost))
  editId.value = cost.id
  error.value = null
  document.getElementById('cost-form')?.scrollIntoView({ behavior: 'smooth' })
}

function cancel() {
  Object.assign(form, empty())
  editId.value = null
  error.value = null
}

async function save() {
  saving.value = true
  error.value = null
  try {
    const result = editId.value === null
      ? await cockpitSend<{ message: string }>('POST', '/api/costs', { ...form })
      : await cockpitSend<{ message: string }>('PUT', `/api/costs/${editId.value}`, { ...form })
    notice.ok(result.message)
    cancel()
    await refresh()
  }
  catch (e) {
    // Validation errors stay next to the form, with what was entered.
    error.value = errorMessage(e)
  }
  finally {
    saving.value = false
  }
}

async function remove(cost: Cost) {
  try {
    const result = await cockpitSend<{ message: string }>('DELETE', `/api/costs/${cost.id}`)
    notice.ok(result.message)
    if (editId.value === cost.id) cancel()
  }
  catch (e) {
    notice.fail(e)
  }
  await refresh()
}

/** '2026-11-01' → '01.11.2026'; with `before`, the day before (Vercel's period end is exclusive). */
function day(value: string | null, before = false): string {
  if (value === null) return ''
  const d = new Date(`${value}T00:00:00Z`)
  if (before) d.setUTCDate(d.getUTCDate() - 1)
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
}
</script>

<template>
  <div v-if="data" class="space-y-6">
    <h1 class="text-2xl font-semibold text-highlighted">
      Kosten
    </h1>

    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Feste Kosten
          </h2>
        </template>
        <p v-if="Object.keys(totals).length === 0" class="text-sm text-muted">
          Noch keine Einträge.
        </p>
        <template v-else>
          <dl class="space-y-1 text-sm">
            <div v-for="(t, currency) in totals" :key="currency">
              <dt class="text-muted">
                Summe {{ currency }}
              </dt>
              <dd><strong>{{ money(t.month, String(currency)) }}</strong> pro Monat · {{ money(t.year, String(currency)) }} pro Jahr</dd>
            </div>
          </dl>
          <p v-if="Object.keys(totals).length > 1" class="mt-1 text-xs text-muted">
            Währungen werden nicht umgerechnet.
          </p>
          <ul class="mt-4 divide-y divide-default">
            <li v-for="c in data.costs" :key="c.id" class="flex flex-wrap items-start justify-between gap-2 py-2">
              <div class="text-sm">
                <strong>{{ c.name }}</strong>
                <span class="ml-1 text-muted">{{ money(c.amountCents, c.currency) }} {{ INTERVALS[c.billingInterval] ?? c.billingInterval }}</span>
                <p class="text-xs text-muted">
                  {{ [c.provider, c.projectName !== null ? `Projekt ${c.projectName}` : null, c.note].filter(v => v !== null).join(' · ') }}
                </p>
              </div>
              <div class="flex gap-2">
                <UButton size="xs" color="neutral" variant="outline" :aria-label="`${c.name} bearbeiten`" @click="edit(c)">
                  Bearbeiten
                </UButton>
                <UButton size="xs" color="neutral" variant="outline" :aria-label="`${c.name} löschen`" @click="remove(c)">
                  Löschen
                </UButton>
              </div>
            </li>
          </ul>
        </template>
      </UCard>

      <UCard id="cost-form">
        <template #header>
          <h2 class="font-semibold text-highlighted">
            {{ editId !== null ? 'Eintrag bearbeiten' : 'Eintrag hinzufügen' }}
          </h2>
        </template>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" role="alert" />
        <form class="space-y-3" @submit.prevent="save">
          <UFormField label="Name" required>
            <UInput v-model="form.name" :maxlength="100" placeholder="z. B. Domain steuten-it-solutions.de" class="w-full" />
          </UFormField>
          <UFormField label="Anbieter" hint="optional">
            <UInput v-model="form.provider" :maxlength="100" placeholder="z. B. IONOS" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-3 gap-3">
            <UFormField label="Betrag" required>
              <UInput v-model="form.amount" inputmode="decimal" placeholder="12,99" class="w-full" />
            </UFormField>
            <UFormField label="Währung">
              <USelect v-model="form.currency" :items="currencyItems" class="w-full" />
            </UFormField>
            <UFormField label="Intervall">
              <USelect v-model="form.interval" :items="intervalItems" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Projekt" hint="optional">
            <USelect v-model="project" :items="projectItems" class="w-full" />
          </UFormField>
          <UFormField label="Notiz" hint="optional">
            <UInput v-model="form.note" :maxlength="255" placeholder="z. B. verlängert sich am 1. März" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :loading="saving">
              {{ editId !== null ? 'Speichern' : 'Hinzufügen' }}
            </UButton>
            <UButton v-if="editId !== null" color="neutral" variant="ghost" @click="cancel">
              Abbrechen
            </UButton>
          </div>
        </form>
      </UCard>
    </div>

    <template v-if="data.vercelConfigured">
      <h2 class="text-lg font-semibold text-highlighted">
        Vercel
      </h2>
      <UCard>
        <p v-if="data.billing === null" class="text-sm text-muted">
          Noch kein Abruf. Die Kosten erscheinen nach dem nächsten Lauf der Hintergrundjobs.
        </p>
        <template v-else>
          <p v-if="data.billing.error !== null" class="mb-2 text-sm text-error">
            Letzter Abruf fehlgeschlagen ({{ time(data.billing.errorAt) }}): {{ data.billing.error }}
          </p>
          <p v-if="data.billing.syncedAt === null" class="text-sm text-muted">
            Noch keine Daten von Vercel.
          </p>
          <template v-else>
            <p class="text-sm text-muted">
              Zeitraum {{ day(data.billing.periodFrom) }} – {{ day(data.billing.periodTo, true) }} (UTC) · Stand {{ time(data.billing.syncedAt) }}
            </p>
            <dl class="mt-3 space-y-1 text-sm">
              <div>
                <dt class="text-muted">
                  Summe
                </dt>
                <dd><strong>{{ Object.keys(charges.total).length === 0 ? 'keine Posten' : moneyList(charges.total) }}</strong></dd>
              </div>
              <div v-for="[category, amounts] in charges.byCategory" :key="category">
                <dt class="text-muted">
                  {{ CHARGE_CATEGORIES[category] ?? category }}
                </dt>
                <dd>{{ moneyList(amounts) }}</dd>
              </div>
            </dl>
            <p class="mt-2 text-xs text-muted">
              Summen der Posten, die Vercel über die Abrechnungs-API meldet (BilledCost). Maßgeblich bleibt die Rechnung im Vercel-Dashboard.
            </p>
            <div class="mt-4 grid gap-4 md:grid-cols-2">
              <div v-if="charges.byService.length > 0">
                <h3 class="mb-1 font-medium text-highlighted">
                  Nach Dienst
                </h3>
                <ul class="divide-y divide-default text-sm">
                  <li v-for="[service, amounts] in charges.byService" :key="service" class="flex justify-between gap-4 py-1">
                    <span>{{ service }}</span><span>{{ moneyList(amounts) }}</span>
                  </li>
                </ul>
              </div>
              <div v-if="charges.byProject.length > 0">
                <h3 class="mb-1 font-medium text-highlighted">
                  Nach Projekt
                </h3>
                <ul class="divide-y divide-default text-sm">
                  <li v-for="[name, amounts] in charges.byProject" :key="name" class="flex justify-between gap-4 py-1">
                    <span>{{ name }}</span><span>{{ moneyList(amounts) }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </template>
        </template>
      </UCard>
    </template>
  </div>
</template>

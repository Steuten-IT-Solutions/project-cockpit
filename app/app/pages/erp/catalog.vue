<script setup lang="ts">
import { euro, priceText, UNITS, VAT_RATES } from '#shared/lib/erp'
import type { CatalogItem } from '#shared/types/erp'

// Products and services offered again and again. A position copies name, unit and
// price from here; changing the catalog later does not change existing documents.
useHead({ title: 'Katalog · Cockpit' })
const { data, refresh } = await useFetch<{ catalog: CatalogItem[], smallBusiness: boolean }>('/api/erp/catalog')
const { busy, run } = useAction()

const empty = () => ({ name: '', description: '', unit: 'HUR', price: '', vatRate: data.value?.smallBusiness === false ? 19 : 0 })
const form = reactive(empty())
const editId = ref<number | null>(null)
const error = ref<string | null>(null)
const showArchived = ref(false)
const unitItems = Object.entries(UNITS).map(([value, label]) => ({ value, label }))
const vatItems = computed(() => (data.value?.smallBusiness !== false ? [0] : [...VAT_RATES]).map(r => ({ value: r, label: `${r} %` })))
const list = computed(() => (data.value?.catalog ?? []).filter(c => showArchived.value || !c.archived))

function edit(c: CatalogItem) {
  Object.assign(form, { name: c.name, description: c.description ?? '', unit: c.unit, price: priceText(c.unitPriceCents), vatRate: c.vatRate })
  editId.value = c.id
  error.value = null
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
    const result = editId.value === null
      ? await cockpitSend<{ message: string }>('POST', '/api/erp/catalog', { ...form })
      : await cockpitSend<{ message: string }>('PUT', `/api/erp/catalog/${editId.value}`, { ...form })
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

async function archive(c: CatalogItem) {
  if (await run(`archive-${c.id}`, () => cockpitPost(`/api/erp/catalog/${c.id}/archive`, { archived: !c.archived })) !== null) await refresh()
}
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <h1 class="text-2xl font-semibold text-highlighted">
      Katalog
    </h1>
    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <div class="mb-2 flex justify-end">
          <USwitch v-model="showArchived" label="Archivierte zeigen" />
        </div>
        <p v-if="list.length === 0" class="text-sm text-muted">
          Noch keine Einträge, z. B. „Stundensatz Entwicklung“ oder „Hosting-Paket“.
        </p>
        <ul v-else class="divide-y divide-default">
          <li v-for="c in list" :key="c.id" class="flex flex-wrap items-start justify-between gap-2 py-2">
            <div class="text-sm" :class="c.archived ? 'opacity-60' : ''">
              <strong>{{ c.name }}</strong>
              <span class="ml-1 text-muted">{{ euro(c.unitPriceCents) }} / {{ UNITS[c.unit] }}<span v-if="!data.smallBusiness"> · {{ c.vatRate }} %</span></span>
              <p v-if="c.description" class="whitespace-pre-line text-xs text-muted">
                {{ c.description }}
              </p>
            </div>
            <div class="flex gap-2">
              <UButton size="xs" color="neutral" variant="outline" @click="edit(c)">
                Bearbeiten
              </UButton>
              <UButton size="xs" color="neutral" variant="ghost" :loading="busy === `archive-${c.id}`" @click="archive(c)">
                {{ c.archived ? 'Aktivieren' : 'Archivieren' }}
              </UButton>
            </div>
          </li>
        </ul>
      </UCard>
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            {{ editId !== null ? 'Eintrag bearbeiten' : 'Eintrag anlegen' }}
          </h2>
        </template>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" role="alert" />
        <form class="space-y-3" @submit.prevent="save">
          <UFormField label="Bezeichnung" required>
            <UInput v-model="form.name" :maxlength="150" class="w-full" />
          </UFormField>
          <UFormField label="Beschreibung" hint="optional">
            <UTextarea v-model="form.description" :maxlength="500" :rows="2" autoresize class="w-full" />
          </UFormField>
          <div class="grid grid-cols-3 gap-3">
            <UFormField label="Preis (€)" required>
              <UInput v-model="form.price" inputmode="decimal" placeholder="90,00" class="w-full" />
            </UFormField>
            <UFormField label="Einheit">
              <USelect v-model="form.unit" :items="unitItems" class="w-full" />
            </UFormField>
            <UFormField label="USt.">
              <USelect v-model="form.vatRate" :items="vatItems" class="w-full" />
            </UFormField>
          </div>
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
  </div>
</template>

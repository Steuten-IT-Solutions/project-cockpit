<script setup lang="ts">
import { CUSTOMER_KINDS } from '#shared/lib/erp'
import type { Choice, Customer } from '#shared/types/erp'

// Customers: German businesses and private persons. Archived instead of deleted,
// because invoices keep referring to them.
useHead({ title: 'Kunden · Cockpit' })
const { data, refresh } = await useFetch<{ customers: Customer[], projects: Choice[] }>('/api/erp/customers')
const { busy, run } = useAction()

const NONE = 'none'
const empty = () => ({ kind: 'business', name: '', contactName: '', street: '', postcode: '', city: '', country: 'DE', email: '', vatId: '', projectId: NONE, note: '' })
const form = reactive(empty())
const editId = ref<number | null>(null)
const error = ref<string | null>(null)
const showArchived = ref(false)

const kindItems = Object.entries(CUSTOMER_KINDS).map(([value, label]) => ({ value, label }))
const projectItems = computed(() => [{ value: NONE, label: '– keins –' }, ...(data.value?.projects ?? []).map(p => ({ value: String(p.id), label: p.name }))])
const list = computed(() => (data.value?.customers ?? []).filter(c => showArchived.value || !c.archived))

function edit(c: Customer) {
  Object.assign(form, {
    kind: c.kind, name: c.name, contactName: c.contactName ?? '', street: c.street, postcode: c.postcode, city: c.city, country: c.country,
    email: c.email ?? '', vatId: c.vatId ?? '', projectId: c.projectId !== null ? String(c.projectId) : NONE, note: c.note ?? '',
  })
  editId.value = c.id
  error.value = null
  document.getElementById('customer-form')?.scrollIntoView({ behavior: 'smooth' })
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
      ? await cockpitSend<{ message: string }>('POST', '/api/erp/customers', body)
      : await cockpitSend<{ message: string }>('PUT', `/api/erp/customers/${editId.value}`, body)
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

async function archive(c: Customer) {
  if (await run(`archive-${c.id}`, () => cockpitPost(`/api/erp/customers/${c.id}/archive`, { archived: !c.archived })) !== null) await refresh()
}
</script>

<template>
  <div v-if="data" class="space-y-4">
    <ErpNav />
    <h1 class="text-2xl font-semibold text-highlighted">
      Kunden
    </h1>
    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <div class="mb-2 flex justify-end">
          <USwitch v-model="showArchived" label="Archivierte zeigen" />
        </div>
        <p v-if="list.length === 0" class="text-sm text-muted">
          Noch keine Kunden.
        </p>
        <ul v-else class="divide-y divide-default">
          <li v-for="c in list" :key="c.id" class="flex flex-wrap items-start justify-between gap-2 py-2">
            <div class="text-sm" :class="c.archived ? 'opacity-60' : ''">
              <strong>{{ c.name }}</strong>
              <span class="ml-1 text-xs text-muted">{{ CUSTOMER_KINDS[c.kind] }}</span>
              <p class="text-xs text-muted">
                {{ [c.contactName, `${c.street}, ${c.postcode} ${c.city}`, c.email, c.vatId].filter(v => v).join(' · ') }}
              </p>
            </div>
            <div class="flex gap-2">
              <UButton size="xs" color="neutral" variant="outline" :to="`/erp/invoice?id=new&customer=${c.id}`" :disabled="c.archived">
                Rechnung
              </UButton>
              <UButton size="xs" color="neutral" variant="outline" :aria-label="`${c.name} bearbeiten`" @click="edit(c)">
                Bearbeiten
              </UButton>
              <UButton size="xs" color="neutral" variant="ghost" :loading="busy === `archive-${c.id}`" @click="archive(c)">
                {{ c.archived ? 'Aktivieren' : 'Archivieren' }}
              </UButton>
            </div>
          </li>
        </ul>
      </UCard>

      <UCard id="customer-form">
        <template #header>
          <h2 class="font-semibold text-highlighted">
            {{ editId !== null ? 'Kunden bearbeiten' : 'Kunden anlegen' }}
          </h2>
        </template>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" role="alert" />
        <form class="space-y-3" @submit.prevent="save">
          <UFormField label="Art">
            <USelect v-model="form.kind" :items="kindItems" class="w-full" />
          </UFormField>
          <UFormField :label="form.kind === 'business' ? 'Firma' : 'Name'" required>
            <UInput v-model="form.name" :maxlength="100" class="w-full" />
          </UFormField>
          <UFormField v-if="form.kind === 'business'" label="Ansprechpartner" hint="optional">
            <UInput v-model="form.contactName" :maxlength="100" class="w-full" />
          </UFormField>
          <UFormField label="Straße und Hausnummer" required>
            <UInput v-model="form.street" :maxlength="100" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-3 gap-3">
            <UFormField label="PLZ" required>
              <UInput v-model="form.postcode" :maxlength="10" inputmode="numeric" class="w-full" />
            </UFormField>
            <UFormField label="Ort" required class="col-span-2">
              <UInput v-model="form.city" :maxlength="100" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="E-Mail für Rechnungen" hint="optional">
            <UInput v-model="form.email" type="email" :maxlength="190" class="w-full" />
          </UFormField>
          <UFormField v-if="form.kind === 'business'" label="USt-IdNr." hint="optional">
            <UInput v-model="form.vatId" :maxlength="20" placeholder="DE123456789" class="w-full" />
          </UFormField>
          <UFormField label="Projekt" hint="optional, wird bei neuen Rechnungen vorgeschlagen">
            <USelect v-model="form.projectId" :items="projectItems" class="w-full" />
          </UFormField>
          <UFormField label="Notiz" hint="optional">
            <UInput v-model="form.note" :maxlength="255" class="w-full" />
          </UFormField>
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

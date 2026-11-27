<script setup lang="ts">
import { parseAmount } from '#shared/lib/costs'
import { euro, type Line, lineFromForm, type LineForm, lineNet, parseQuantity, priceText, totals, UNITS, VAT_RATES } from '#shared/lib/erp'
import type { CatalogItem } from '#shared/types/erp'

// The positions of an invoice, quote, order or recurring invoice. The totals are
// computed here with the same rules as on the server (shared/lib/erp.ts), so what
// is shown while typing is what will be printed.
const lines = defineModel<LineForm[]>({ required: true })
const props = defineProps<{ catalog: CatalogItem[], smallBusiness: boolean }>()

const unitItems = Object.entries(UNITS).map(([value, label]) => ({ value, label }))
const vatItems = computed(() => (props.smallBusiness ? [0] : [...VAT_RATES]).map(rate => ({ value: rate, label: `${rate} %` })))
const catalogItems = computed(() => props.catalog.map(c => ({ value: c.id, label: `${c.name} · ${euro(c.unitPriceCents)}` })))
const pick = ref<number | undefined>(undefined)

function add(item?: CatalogItem) {
  const vat = props.smallBusiness ? 0 : (item?.vatRate ?? 19)
  lines.value.push(item
    ? { name: item.name, description: item.description ?? '', quantity: '1', unit: item.unit, price: priceText(item.unitPriceCents), vatRate: vat }
    : { name: '', description: '', quantity: '1', unit: 'HUR', price: '', vatRate: vat })
}

watch(pick, (id) => {
  const item = props.catalog.find(c => c.id === id)
  if (item !== undefined) {
    add(item)
    pick.value = undefined
  }
})

function move(i: number, step: number) {
  const target = i + step
  if (target < 0 || target >= lines.value.length) return
  const [line] = lines.value.splice(i, 1)
  lines.value.splice(target, 0, line!)
}

function lineSum(line: LineForm): string {
  const q = parseQuantity(line.quantity)
  const p = parseAmount(line.price)
  return q === null || p === null ? '–' : euro(lineNet({ quantityMilli: q, unitPriceCents: p }))
}

const sum = computed(() => totals(lines.value
  .map((l, i) => lineFromForm(l, i + 1, props.smallBusiness))
  .filter((l): l is Line => typeof l !== 'string')))
</script>

<template>
  <div class="space-y-3">
    <div v-for="(line, i) in lines" :key="i" class="space-y-2 rounded-md border border-default p-3">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium text-highlighted">Position {{ i + 1 }}</span>
        <div class="flex gap-1">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="`Position ${i + 1} nach oben`" :disabled="i === 0" @click="move(i, -1)" />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="`Position ${i + 1} nach unten`" :disabled="i === lines.length - 1" @click="move(i, 1)" />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="`Position ${i + 1} entfernen`" @click="lines.splice(i, 1)" />
        </div>
      </div>
      <UFormField label="Bezeichnung" required>
        <UInput v-model="line.name" :maxlength="150" class="w-full" />
      </UFormField>
      <UFormField label="Beschreibung" hint="optional">
        <UTextarea v-model="line.description" :maxlength="500" :rows="2" autoresize class="w-full" />
      </UFormField>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <UFormField label="Menge">
          <UInput v-model="line.quantity" inputmode="decimal" class="w-full" />
        </UFormField>
        <UFormField label="Einheit">
          <USelect v-model="line.unit" :items="unitItems" class="w-full" />
        </UFormField>
        <UFormField label="Einzelpreis (€)">
          <UInput v-model="line.price" inputmode="decimal" placeholder="90,00" class="w-full" />
        </UFormField>
        <UFormField label="USt.">
          <USelect v-model="line.vatRate" :items="vatItems" class="w-full" />
        </UFormField>
        <div class="col-span-2 text-right text-sm sm:col-span-1 sm:pt-7">
          <span class="text-muted">Netto </span><strong>{{ lineSum(line) }}</strong>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="add()">
        Position
      </UButton>
      <USelect v-if="catalogItems.length > 0" v-model="pick" :items="catalogItems" placeholder="Artikel übernehmen …" class="w-64" />
    </div>

    <dl class="ml-auto max-w-xs space-y-1 text-sm">
      <div class="flex justify-between gap-4">
        <dt class="text-muted">
          Netto
        </dt>
        <dd>{{ euro(sum.net) }}</dd>
      </div>
      <div v-for="g in sum.groups.filter(g => g.rate > 0)" :key="g.rate" class="flex justify-between gap-4">
        <dt class="text-muted">
          USt. {{ g.rate }} %
        </dt>
        <dd>{{ euro(g.tax) }}</dd>
      </div>
      <div class="flex justify-between gap-4 font-semibold text-highlighted">
        <dt>Gesamt</dt>
        <dd>{{ euro(sum.gross) }}</dd>
      </div>
    </dl>
  </div>
</template>

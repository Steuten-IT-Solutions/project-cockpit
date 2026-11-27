<script setup lang="ts">
import { parseAmount } from '#shared/lib/costs'
import { CURRENCIES, euro, euroParts } from '#shared/lib/erp'

// The currency of an incoming invoice. For another one than euros, net and tax are typed
// as printed on the invoice, and the amount in euros is entered here, e.g. as debited
// from the bank account. That euro amount goes into the books; it is split into net and
// tax in the proportion of the invoice's own amounts.
const currency = defineModel<string>('currency', { required: true })
const euroGross = defineModel<string>('euroGross', { required: true })
const props = defineProps<{ net: string, tax: string, disabled?: boolean }>()

const items = Object.entries(CURRENCIES).map(([value, label]) => ({ value, label }))
const foreign = computed(() => currency.value !== 'EUR')
watch(currency, (c) => {
  if (c === 'EUR') euroGross.value = ''
})

const preview = computed(() => {
  const total = parseAmount(euroGross.value)
  const net = parseAmount(props.net)
  const tax = parseAmount(props.tax || '0')
  if (!foreign.value || total === null || total === 0 || net === null || tax === null) return null
  const parts = euroParts(total, net, tax)
  const rate = (net + tax) / total
  return `Im Cockpit: netto ${euro(parts.netCents)}, USt ${euro(parts.taxCents)} (entspricht 1 € = ${rate.toFixed(4).replace('.', ',')} ${currency.value})`
})
</script>

<template>
  <div class="space-y-2">
    <USelect v-model="currency" :items="items" class="w-full" :disabled="disabled" aria-label="Währung" />
    <template v-if="foreign">
      <UFormField label="Betrag in Euro (brutto)" hint="z. B. laut Kontoauszug">
        <UInput v-model="euroGross" inputmode="decimal" class="w-full" :disabled="disabled" />
      </UFormField>
      <p v-if="preview" class="text-xs text-muted">
        {{ preview }}
      </p>
    </template>
  </div>
</template>

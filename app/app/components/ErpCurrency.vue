<script setup lang="ts">
import { parseAmount } from '#shared/lib/costs'
import { CURRENCIES, day, euro, parseRate, rateText, toEuroCents } from '#shared/lib/erp'

// The currency of an incoming invoice. For another one than euros, net and tax are typed
// as printed on the invoice; the cockpit converts them with the rate (units per euro, as
// the European Central Bank quotes it) and keeps the euro amounts in the books. The ECB
// rate of the invoice date is filled in by itself and can be overwritten, e.g. with the
// rate on the bank statement.
const currency = defineModel<string>('currency', { required: true })
const rate = defineModel<string>('rate', { required: true })
const props = defineProps<{ issueDate: string, net: string, tax: string, disabled?: boolean }>()

const items = Object.entries(CURRENCIES).map(([value, label]) => ({ value, label }))
const foreign = computed(() => currency.value !== 'EUR')
const ecbDate = ref<string | null>(null)
const problem = ref<string | null>(null)
const loading = ref(false)

async function fetchRate() {
  if (!foreign.value || props.issueDate === '') return
  loading.value = true
  problem.value = null
  try {
    const result = await $fetch<{ rate: { rate: number, date: string } | null }>('/api/erp/exchange-rate', { query: { currency: currency.value, date: props.issueDate } })
    if (result.rate === null) problem.value = 'Die EZB hat für dieses Datum keinen Kurs. Bitte trage ihn selbst ein.'
    else {
      rate.value = rateText(result.rate.rate)
      ecbDate.value = result.rate.date
    }
  }
  catch (e) {
    problem.value = errorMessage(e)
  }
  finally {
    loading.value = false
  }
}
// A new currency or date asks for the rate again, unless one was typed in by hand.
watch([currency, () => props.issueDate], () => {
  if (foreign.value && (rate.value === '' || ecbDate.value !== null)) void fetchRate()
  if (!foreign.value) {
    rate.value = ''
    ecbDate.value = null
  }
})

const preview = computed(() => {
  const r = parseRate(rate.value)
  const net = parseAmount(props.net)
  const tax = parseAmount(props.tax || '0')
  if (!foreign.value || r === null || net === null || tax === null) return null
  const n = toEuroCents(net, r)
  const t = toEuroCents(tax, r)
  return `In Euro: netto ${euro(n)}, USt ${euro(t)}, brutto ${euro(n + t)}`
})
</script>

<template>
  <div class="space-y-2">
    <USelect v-model="currency" :items="items" class="w-full" :disabled="disabled" aria-label="Währung" />
    <template v-if="foreign">
      <div class="flex items-center gap-2">
        <UInput v-model="rate" inputmode="decimal" class="min-w-0 flex-1" :disabled="disabled" :aria-label="`${currency} je 1 Euro`" @update:model-value="ecbDate = null">
          <template #leading>
            <span class="text-xs text-muted">1 € =</span>
          </template>
          <template #trailing>
            <span class="text-xs text-muted">{{ currency }}</span>
          </template>
        </UInput>
        <UButton v-if="!disabled" size="xs" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="loading" :disabled="issueDate === ''" @click="fetchRate">
          EZB-Kurs
        </UButton>
      </div>
      <p v-if="ecbDate" class="text-xs text-muted">
        Referenzkurs der EZB vom {{ day(ecbDate) }}.
      </p>
      <p v-if="problem" class="text-xs text-warning">
        {{ problem }}
      </p>
      <p v-if="preview" class="text-xs text-muted">
        {{ preview }}
      </p>
    </template>
  </div>
</template>

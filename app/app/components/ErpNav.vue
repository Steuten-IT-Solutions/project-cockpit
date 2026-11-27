<script setup lang="ts">
// The ERP's own navigation, shown above every ERP page.
const LINKS = [
  { to: '/erp', label: 'Übersicht' },
  { to: '/erp/invoices', label: 'Rechnungen' },
  { to: '/erp/sales', label: 'Angebote & Aufträge' },
  { to: '/erp/time', label: 'Zeiten' },
  { to: '/erp/subscriptions', label: 'Wiederkehrend' },
  { to: '/erp/incoming', label: 'Eingangsrechnungen' },
  { to: '/erp/customers', label: 'Kunden' },
  { to: '/erp/articles', label: 'Artikel' },
  { to: '/erp/reports', label: 'Auswertung' },
  { to: '/erp/settings', label: 'Einstellungen' },
]
const route = useRoute()
// /erp/invoice belongs to "Rechnungen", /erp/sales-document to "Angebote & Aufträge" and so on.
const SECTIONS: Record<string, string> = { '/erp/invoice': '/erp/invoices', '/erp/sales-document': '/erp/sales', '/erp/incoming-invoice': '/erp/incoming' }
const active = computed(() => SECTIONS[route.path] ?? route.path)
</script>

<template>
  <nav class="-mx-4 mb-4 overflow-x-auto border-b border-default px-4" aria-label="ERP">
    <ul class="flex gap-4 whitespace-nowrap pb-2 text-sm">
      <li v-for="link in LINKS" :key="link.to">
        <NuxtLink
          :to="link.to"
          class="hover:text-highlighted"
          :class="active === link.to ? 'font-medium text-highlighted' : 'text-muted'"
          :aria-current="active === link.to ? 'page' : undefined"
        >
          {{ link.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

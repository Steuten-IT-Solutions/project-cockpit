<script setup lang="ts">
import type { Alert } from '#shared/types/cockpit'
import { alertLabel, companyName, variantLabel } from '#shared/lib/status'

// Open and recently resolved alerts plus the notification settings (PHP: templates/alerts.php).
useHead({ title: 'Warnungen · Cockpit' })

interface AlertsPage {
  alerts: Alert[]
  statusReceiver: boolean
  emailTo: string | null
  pushConfigured: boolean
  pushKey: string | null
  subscriptions: { createdAt: string, lastError: string | null }[]
}

const { time } = useFormat()
const { data } = await useFetch<AlertsPage>('/api/alerts')
const open = computed(() => (data.value?.alerts ?? []).filter(a => a.resolvedAt === null))
const closed = computed(() => (data.value?.alerts ?? []).filter(a => a.resolvedAt !== null))
</script>

<template>
  <div v-if="data" class="space-y-4">
    <h1 class="text-2xl font-semibold text-highlighted">
      Warnungen
    </h1>
    <UAlert
      v-if="!data.statusReceiver"
      color="info"
      variant="subtle"
      title="Der Empfang der Statusmeldungen ist nicht eingeschaltet (NUXT_STATUS_REPORTS_ORG)."
    />

    <UCard>
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Offen
        </h2>
      </template>
      <p v-if="open.length === 0" class="text-sm text-muted">
        Keine offenen Warnungen.
      </p>
      <ul v-else class="divide-y divide-default text-sm">
        <li v-for="a in open" :key="a.id" class="flex flex-wrap justify-between gap-2 py-2">
          <div>
            <p class="flex flex-wrap items-center gap-1.5">
              <ToneBadge :label="alertLabel(a.alertKey)" tone="fail" />
              <NuxtLink v-if="a.installationId !== null" :to="{ path: '/installation', query: { id: a.installationId } }" class="text-primary hover:underline">
                {{ companyName(a.kompanie) }}
              </NuxtLink>
              <span v-else>Alle Kompanien</span>
              <span v-if="a.variant !== null">· {{ variantLabel(a.variant) }}</span>
            </p>
            <p class="text-xs text-muted">
              {{ a.detail }}
            </p>
          </div>
          <time class="text-muted">seit {{ time(a.openedAt) }}</time>
        </li>
      </ul>
    </UCard>

    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Behoben (30 Tage)
          </h2>
        </template>
        <p v-if="closed.length === 0" class="text-sm text-muted">
          Keine.
        </p>
        <ul v-else class="divide-y divide-default text-sm">
          <li v-for="a in closed" :key="a.id" class="flex flex-wrap justify-between gap-2 py-1.5">
            <span>{{ alertLabel(a.alertKey) }} · {{ a.kompanie === '*' ? 'Alle Kompanien' : companyName(a.kompanie) }}</span>
            <time class="text-muted">{{ time(a.openedAt) }} – {{ time(a.resolvedAt) }}</time>
          </li>
        </ul>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Benachrichtigungen
          </h2>
        </template>
        <dl class="space-y-3 text-sm">
          <div>
            <dt class="text-muted">
              E-Mail
            </dt>
            <dd>
              <template v-if="data.emailTo !== null">
                {{ data.emailTo }}
              </template>
              <span v-else class="text-muted">nicht eingerichtet (NUXT_ALERTS_EMAIL)</span>
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              Push
            </dt>
            <dd>
              <span v-if="!data.pushConfigured" class="text-muted">nicht eingerichtet (NUXT_PUSH_PRIVATE_KEY_FILE)</span>
              <ToneBadge v-else-if="data.pushKey === null" label="VAPID-Schlüssel fehlt oder ist ungültig" tone="warn" />
              <template v-else>
                {{ data.subscriptions.length }} Gerät(e) angemeldet
                <ClientOnly>
                  <PushToggle :public-key="data.pushKey" />
                </ClientOnly>
                <template v-for="(s, n) in data.subscriptions" :key="n">
                  <p v-if="s.lastError !== null" class="text-xs text-error">
                    Gerät seit {{ time(s.createdAt) }}: {{ s.lastError }}
                  </p>
                </template>
              </template>
            </dd>
          </div>
        </dl>
        <p class="mt-3 text-xs text-muted">
          Eine Nachricht, wenn eine Warnung entsteht, und eine, wenn sie behoben ist; keine Wiederholung, solange sie offen ist.
          Auf dem iPhone geht Push erst, wenn das Cockpit zum Home-Bildschirm hinzugefügt ist.
        </p>
      </UCard>
    </div>
  </div>
</template>

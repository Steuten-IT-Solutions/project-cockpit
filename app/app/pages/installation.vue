<script setup lang="ts">
import type { Alert, Installation } from '#shared/types/cockpit'
import type { Tone } from '#shared/lib/projects'
import { alertLabel, causes, checkLabel, codeLabel, companyName, cronLabel, figure, usageAreas, usageBars, variantLabel } from '#shared/lib/status'

// One installation of a company app (PHP: templates/installation.php). URL /installation?id=…
// stays the same, because alert e-mails link to it.

interface InstallationPage {
  now: number
  installation: Installation
  history: { type: 'heartbeat' | 'event', receivedAt: string, version: string, code: string | null, detail: string | null, checks: Record<string, string>, errors: Record<string, number> }[]
  alerts: Alert[]
  usage: { users: number, d1: number, d7: number, d30: number, areas: Record<string, number> } | null
  usageDays: { day: string, users: number, d1: number, d7: number, d30: number }[]
}

const route = useRoute()
const { time } = useFormat()
const { data, error } = await useFetch<InstallationPage>(() => `/api/installations/${encodeURIComponent(String(route.query.id ?? ''))}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Diese Seite gibt es nicht.', fatal: true })
}
useHead({ title: computed(() => `${data.value ? companyName(data.value.installation.kompanie) : 'Installation'} · Cockpit`) })

const LEVEL_TONES: Record<string, Tone> = { ok: 'ok', warn: 'warn', error: 'fail' }
const bars = computed(() => data.value ? usageBars(data.value.usageDays, new Date(data.value.now * 1000).toISOString().slice(0, 10)) : [])
const sum = (errors: Record<string, number>) => Object.values(errors).reduce((a, b) => a + b, 0)
</script>

<template>
  <div v-if="data" class="space-y-4">
    <NuxtLink to="/#installationen" class="text-sm text-muted hover:underline">
      ← Alle Installationen
    </NuxtLink>
    <div>
      <h1 class="text-2xl font-semibold text-highlighted">
        {{ companyName(data.installation.kompanie) }}
      </h1>
      <p class="text-sm text-muted">
        {{ variantLabel(data.installation.variant) }} · Version {{ data.installation.version }} · PHP {{ data.installation.php }} / {{ data.installation.dbDriver }}
        · Installation <code>{{ data.installation.id.slice(0, 8) }}</code>
      </p>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Zustand
          </h2>
        </template>
        <p v-if="data.installation.maintenance" class="mb-3 text-sm">
          <ToneBadge label="in Wartung" tone="neutral" />
          Ein Admin hat die App gesperrt; Hintergrundaufgaben pausieren, rote Ampeln lösen keine Warnung aus.
        </p>
        <div class="mb-3 flex flex-wrap gap-1.5">
          <ToneBadge v-for="(level, key) in data.installation.checks" :key="key" :label="checkLabel(String(key))" :tone="LEVEL_TONES[level] ?? 'neutral'" />
        </div>
        <dl class="space-y-2 text-sm">
          <div>
            <dt class="text-muted">
              Letztes Lebenszeichen
            </dt>
            <dd>{{ time(data.installation.lastHeartbeat) }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              Hintergrundaufgaben
            </dt>
            <dd>{{ cronLabel(data.installation.cronKind) }}, zuletzt {{ time(data.installation.cronLast) }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              Fehler (24 Stunden)
            </dt>
            <dd>
              <template v-if="Object.keys(data.installation.errors).length === 0">
                keine
              </template>
              <p v-for="(count, code) in data.installation.errors" :key="code">
                {{ codeLabel(String(code)) }}: {{ count }}
                <small v-if="Object.keys(data.installation.details[code] ?? {}).length > 0" class="text-muted">({{ causes(data.installation.details[code]!) }})</small>
              </p>
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              Bereiche
            </dt>
            <dd>{{ data.installation.features.length === 0 ? '–' : data.installation.features.join(', ') }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              Letztes Update
            </dt>
            <dd>
              <template v-if="data.installation.updateAt !== null">
                {{ data.installation.updateOk ? 'ok' : 'gescheitert' }}{{ data.installation.updateTo !== null ? ` (${data.installation.updateTo})` : '' }}, {{ time(data.installation.updateAt) }}
              </template>
              <template v-else>
                –
              </template>
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              Erste Meldung
            </dt>
            <dd>{{ time(data.installation.firstSeen) }}</dd>
          </div>
        </dl>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Warnungen
          </h2>
        </template>
        <p v-if="data.alerts.length === 0" class="text-sm text-muted">
          Keine.
        </p>
        <ul v-else class="divide-y divide-default text-sm">
          <li v-for="a in data.alerts" :key="a.id" class="flex flex-wrap justify-between gap-2 py-1.5">
            <ToneBadge :label="alertLabel(a.alertKey)" :tone="a.resolvedAt === null ? 'fail' : 'neutral'" />
            <time class="text-muted">{{ time(a.openedAt) }}<template v-if="a.resolvedAt !== null"> – {{ time(a.resolvedAt) }}</template></time>
          </li>
        </ul>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Nutzung
          </h2>
        </template>
        <p v-if="data.usage === null" class="text-sm text-muted">
          Keine Zahlen. Die App sendet sie ab der Version mit Statusmeldungen im Format 3.
        </p>
        <template v-else>
          <dl class="space-y-2 text-sm">
            <div>
              <dt class="text-muted">
                Konten
              </dt>
              <dd>{{ figure(data.usage.users) }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                Aktiv
              </dt>
              <dd>heute {{ figure(data.usage.d1) }} · 7 Tage {{ figure(data.usage.d7) }} · 30 Tage {{ figure(data.usage.d30) }}</dd>
            </div>
            <div>
              <dt class="text-muted">
                Bereiche (30 Tage)
              </dt>
              <dd>
                <template v-if="Object.keys(data.usage.areas).length === 0">
                  keine Nutzung
                </template>
                <p v-for="area in usageAreas(data.usage.areas)" :key="area.label">
                  {{ area.label }}: {{ area.people }}
                </p>
              </dd>
            </div>
          </dl>
          <template v-if="data.usageDays.length > 1">
            <p class="mt-3 text-xs text-muted">
              Aktiv je Tag (24 Stunden), letzte 30 Tage
            </p>
            <svg class="mt-1 h-16 w-full fill-primary" viewBox="0 0 300 60" preserveAspectRatio="none" role="img" aria-label="Aktive Konten je Tag in den letzten 30 Tagen">
              <rect v-for="bar in bars" :key="bar.x" :x="bar.x" :y="bar.y" :width="bar.width" :height="bar.height"><title>{{ bar.title }}</title></rect>
            </svg>
          </template>
        </template>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <h2 class="font-semibold text-highlighted">
          Verlauf
        </h2>
      </template>
      <p v-if="data.history.length === 0" class="text-sm text-muted">
        Noch keine Meldungen.
      </p>
      <ul v-else class="divide-y divide-default text-sm">
        <li v-for="(h, n) in data.history" :key="n" class="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <span class="flex flex-wrap items-center gap-1.5">
            <template v-if="h.type === 'event'">
              <ToneBadge :label="codeLabel(h.code ?? '')" tone="fail" />
              <small v-if="h.detail !== null" class="text-muted">Ursache: <code>{{ h.detail }}</code></small>
            </template>
            <template v-else>
              Lebenszeichen
              <ToneBadge v-for="key in Object.keys(h.checks).filter(k => h.checks[k] === 'error')" :key="key" :label="checkLabel(key)" tone="fail" />
              <small v-if="Object.keys(h.errors).length > 0" class="text-muted">{{ sum(h.errors) }} Fehler in 24 h</small>
            </template>
            <small class="text-muted">· {{ h.version }}</small>
          </span>
          <time class="text-muted">{{ time(h.receivedAt) }}</time>
        </li>
      </ul>
    </UCard>
  </div>
</template>

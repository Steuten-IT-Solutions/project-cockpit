<script setup lang="ts">
import type { ReleasesBox } from '#shared/types/cockpit'
import { RELEASE_CHANNELS, releaseConclusion } from '#shared/lib/releases'

// Releases of the company app. Reloads itself every 5 seconds while the page is
// visible; the X-Cockpit-Poll header tells the server that this is no user activity.
const { time, age } = useFormat()
const { data, refresh, error } = await useFetch<ReleasesBox>('/api/releases', { headers: { 'X-Cockpit-Poll': '1' } })

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(async () => {
    if (document.visibilityState !== 'visible') return
    await refresh()
  }, 5000)
})
onBeforeUnmount(() => clearInterval(timer))
// Logged out in the meantime (timeout): stop polling and go to the login page.
watch(error, async (e) => {
  if (e?.statusCode === 401) {
    clearInterval(timer)
    await refreshCockpitSession()
    await navigateTo('/login')
  }
})
</script>

<template>
  <UCard aria-live="polite">
    <template #header>
      <h2 class="font-semibold text-highlighted">
        Releases der Kompanie-App
      </h2>
    </template>
    <p v-if="!data || data.repo === null" class="text-sm text-muted">
      Für diese Anzeige die Einstellungen <code>NUXT_RELEASES_REPO</code> setzen (siehe README).
    </p>
    <p v-else-if="data.summary === null" class="text-sm text-muted">
      Noch keine Daten. Sie erscheinen nach dem nächsten Lauf der Hintergrundjobs.
    </p>
    <dl v-else class="space-y-3 text-sm">
      <div v-for="(label, channel) in RELEASE_CHANNELS" :key="channel">
        <dt class="font-medium text-highlighted">
          {{ label }}
        </dt>
        <dd class="space-y-1">
          <p v-for="r in data.summary[channel]?.running ?? []" :key="r.id" class="flex flex-wrap items-center gap-2">
            <ToneBadge :label="`${label}-Release läuft`" tone="live" :href="r.htmlUrl" />
            <span>
              <template v-if="r.coreVersion">Kern {{ r.coreVersion }} · </template>gestartet {{ age(r.startedAt, data.now) }}<template v-if="r.title"> · {{ r.title }}</template>
            </span>
          </p>
          <p v-if="data.summary[channel]?.last" class="text-default">
            Zuletzt: Kern <strong>{{ data.summary[channel]!.last!.coreVersion ?? 'unbekannt' }}</strong>
            am {{ time(data.summary[channel]!.last!.updatedAt) }} ({{ age(data.summary[channel]!.last!.updatedAt, data.now) }})
            · <ExternalLink :href="data.summary[channel]!.last!.htmlUrl">{{ data.summary[channel]!.last!.title ?? 'Lauf' }}</ExternalLink>
          </p>
          <p v-else class="text-muted">
            Noch kein erfolgreiches Release erfasst.
          </p>
          <p v-if="data.summary[channel]?.failed" class="flex flex-wrap items-center gap-2">
            <ToneBadge :label="`Letzter Lauf ${releaseConclusion(data.summary[channel]!.failed!.conclusion)}`" tone="fail" :href="data.summary[channel]!.failed!.htmlUrl" />
            <span>{{ time(data.summary[channel]!.failed!.updatedAt) }}<template v-if="data.summary[channel]!.failed!.title"> · {{ data.summary[channel]!.failed!.title }}</template></span>
          </p>
        </dd>
      </div>
    </dl>
    <p v-if="data?.summary" class="mt-3 text-xs text-muted">
      {{ data.repo }} · Zeit = Ende des Workflow-Laufs<template v-if="!data.webhook">
        · ohne Webhook erst nach dem nächsten Lauf der Hintergrundjobs aktuell
      </template>
    </p>
  </UCard>
</template>

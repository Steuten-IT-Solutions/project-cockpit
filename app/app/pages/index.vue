<script setup lang="ts">
import type { Dashboard } from '#shared/types/cockpit'
import { ciBadge, siteUrl, vercelBadge } from '#shared/lib/projects'
import { companyName, cronLabel, light, alertLabel, newerRelease, reportProblems, variantLabel } from '#shared/lib/status'

// The overview: projects from GitHub with CI, Vercel and installation state, the
// release box, the company installations and the system status (PHP: templates/dashboard.php).
useHead({ title: 'Übersicht · Cockpit' })

const route = useRoute()
const flash = useFlash()
const notice = useNotice()
const { time, age } = useFormat()
const showHidden = computed(() => route.query.all === '1')
const { data, refresh } = await useFetch<Dashboard>('/api/dashboard', { query: { all: computed(() => (showHidden.value ? '1' : undefined)) } })

const alertsByInstallation = computed(() => {
  const map: Record<string, Dashboard['openAlerts']> = {}
  for (const a of data.value?.openAlerts ?? []) {
    if (a.installationId !== null) (map[a.installationId] ??= []).push(a)
  }
  return map
})
const releaseAlerts = computed(() => (data.value?.openAlerts ?? []).filter(a => a.installationId === null))

/** The installation badge of a project card: format 2 wins over format 1. */
function installationBadge(projectId: number): { label: string, tone: 'ok' | 'fail' | 'warn' } | null {
  const d = data.value!
  const ids = d.installationsByRepo[projectId] ?? []
  if (ids.length > 0) {
    const red = ids.some(id => (alertsByInstallation.value[id] ?? []).length > 0)
    return red ? { label: 'Installation: Warnung', tone: 'fail' } : { label: 'Installation ok', tone: 'ok' }
  }
  const reports = d.reportsByRepo[projectId] ?? []
  if (reports.length > 0) {
    const failing = reports.some(r => reportProblems(r, d.now).length > 0)
    return failing ? { label: 'Installation: Problem', tone: 'warn' } : { label: 'Installation ok', tone: 'ok' }
  }
  return null
}

const EVENT_LABELS: Record<string, string> = {
  login: 'Anmeldung',
  login_recovery: 'Anmeldung mit Wiederherstellungscode',
  login_failed: 'Falsches Passwort',
  code_failed: 'Falscher Code',
  login_throttled: 'Gesperrt wegen Fehlversuchen',
  logout: 'Abmeldung',
  setup: 'Konto eingerichtet',
}

const cronOk = computed(() => {
  const c = data.value?.system.lastCron
  if (!c) return false
  const started = Date.parse(`${c.startedAt.replace(' ', 'T')}Z`) / 1000
  return c.status === 'ok' && data.value!.now - started < 3600
})

const refreshing = ref(false)
async function runJobs() {
  refreshing.value = true
  try {
    const result = await cockpitPost<{ message: string }>('/api/refresh')
    notice.ok(result.message)
    await refresh()
  }
  catch (e) {
    notice.fail(e)
  }
  finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div v-if="data" class="space-y-6">
    <UAlert v-if="flash" color="warning" variant="subtle" :title="flash" />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold text-highlighted">
        Projekte
      </h1>
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-refresh-cw" :loading="refreshing" @click="runJobs">
        Jetzt aktualisieren
      </UButton>
    </div>

    <ReleasesBox />

    <UAlert
      v-if="!data.githubConfigured"
      color="info"
      variant="subtle"
      title="Die GitHub App ist noch nicht eingetragen (NUXT_GITHUB_CLIENT_ID). Projekte erscheinen danach beim nächsten Lauf der Hintergrundjobs."
    />
    <p v-else-if="data.projects === null || (data.projects.length === 0 && data.hiddenCount === 0)" class="text-muted">
      Noch keine Projektdaten. Sie erscheinen nach dem nächsten Lauf der Hintergrundjobs (alle 15 Minuten).
    </p>
    <template v-else>
      <p class="text-sm text-muted">
        Stand: {{ time(data.lastSync) }} ·
        <NuxtLink v-if="showHidden" to="/" class="text-primary hover:underline">Ausgeblendete verbergen</NuxtLink>
        <NuxtLink v-else-if="data.hiddenCount > 0" :to="{ path: '/', query: { all: '1' } }" class="text-primary hover:underline">
          {{ data.hiddenCount }} ausgeblendete anzeigen
        </NuxtLink>
        <span v-else>alle angezeigt</span>
      </p>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UCard v-for="p in data.projects" :key="p.id" :class="p.hidden ? 'opacity-60' : ''">
          <h2 class="font-semibold">
            <NuxtLink :to="{ path: '/project', query: { id: p.id } }" class="text-highlighted hover:underline">
              {{ p.name }}
            </NuxtLink>
          </h2>
          <p class="text-sm text-muted">
            {{ p.owner }}<template v-if="p.isPrivate"> · privat</template><template v-if="p.isArchived"> · archiviert</template><template v-if="p.isFork"> · Fork</template><template v-if="p.hidden"> · ausgeblendet</template>
          </p>
          <div class="my-3 flex flex-wrap gap-1.5">
            <ToneBadge :label="ciBadge(p.ciStatus, p.ciConclusion)[0]" :tone="ciBadge(p.ciStatus, p.ciConclusion)[1]" :href="p.ciUrl" />
            <ToneBadge
              v-for="v in data.vercelByRepo[p.id] ?? []"
              :key="v.id"
              :label="vercelBadge(v.deployState)[0]"
              :tone="vercelBadge(v.deployState)[1]"
              :href="v.deployInspectorUrl"
            />
            <NuxtLink v-if="installationBadge(p.id)" to="#installationen" class="inline-flex">
              <ToneBadge :label="installationBadge(p.id)!.label" :tone="installationBadge(p.id)!.tone" />
            </NuxtLink>
            <ToneBadge v-if="p.releaseTag !== null" :label="p.releaseTag" tone="neutral" />
            <ToneBadge v-if="p.hasNote" label="Notiz" tone="neutral" />
          </div>
          <p class="text-sm text-muted">
            {{ p.openIssues }} Issues · {{ p.openPrs }} PRs · Push {{ age(p.pushedAt, data.now) }}
          </p>
          <p v-if="p.syncError !== null" class="mt-1 text-xs text-error">
            Abruf fehlgeschlagen: {{ p.syncError }}
          </p>
        </UCard>
      </div>
    </template>

    <template v-if="data.vercelUnmatched.length > 0">
      <h2 class="text-lg font-semibold text-highlighted">
        Vercel ohne GitHub-Karte
      </h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UCard v-for="v in data.vercelUnmatched" :key="v.id">
          <h3 class="font-semibold text-highlighted">
            {{ v.name }}
          </h3>
          <p class="text-sm text-muted">
            {{ v.repoFullName !== null ? `${v.repoFullName} · für die GitHub App nicht freigegeben` : 'ohne Git-Verbindung' }}
          </p>
          <div class="my-3">
            <ToneBadge :label="vercelBadge(v.deployState)[0]" :tone="vercelBadge(v.deployState)[1]" :href="v.deployInspectorUrl" />
          </div>
          <p class="text-sm text-muted">
            Deployment {{ age(v.deployCreatedAt, data.now) }}<template v-if="v.productionDomain !== null">
              · <ExternalLink :href="siteUrl(v.productionDomain)">{{ v.productionDomain }}</ExternalLink>
            </template>
          </p>
        </UCard>
      </div>
    </template>

    <template v-if="data.statusReceiver || data.reports.length > 0 || data.installations.length > 0">
      <h2 id="installationen" class="text-lg font-semibold text-highlighted">
        Kompanie-Installationen
      </h2>
      <p v-for="a in releaseAlerts" :key="a.id" class="text-sm text-error">
        <NuxtLink to="/alerts" class="hover:underline">{{ a.detail }}</NuxtLink>
      </p>
      <p v-if="data.installations.length === 0 && data.reports.length === 0" class="text-sm text-muted">
        Noch keine Meldungen. Installationen melden sich stündlich, sobald ein Admin unter <em>Einstellungen → Updates</em> zugestimmt hat.
      </p>
      <div v-if="data.installations.length > 0" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UCard v-for="i in data.installations" :key="i.id">
          <h3 class="font-semibold">
            <NuxtLink :to="{ path: '/installation', query: { id: i.id } }" class="text-highlighted hover:underline">
              {{ companyName(i.kompanie) }}
            </NuxtLink>
          </h3>
          <p class="text-sm text-muted">
            {{ variantLabel(i.variant) }} · Version {{ i.version }} · PHP {{ i.php }} / {{ i.dbDriver }}
          </p>
          <div class="my-3 flex flex-wrap gap-1.5">
            <ToneBadge v-if="light(i, (alertsByInstallation[i.id] ?? []).length > 0) === 'ok'" label="in Ordnung" tone="ok" />
            <ToneBadge v-else-if="light(i, (alertsByInstallation[i.id] ?? []).length > 0) === 'warn'" label="Hinweise" tone="warn" />
            <ToneBadge v-else-if="light(i, (alertsByInstallation[i.id] ?? []).length > 0) === 'maintenance'" label="in Wartung" tone="neutral" />
            <ToneBadge v-for="a in alertsByInstallation[i.id] ?? []" :key="a.id" :label="alertLabel(a.alertKey)" tone="fail" />
            <ToneBadge
              v-if="newerRelease(i.version, data.releaseByRepo[i.kompanie.toLowerCase()])"
              :label="`${newerRelease(i.version, data.releaseByRepo[i.kompanie.toLowerCase()])} veröffentlicht`"
              tone="neutral"
            />
          </div>
          <p class="text-sm text-muted">
            Lebenszeichen {{ age(i.lastHeartbeat ?? i.lastSeen, data.now) }} · {{ cronLabel(i.cronKind) }}
          </p>
        </UCard>
      </div>
      <template v-if="data.reports.length > 0">
        <p class="text-sm text-muted">
          Ältere Installationen (Format 1, täglich, nicht signiert – nur ein Hinweis):
        </p>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <UCard v-for="r in data.reports" :key="`${r.kompanie}|${r.variant}`">
            <h3 class="font-semibold text-highlighted">
              <NuxtLink
                v-if="data.reportProject[`${r.kompanie}|${r.variant}`] !== undefined"
                :to="{ path: '/project', query: { id: data.reportProject[`${r.kompanie}|${r.variant}`] } }"
                class="hover:underline"
              >
                {{ companyName(r.kompanie) }}
              </NuxtLink>
              <template v-else>
                {{ companyName(r.kompanie) }}
              </template>
            </h3>
            <p class="text-sm text-muted">
              {{ variantLabel(r.variant) }} · Version {{ r.version }} · PHP {{ r.php }} / {{ r.dbDriver }}
            </p>
            <div class="my-3 flex flex-wrap gap-1.5">
              <ToneBadge v-if="reportProblems(r, data.now).length === 0" label="in Ordnung" tone="ok" />
              <ToneBadge v-for="problem in reportProblems(r, data.now)" :key="problem" :label="problem" tone="warn" />
              <ToneBadge
                v-if="newerRelease(r.version, data.releaseByRepo[r.kompanie.toLowerCase()])"
                :label="`${newerRelease(r.version, data.releaseByRepo[r.kompanie.toLowerCase()])} veröffentlicht`"
                tone="neutral"
              />
            </div>
            <p class="text-sm text-muted">
              Meldung {{ age(r.receivedAt, data.now) }}<template v-if="r.updateAt !== null">
                · Update {{ age(r.updateAt, data.now) }}
              </template>
            </p>
          </UCard>
        </div>
      </template>
    </template>

    <h2 class="text-lg font-semibold text-highlighted">
      System
    </h2>
    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <h3 class="font-semibold text-highlighted">
            Systemstatus
          </h3>
        </template>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt class="text-muted">
            Laufzeit
          </dt>
          <dd>{{ data.system.runtime }}</dd>
          <dt class="text-muted">
            Datenbank-Schema
          </dt>
          <dd>{{ data.system.schemaVersion ?? 'nicht migriert' }}</dd>
          <dt class="text-muted">
            Letzter Lauf der Hintergrundjobs
          </dt>
          <dd>
            <ToneBadge v-if="data.system.lastCron === null" label="noch keiner" tone="warn" />
            <template v-else>
              <ToneBadge :label="data.system.lastCron.status" :tone="cronOk ? 'ok' : 'warn'" />
              {{ time(data.system.lastCron.startedAt) }} · {{ data.system.lastCron.phpVersion }} ({{ data.system.lastCron.phpSapi }})
              <small v-if="data.system.lastCron.message" class="block text-muted">{{ data.system.lastCron.message }}</small>
            </template>
          </dd>
          <dt class="text-muted">
            Wiederherstellungscodes
          </dt>
          <dd><ToneBadge :label="`${data.system.recoveryLeft} übrig`" :tone="data.system.recoveryLeft >= 3 ? 'ok' : 'warn'" /></dd>
        </dl>
      </UCard>
      <UCard>
        <template #header>
          <h3 class="font-semibold text-highlighted">
            Letzte Anmeldeereignisse
          </h3>
        </template>
        <p v-if="data.system.events.length === 0" class="text-sm text-muted">
          Keine Einträge.
        </p>
        <ul v-else class="divide-y divide-default text-sm">
          <li v-for="(e, n) in data.system.events" :key="n" class="flex justify-between gap-4 py-1.5">
            <span>{{ EVENT_LABELS[e.event] ?? e.event }}</span>
            <time class="text-muted">{{ time(e.createdAt) }}</time>
          </li>
        </ul>
      </UCard>
    </div>
  </div>
</template>

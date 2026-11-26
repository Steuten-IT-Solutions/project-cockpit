<script setup lang="ts">
import type { ProjectPage } from '#shared/types/cockpit'
import { INTERVALS, money } from '#shared/lib/costs'
import { ciBadge, projectLinks, siteUrl, vercelBadge } from '#shared/lib/projects'
import { alertLabel, light, LIGHT_LABELS, newerRelease, reportProblems, variantLabel } from '#shared/lib/status'

// One project: status, links, hide/show, and the note with its earlier versions
// (PHP: templates/project.php). The URL stays /project?id=… like before.
const route = useRoute()
const notice = useNotice()
const { time, age } = useFormat()
const id = computed(() => String(route.query.id ?? ''))
const { data, refresh, error } = await useFetch<ProjectPage>(() => `/api/projects/${encodeURIComponent(id.value)}`)
if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, statusMessage: 'Diese Seite gibt es nicht.', fatal: true })
}
useHead({ title: computed(() => `${data.value?.project.name ?? 'Projekt'} · Cockpit`) })

const LIGHT_TONES = { ok: 'ok', warn: 'warn', error: 'fail', maintenance: 'neutral' } as const

// The text field starts with the current note and is only reset after saving.
const body = ref(data.value?.history[0]?.body ?? '')
const saving = ref(false)
async function saveNote() {
  saving.value = true
  try {
    const result = await cockpitPost<{ message: string }>(`/api/projects/${data.value!.project.id}/note`, { body: body.value })
    notice.ok(result.message)
    await refresh()
  }
  catch (e) {
    notice.fail(e)
  }
  finally {
    saving.value = false
  }
}

const toggling = ref(false)
async function toggleHidden() {
  toggling.value = true
  try {
    const result = await cockpitPost<{ message: string }>(`/api/projects/${data.value!.project.id}/visibility`, { hidden: !data.value!.project.hidden })
    notice.ok(result.message)
    await refresh()
  }
  catch (e) {
    notice.fail(e)
  }
  finally {
    toggling.value = false
  }
}
</script>

<template>
  <div v-if="data" class="space-y-4">
    <NuxtLink to="/" class="text-sm text-muted hover:underline">
      ← Alle Projekte
    </NuxtLink>
    <div>
      <h1 class="text-2xl font-semibold text-highlighted">
        {{ data.project.name }}
      </h1>
      <p class="text-sm text-muted">
        {{ data.project.fullName }}<template v-if="data.project.isPrivate"> · privat</template><template v-if="data.project.isArchived"> · archiviert</template><template v-if="!data.project.available"> · für die GitHub App nicht mehr freigegeben</template>
      </p>
      <p v-if="data.project.description !== null" class="mt-2">
        {{ data.project.description }}
      </p>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Status
          </h2>
        </template>
        <dl class="space-y-3 text-sm">
          <div>
            <dt class="text-muted">
              CI ({{ data.project.defaultBranch }})
            </dt>
            <dd class="flex flex-wrap items-center gap-2">
              <ToneBadge :label="ciBadge(data.project.ciStatus, data.project.ciConclusion)[0]" :tone="ciBadge(data.project.ciStatus, data.project.ciConclusion)[1]" />
              <span><template v-if="data.project.ciWorkflow">{{ data.project.ciWorkflow }}, </template>{{ age(data.project.ciAt, data.now) }}</span>
              <ExternalLink v-if="data.project.ciUrl" :href="data.project.ciUrl">Lauf öffnen</ExternalLink>
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              Letztes Release
            </dt>
            <dd>
              <template v-if="data.project.releaseTag === null">–</template>
              <template v-else>
                <ExternalLink v-if="data.project.releaseUrl" :href="data.project.releaseUrl">{{ data.project.releaseTag }}</ExternalLink>
                <template v-else>{{ data.project.releaseTag }}</template>
                · {{ time(data.project.releaseAt) }}
              </template>
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              Offen
            </dt>
            <dd>{{ data.project.openIssues }} Issues · {{ data.project.openPrs }} Pull Requests</dd>
          </div>
          <div>
            <dt class="text-muted">
              Letzter Push
            </dt>
            <dd>{{ time(data.project.pushedAt) }}</dd>
          </div>
          <div v-for="v in data.vercel" :key="v.id">
            <dt class="text-muted">
              Vercel ({{ v.name }})
            </dt>
            <dd class="space-y-0.5">
              <p class="flex flex-wrap items-center gap-2">
                <ToneBadge :label="vercelBadge(v.deployState)[0]" :tone="vercelBadge(v.deployState)[1]" />
                <span>{{ age(v.deployCreatedAt, data.now) }}</span>
                <ExternalLink v-if="v.deployInspectorUrl" :href="v.deployInspectorUrl">Deployment öffnen</ExternalLink>
              </p>
              <p v-if="v.productionDomain">
                <ExternalLink :href="siteUrl(v.productionDomain)">{{ v.productionDomain }}</ExternalLink>
              </p>
              <p v-if="v.deployCommit" class="text-xs text-muted">
                {{ v.deployCommit }}
              </p>
              <p v-if="v.deployError" class="text-xs text-error">
                {{ v.deployError }}
              </p>
            </dd>
          </div>
          <div v-for="i in data.installations" :key="i.id">
            <dt class="text-muted">
              Installation ({{ variantLabel(i.variant) }})
            </dt>
            <dd class="space-y-0.5">
              <p class="flex flex-wrap items-center gap-2">
                <ToneBadge
                  :label="LIGHT_LABELS[light(i, (data.alertsByInstallation[i.id] ?? []).length > 0)]"
                  :tone="LIGHT_TONES[light(i, (data.alertsByInstallation[i.id] ?? []).length > 0)]"
                />
                <NuxtLink :to="{ path: '/installation', query: { id: i.id } }" class="text-primary hover:underline">
                  Version {{ i.version }}
                </NuxtLink>
                <span v-if="newerRelease(i.version, data.project.releaseTag)">({{ newerRelease(i.version, data.project.releaseTag) }} veröffentlicht)</span>
                <span>· PHP {{ i.php }} / {{ i.dbDriver }}</span>
              </p>
              <p class="text-xs text-muted">
                Lebenszeichen {{ time(i.lastHeartbeat ?? i.lastSeen) }}
              </p>
              <p v-for="a in data.alertsByInstallation[i.id] ?? []" :key="a.id" class="text-xs text-error">
                {{ alertLabel(a.alertKey) }}
              </p>
            </dd>
          </div>
          <div v-for="r in data.reports" :key="r.variant">
            <dt class="text-muted">
              Installation ({{ variantLabel(r.variant) }})
            </dt>
            <dd class="space-y-0.5">
              <p class="flex flex-wrap items-center gap-2">
                <ToneBadge :label="reportProblems(r, data.now).length === 0 ? 'in Ordnung' : 'Problem'" :tone="reportProblems(r, data.now).length === 0 ? 'ok' : 'warn'" />
                <span>Version {{ r.version }}<template v-if="newerRelease(r.version, data.project.releaseTag)"> ({{ newerRelease(r.version, data.project.releaseTag) }} veröffentlicht)</template> · PHP {{ r.php }} / {{ r.dbDriver }}</span>
              </p>
              <p class="text-xs text-muted">
                Meldung {{ time(r.receivedAt) }}<template v-if="r.updateAt !== null">
                  · letztes Update {{ time(r.updateAt) }}
                </template><template v-if="r.galleryAt !== null">
                  · Galerie-Abgleich {{ time(r.galleryAt) }}
                </template>
              </p>
              <p v-if="reportProblems(r, data.now).length > 0" class="text-xs text-error">
                {{ reportProblems(r, data.now).join('; ') }}
              </p>
            </dd>
          </div>
          <div v-if="data.costs.length > 0">
            <dt class="text-muted">
              Kosten
            </dt>
            <dd>
              <p v-for="c in data.costs" :key="c.id">
                {{ c.name }}: {{ money(c.amountCents, c.currency) }} {{ INTERVALS[c.billingInterval] ?? '' }}
              </p>
              <NuxtLink to="/costs" class="text-xs text-primary hover:underline">Alle Kosten</NuxtLink>
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              Abgerufen
            </dt>
            <dd>
              {{ time(data.project.syncedAt) }}
              <p v-if="data.project.syncError !== null" class="text-xs text-error">
                {{ data.project.syncError }}
              </p>
            </dd>
          </div>
        </dl>
        <p class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <ExternalLink v-for="[label, url] in projectLinks(data.project.htmlUrl)" :key="label" :href="url">
            {{ label }}
          </ExternalLink>
        </p>
        <UButton class="mt-4" color="neutral" variant="outline" :loading="toggling" @click="toggleHidden">
          {{ data.project.hidden ? 'Wieder in der Übersicht anzeigen' : 'In der Übersicht ausblenden' }}
        </UButton>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">
            Notiz
          </h2>
        </template>
        <form class="space-y-3" @submit.prevent="saveNote">
          <UTextarea v-model="body" aria-label="Notiz" :rows="10" :maxlength="100000" autoresize class="w-full" />
          <UButton type="submit" :loading="saving">
            Speichern
          </UButton>
        </form>
        <template v-if="data.history.length > 1">
          <h3 class="mt-6 mb-2 font-medium text-highlighted">
            Frühere Fassungen
          </h3>
          <details v-for="version in data.history.slice(1)" :key="version.id" class="border-t border-default py-2 text-sm">
            <summary class="cursor-pointer">
              {{ time(version.createdAt) }}
            </summary>
            <pre class="mt-2 whitespace-pre-wrap break-words font-sans">{{ version.body }}</pre>
          </details>
        </template>
      </UCard>
    </div>
  </div>
</template>

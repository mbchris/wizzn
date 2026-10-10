<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatLicense, readingMinutes, unitContentSchema, type UnitDetailDto } from '@wizzn/shared'

const props = defineProps<{ title: string | null; content: unknown; assets: UnitDetailDto['assets'] }>()
const slide = ref(0)
const assetUrls = computed(() => Object.fromEntries(props.assets.map((a) => [a.id, a.url])))
const assetById = computed(() => new Map(props.assets.map((a) => [a.id, a])))
const badgeLabel = (id: string): string => {
  const credit = assetById.value.get(id)?.credit
  return credit ? `Stock · ${credit.provider} · ${formatLicense(credit)}` : 'KI'
}
const parsed = computed(() => unitContentSchema.safeParse(props.content))
// Start on the cover when there is one (name -1), else on the first slide
watch(parsed, (p) => (slide.value = p.success && p.data.format === 'written' && p.data.cover ? -1 : 0), { immediate: true })
</script>

<template>
  <div class="phone-frame column">
    <div class="q-pa-md text-weight-bold text-subtitle1">{{ title }}</div>
    <template v-if="parsed.success && parsed.data.format === 'written'">
      <q-carousel v-model="slide" swipeable animated arrows navigation class="col" control-color="primary">
        <!-- Issue #4: cover is the first page; slides shift by one when present -->
        <q-carousel-slide v-if="parsed.data.cover" :name="-1" class="column no-wrap q-pa-md">
          <q-img v-if="assetUrls[parsed.data.cover.imageId]" :src="assetUrls[parsed.data.cover.imageId]" ratio="1" class="rounded-borders q-mb-md">
            <q-badge class="absolute-top-left q-ma-xs" :color="assetById.get(parsed.data.cover.imageId)?.credit ? 'primary' : 'grey-8'" :label="badgeLabel(parsed.data.cover.imageId)" />
          </q-img>
          <div class="text-caption text-grey-7 q-mb-xs">≈ {{ readingMinutes(parsed.data) }} Min. Lesezeit</div>
          <div class="text-weight-bold q-mb-sm">{{ title }}</div>
          <div class="text-body2">{{ parsed.data.cover.hook }}</div>
        </q-carousel-slide>
        <q-carousel-slide v-for="(s, i) in parsed.data.slides" :key="i" :name="i" class="column no-wrap q-pa-md">
          <q-img v-if="s.imageId && assetUrls[s.imageId]" :src="assetUrls[s.imageId]" ratio="1" class="rounded-borders q-mb-md">
            <q-badge class="absolute-top-left q-ma-xs" :color="assetById.get(s.imageId)?.credit ? 'primary' : 'grey-8'" :label="badgeLabel(s.imageId)">
              <q-tooltip v-if="assetById.get(s.imageId)?.credit" class="text-body2">
                {{ assetById.get(s.imageId)?.credit?.creator ?? 'Unbekannt' }}
                <a :href="assetById.get(s.imageId)?.credit?.sourceUrl" target="_blank" class="text-white">Quelle ansehen</a>
              </q-tooltip>
            </q-badge>
          </q-img>
          <div class="text-weight-bold q-mb-sm">{{ s.title }}</div>
          <div class="text-body2">{{ s.body }}</div>
        </q-carousel-slide>
      </q-carousel>
      <div class="q-pa-sm text-caption">
        <a v-for="src in parsed.data.sources" :key="src.url" :href="src.url" target="_blank" class="block">{{ src.publisher }}</a>
      </div>
    </template>
    <template v-else-if="parsed.success && parsed.data.format === 'audio'">
      <div class="col scroll q-pa-md">
        <div class="row q-gutter-sm q-mb-md">
          <q-img v-for="img in parsed.data.images" :key="img.imageId" :src="assetUrls[img.imageId]" width="80px" ratio="1" class="rounded-borders">
            <q-badge class="absolute-top-left q-ma-xs" :color="assetById.get(img.imageId)?.credit ? 'primary' : 'grey-8'" :label="badgeLabel(img.imageId)">
              <q-tooltip v-if="assetById.get(img.imageId)?.credit" class="text-body2">
                {{ assetById.get(img.imageId)?.credit?.creator ?? 'Unbekannt' }}
                <a :href="assetById.get(img.imageId)?.credit?.sourceUrl" target="_blank" class="text-white">Quelle ansehen</a>
              </q-tooltip>
            </q-badge>
            <div class="absolute-bottom text-caption text-center">{{ img.showAtSec }}s</div>
          </q-img>
        </div>
        <audio v-if="assetUrls[parsed.data.audioId]" :src="assetUrls[parsed.data.audioId]" controls class="full-width q-mb-md" />
        <div class="text-body2" style="white-space: pre-wrap">{{ parsed.data.script }}</div>
      </div>
    </template>
    <div v-else class="q-pa-md text-grey-7">Noch keine fertigen Inhalte (Entwurf oder ungültig).</div>
  </div>
</template>

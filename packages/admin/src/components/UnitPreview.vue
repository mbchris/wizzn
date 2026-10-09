<script setup lang="ts">
import { computed, ref } from 'vue'
import { unitContentSchema } from '@wizzn/shared'

const props = defineProps<{ title: string | null; content: unknown; assetUrls: Record<string, string> }>()
const slide = ref(0)
const parsed = computed(() => unitContentSchema.safeParse(props.content))
</script>

<template>
  <div class="phone-frame column">
    <div class="q-pa-md text-weight-bold text-subtitle1">{{ title }}</div>
    <template v-if="parsed.success && parsed.data.format === 'written'">
      <q-carousel v-model="slide" swipeable animated arrows navigation class="col" control-color="primary">
        <q-carousel-slide v-for="(s, i) in parsed.data.slides" :key="i" :name="i" class="column no-wrap q-pa-md">
          <q-img v-if="s.imageId && assetUrls[s.imageId]" :src="assetUrls[s.imageId]" ratio="1" class="rounded-borders q-mb-md" />
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

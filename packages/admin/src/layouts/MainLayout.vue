<script setup lang="ts">
import { useRouter } from 'vue-router'
import { authApi } from 'src/api'

const router = useRouter()

async function signOut(): Promise<void> {
  await authApi.signOut().catch(() => undefined)
  await router.push('/login')
}
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary">
      <q-toolbar>
        <q-toolbar-title class="text-weight-bold">wizzn · Redaktion</q-toolbar-title>
        <q-btn flat to="/units" label="Wissenshappen" />
        <q-btn flat to="/briefs/new" icon="add" label="Neuer Auftrag" />
        <q-btn flat to="/briefs/import" icon="upload_file" label="Batch-Import" />
        <q-btn flat round icon="logout" @click="signOut" />
      </q-toolbar>
    </q-header>
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>
